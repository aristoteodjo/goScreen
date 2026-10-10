//! Reading a site's identity (name, tagline, colors, fonts, logo) and the role
//! of each section of a page. Everything is generic: no site is special-cased.
//! Parsing is pure; only the two commands touch the network.

use std::{collections::HashMap, sync::Arc, time::Duration};

use serde::Serialize;
use url::Url;

use crate::modules::proxy::relay::{is_local_origin, PublicResolver};

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct BrandColors {
    pub background: Option<String>,
    pub primary: Option<String>,
    pub accent: Option<String>,
    pub ink: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct BrandFonts {
    pub heading: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct Brand {
    pub name: String,
    pub tagline: Option<String>,
    pub description: Option<String>,
    pub lang: Option<String>,
    pub colors: BrandColors,
    pub fonts: BrandFonts,
    pub logo: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    Hero,
    Features,
    Pricing,
    Stats,
    HowItWorks,
    Testimonials,
    Listing,
    Faq,
    Cta,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Section {
    pub role: Role,
    pub title: String,
    pub text: String,
}

// ---------- HTML helpers ----------

/// Decodes the entities a server renderer emits (`&#x27;`, `&amp;`, `&#39;`…).
pub fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Visible text of an HTML fragment: tags, comments, scripts and styles removed,
/// whitespace collapsed.
pub fn text_of(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::new();
    let mut i = 0;
    while i < html.len() {
        if html.as_bytes()[i] == b'<' {
            let skip_to = |close: &str| lower[i..].find(close).map(|e| i + e + close.len()).unwrap_or(html.len());
            i = if lower[i..].starts_with("<!--") {
                skip_to("-->")
            } else if lower[i..].starts_with("<script") {
                skip_to("</script>")
            } else if lower[i..].starts_with("<style") {
                skip_to("</style>")
            } else {
                out.push(' ');
                skip_to(">")
            };
        } else {
            let next = html[i..].find('<').map(|n| i + n).unwrap_or(html.len());
            out.push_str(&html[i..next]);
            i = next;
        }
    }
    decode_entities(&out).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Attributes of every `<tag ...>` opening tag, lowercased names.
fn tags(html: &str, name: &str) -> Vec<HashMap<String, String>> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{name}");
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(s) = lower[from..].find(&open) {
        let start = from + s;
        let after = start + open.len();
        let Some(e) = lower[start..].find('>') else { break };
        let end = start + e;
        from = end;
        if !lower[after..].starts_with(|c: char| c.is_whitespace() || c == '/' || c == '>') {
            continue;
        }
        out.push(attributes(&html[after..end]));
    }
    out
}

fn attributes(s: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut rest = s.trim_start();
    while !rest.is_empty() {
        let name_end = rest.find(|c: char| c == '=' || c.is_whitespace() || c == '/').unwrap_or(rest.len());
        let name = rest[..name_end].to_ascii_lowercase();
        rest = rest[name_end..].trim_start();
        let mut value = String::new();
        if let Some(r) = rest.strip_prefix('=') {
            let r = r.trim_start();
            let (v, next) = match r.chars().next() {
                Some(q @ ('"' | '\'')) => {
                    let close = r[1..].find(q).map(|i| i + 1).unwrap_or(r.len());
                    (&r[1..close], &r[(close + 1).min(r.len())..])
                }
                _ => {
                    let e = r.find(char::is_whitespace).unwrap_or(r.len());
                    (&r[..e], &r[e..])
                }
            };
            value = decode_entities(v);
            rest = next;
        }
        if !name.is_empty() {
            out.entry(name).or_insert(value);
        }
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '/');
    }
    out
}

/// Inner HTML of the first `<tag>…</tag>`.
fn first_element<'a>(html: &'a str, name: &str) -> Option<&'a str> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find(&format!("<{name}"))?;
    let open_end = start + lower[start..].find('>')? + 1;
    let close = open_end + lower[open_end..].find(&format!("</{name}>"))?;
    Some(&html[open_end..close])
}

fn meta(metas: &[HashMap<String, String>], key: &str) -> Option<String> {
    metas
        .iter()
        .find(|m| m.get("name").or_else(|| m.get("property")).is_some_and(|n| n.eq_ignore_ascii_case(key)))
        .and_then(|m| m.get("content"))
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
}

/// What the home page says about itself, before any CSS is read.
#[derive(Debug, Default, PartialEq)]
pub struct PageMeta {
    pub name: String,
    pub tagline: Option<String>,
    pub description: Option<String>,
    pub lang: Option<String>,
    pub theme_color: Option<String>,
    pub stylesheets: Vec<String>,
    pub icons: Vec<String>,
    pub inline_css: String,
}

pub fn page_meta(html: &str) -> PageMeta {
    let metas = tags(html, "meta");
    let title = first_element(html, "title").map(text_of).filter(|t| !t.is_empty());
    let name = meta(&metas, "og:site_name")
        .or_else(|| meta(&metas, "application-name"))
        .or_else(|| {
            title.as_deref().map(|t| {
                [" | ", " · ", " — ", " – ", " - "]
                    .iter()
                    .fold(t, |acc, sep| acc.split(sep).next().unwrap_or(acc))
                    .trim()
                    .to_string()
            })
        })
        .unwrap_or_default();
    let links = tags(html, "link");
    let rel_has = |l: &HashMap<String, String>, r: &str| {
        l.get("rel").is_some_and(|v| v.to_ascii_lowercase().split_whitespace().any(|x| x == r))
    };
    let href = |l: &HashMap<String, String>| l.get("href").cloned().filter(|h| !h.is_empty());
    let mut icons: Vec<(u8, String)> = links
        .iter()
        .filter_map(|l| {
            let h = href(l)?;
            let svg = h.to_ascii_lowercase().ends_with(".svg") || l.get("type").is_some_and(|t| t.contains("svg"));
            let rank = if rel_has(l, "icon") && svg {
                0
            } else if rel_has(l, "apple-touch-icon") {
                1
            } else if rel_has(l, "icon") {
                2
            } else {
                return None;
            };
            Some((rank, h))
        })
        .collect();
    icons.sort_by_key(|(r, _)| *r);
    let mut inline_css = String::new();
    let lower = html.to_ascii_lowercase();
    let mut from = 0;
    while let Some(s) = lower[from..].find("<style") {
        let open = from + s + lower[from + s..].find('>').map(|e| e + 1).unwrap_or(0);
        let close = lower[open..].find("</style>").map(|e| open + e).unwrap_or(html.len());
        inline_css.push_str(&html[open..close]);
        inline_css.push('\n');
        from = close;
    }
    PageMeta {
        name,
        tagline: first_element(html, "h1").map(text_of).filter(|t| !t.is_empty()),
        description: meta(&metas, "description").or_else(|| meta(&metas, "og:description")),
        lang: tags(html, "html")
            .first()
            .and_then(|a| a.get("lang").cloned())
            .filter(|l| !l.is_empty())
            .or_else(|| meta(&metas, "og:locale").map(|l| l.split('_').next().unwrap_or(&l).to_string())),
        theme_color: meta(&metas, "theme-color"),
        stylesheets: links.iter().filter(|l| rel_has(l, "stylesheet")).filter_map(href).collect(),
        icons: icons.into_iter().map(|(_, h)| h).collect(),
        inline_css,
    }
}

// ---------- CSS helpers ----------

/// Custom properties declared for the light theme (`:root` / `:host` rules,
/// outside any rule or media query mentioning `dark`). Later wins, as in CSS.
pub fn root_vars(css: &str) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    let mut stack: Vec<String> = Vec::new();
    let mut boundary = 0;
    for (i, c) in css.char_indices() {
        match c {
            '{' => {
                stack.push(css[boundary..i].trim().to_ascii_lowercase());
                boundary = i + 1;
            }
            ';' | '}' => {
                let decl = css[boundary..i].trim();
                let in_root = stack.last().is_some_and(|s| s.contains(":root") || s.contains(":host"));
                let dark = stack.iter().any(|s| s.contains("dark"));
                if in_root && !dark {
                    if let Some((k, v)) = decl.split_once(':') {
                        if k.trim().starts_with("--") {
                            vars.insert(k.trim().to_string(), v.trim().to_string());
                        }
                    }
                }
                if c == '}' {
                    stack.pop();
                }
                boundary = i + 1;
            }
            _ => {}
        }
    }
    vars
}

/// Resolves `var(--x, fallback)` chains against `vars`.
pub fn resolve(value: &str, vars: &HashMap<String, String>) -> Option<String> {
    let mut v = value.trim().to_string();
    for _ in 0..8 {
        let Some(inner) = v.strip_prefix("var(").and_then(|r| r.strip_suffix(')')) else {
            return Some(v).filter(|s| !s.is_empty());
        };
        let (name, fallback) = match inner.split_once(',') {
            Some((n, f)) => (n.trim(), Some(f.trim())),
            None => (inner.trim(), None),
        };
        v = match (vars.get(name), fallback) {
            (Some(x), _) => x.clone(),
            (None, Some(f)) => f.to_string(),
            (None, None) => return None,
        };
    }
    None
}

/// A usable CSS color, or `None`. Bare shadcn HSL triplets become `hsl(...)`.
pub fn as_color(value: &str) -> Option<String> {
    let v = value.trim().to_ascii_lowercase();
    let functional = ["#", "rgb", "hsl", "oklch", "oklab", "lab(", "lch(", "color("];
    if functional.iter().any(|p| v.starts_with(p)) {
        return Some(v);
    }
    let parts: Vec<&str> = v.split_whitespace().collect();
    let numeric = |p: &str| p.trim_end_matches('%').parse::<f32>().is_ok();
    (parts.len() == 3 && parts.iter().all(|p| numeric(p))).then(|| format!("hsl({})", parts.join(" ")))
}

/// First family of a `font-family` value, unquoted.
pub fn first_family(value: &str, vars: &HashMap<String, String>) -> Option<String> {
    let v = resolve(value, vars)?;
    let f = v.split(',').next()?.trim().trim_matches(['"', '\'']).trim();
    let generic = ["sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif", "-apple-system", "inherit"];
    (!f.is_empty() && !generic.contains(&f) && !f.starts_with("var(")).then(|| f.to_string())
}

/// `font-family` of the first rule whose selector list contains `selector`.
fn rule_font(css: &str, selector: &str, vars: &HashMap<String, String>) -> Option<String> {
    let mut boundary = 0;
    for (i, c) in css.char_indices() {
        match c {
            '{' => {
                let sel = css[boundary..i].trim().to_ascii_lowercase();
                let close = css[i..].find('}').map(|e| i + e).unwrap_or(css.len());
                if sel.split(',').any(|s| s.trim() == selector) {
                    let body = &css[i + 1..close];
                    if let Some(f) = body.split(';').filter_map(|d| d.split_once(':')).find_map(|(k, v)| {
                        (k.trim() == "font-family").then(|| first_family(v, vars)).flatten()
                    }) {
                        return Some(f);
                    }
                }
                boundary = i + 1;
            }
            '}' | ';' => boundary = i + 1,
            _ => {}
        }
    }
    None
}

/// Most used non-neutral fill/stroke color of an SVG logo.
pub fn svg_brand_color(svg: &str) -> Option<String> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for attr in ["fill=\"", "stroke=\"", "fill:", "stop-color=\""] {
        for part in svg.split(attr).skip(1) {
            let c = part.split(['"', ';', ' ']).next().unwrap_or("").to_ascii_lowercase();
            if !c.starts_with('#') || is_neutral(&c) {
                continue;
            }
            match counts.iter_mut().find(|(k, _)| *k == c) {
                Some((_, n)) => *n += 1,
                None => counts.push((c, 1)),
            }
        }
    }
    // Stable max: on ties the first color in the file wins.
    counts.into_iter().fold(None::<(String, usize)>, |best, (c, n)| match best {
        Some((_, bn)) if bn >= n => best,
        _ => Some((c, n)),
    }).map(|(c, _)| c)
}

/// Near-white, near-black or grey: not a brand color.
fn is_neutral(hex: &str) -> bool {
    let h = hex.trim_start_matches('#');
    let h: String = if h.len() == 3 { h.chars().flat_map(|c| [c, c]).collect() } else { h.chars().take(6).collect() };
    let Ok(n) = u32::from_str_radix(&h, 16) else { return true };
    let (r, g, b) = ((n >> 16) & 255, (n >> 8) & 255, n & 255);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    max - min < 24 || max < 40 || min > 235
}

/// Combines the page, its stylesheets and its logo into a brand.
pub fn brand_from(meta: PageMeta, css: &str, logo_svg: Option<&str>, logo: Option<String>) -> Brand {
    let all_css = format!("{css}\n{}", meta.inline_css);
    let vars = root_vars(&all_css);
    let color = |names: &[&str]| {
        names.iter().find_map(|n| vars.get(*n).and_then(|v| resolve(v, &vars)).and_then(|v| as_color(&v)))
    };
    let primary = color(&["--primary", "--brand", "--color-primary", "--color-brand", "--brand-primary"])
        .or_else(|| logo_svg.and_then(svg_brand_color));
    let font_var = |names: &[&str]| names.iter().find_map(|n| vars.get(*n).and_then(|v| first_family(v, &vars)));
    Brand {
        name: meta.name,
        tagline: meta.tagline,
        description: meta.description,
        lang: meta.lang,
        colors: BrandColors {
            background: color(&["--background", "--color-background", "--bg"])
                .or_else(|| meta.theme_color.as_deref().and_then(as_color)),
            primary,
            accent: color(&["--accent", "--color-accent", "--secondary"]),
            ink: color(&["--foreground", "--color-foreground", "--text", "--ink"]),
        },
        fonts: BrandFonts {
            heading: rule_font(&all_css, "h1", &vars)
                .or_else(|| font_var(&["--font-heading", "--font-display", "--font-title"])),
            body: rule_font(&all_css, "body", &vars).or_else(|| font_var(&["--font-sans", "--font-body"])),
        },
        logo,
    }
}

// ---------- sections ----------

/// Keywords per role, several languages. The heading counts more than the body.
const ROLE_WORDS: &[(Role, &[&str])] = &[
    (Role::HowItWorks, &["comment ça marche", "comment ca marche", "how it works", "étapes", "steps", "so funktioniert", "cómo funciona", "como funciona", "en pratique"]),
    (Role::Faq, &["faq", "questions fréquentes", "frequently asked", "questions"]),
    (Role::Stats, &["en chiffres", "chiffres", "by the numbers", "statistiques", "stats", "in numbers", "impact", "résultats", "results"]),
    (Role::Pricing, &["tarif", "prix", "pricing", "price", "plans", "abonnement", "preise", "precios", "per month", "/mois", "/month"]),
    (Role::Testimonials, &["témoignage", "testimonial", "avis", "reviews", "ce qu'ils", "what our", "clients disent", "customers say", "note", "rating", "trusted by"]),
    (Role::Listing, &["disponible", "available", "catalogue", "catalog", "produits", "products", "annonces", "listings", "classement", "ranking", "leaderboard", "explore", "parcourir", "browse", "collection"]),
    (Role::Features, &["fonctionnalités", "features", "avantages", "benefits", "pourquoi", "why ", "tout ce dont", "everything you need", "funktionen"]),
    (Role::Cta, &["commencez", "commencer", "get started", "start ", "inscri", "rejoign", "join", "essai", "try ", "contact", "demo", "démo"]),
];

pub fn role_of(title: &str, text: &str, is_hero: bool) -> Role {
    if is_hero {
        return Role::Hero;
    }
    let find = |hay: &str| {
        let hay = format!("{} ", hay.to_lowercase());
        ROLE_WORDS.iter().find(|(_, words)| words.iter().any(|w| hay.contains(w))).map(|(r, _)| r.clone())
    };
    find(title).or_else(|| find(&text.chars().take(300).collect::<String>())).unwrap_or(Role::Other)
}

/// Sections of a page, in order. A section is a `<section>` with a heading;
/// pages without `<section>` are split on their `<h2>`.
pub fn sections_of(html: &str) -> Vec<Section> {
    let body = first_element(html, "body").unwrap_or(html);
    let lower = body.to_ascii_lowercase();
    let marker = if lower.contains("<section") { "<section" } else { "<h2" };
    let starts: Vec<usize> = lower.match_indices(marker).map(|(i, _)| i).collect();
    let mut out = Vec::new();
    for (k, &s) in starts.iter().enumerate() {
        let end = starts.get(k + 1).copied().unwrap_or(body.len());
        let chunk = &body[s..end];
        let heading = ["h1", "h2", "h3"].iter().find_map(|h| first_element(chunk, h).map(|t| (*h, text_of(t))));
        let Some((level, title)) = heading.filter(|(_, t)| !t.is_empty()) else { continue };
        let text: String = text_of(chunk).chars().take(400).collect();
        out.push(Section { role: role_of(&title, &text, level == "h1" && out.is_empty()), title, text });
    }
    out
}

// ---------- commands ----------

fn client_for(url: &Url) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder().timeout(Duration::from_secs(10)).user_agent("goScreen site reader");
    if !is_local_origin(&url.origin().ascii_serialization()) {
        b = b.dns_resolver(Arc::new(PublicResolver));
    }
    b.build().map_err(|e| e.to_string())
}

async fn get_text(client: &reqwest::Client, url: &Url) -> Option<String> {
    let resp = client.get(url.clone()).send().await.ok()?;
    resp.status().is_success().then_some(())?;
    resp.text().await.ok()
}

fn parse_http(url: &str) -> Result<Url, String> {
    let u = Url::parse(url).map_err(|e| format!("invalid URL: {e}"))?;
    matches!(u.scheme(), "http" | "https").then_some(u).ok_or_else(|| "Only http and https sites can be read.".into())
}

#[tauri::command]
pub async fn site_brand(url: String) -> Result<Brand, String> {
    let home = parse_http(&url)?;
    let client = client_for(&home)?;
    let html = get_text(&client, &home).await.ok_or_else(|| format!("Could not load {home}"))?;
    let meta = page_meta(&html);
    let mut css = String::new();
    for href in meta.stylesheets.iter().take(6) {
        if let Some(text) = home.join(href).ok().as_ref().map(|u| get_text(&client, u)) {
            css.push_str(&text.await.unwrap_or_default());
            css.push('\n');
        }
    }
    let logo = meta.icons.first().and_then(|h| home.join(h).ok()).or_else(|| home.join("/favicon.ico").ok());
    let logo_svg = match &logo {
        Some(u) if u.path().ends_with(".svg") => get_text(&client, u).await,
        _ => None,
    };
    Ok(brand_from(meta, &css, logo_svg.as_deref(), logo.map(|u| u.to_string())))
}

#[tauri::command]
pub async fn site_sections(url: String) -> Result<Vec<Section>, String> {
    let page = parse_http(&url)?;
    let html = get_text(&client_for(&page)?, &page).await.ok_or_else(|| format!("Could not load {page}"))?;
    Ok(sections_of(&html))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = include_str!("../../../tests/fixtures/oeufsdor-home.html");
    const CSS: &str = include_str!("../../../tests/fixtures/oeufsdor.css");
    const ICON: &str = include_str!("../../../tests/fixtures/oeufsdor-favicon.svg");

    #[test]
    fn reads_the_reference_brand() {
        let meta = page_meta(HOME);
        assert_eq!(meta.stylesheets.len(), 1);
        assert_eq!(meta.icons, ["/favicon.svg"]);
        let b = brand_from(meta, CSS, Some(ICON), Some("https://x/favicon.svg".into()));
        assert_eq!(b.name, "OEUF D'OR");
        assert_eq!(b.lang.as_deref(), Some("fr"));
        assert!(b.tagline.unwrap().starts_with("Consultez les disponibilités dans votre zone, trouvez"));
        assert!(b.description.unwrap().starts_with("Place de marché avicole"));
        assert_eq!(b.colors.primary.as_deref(), Some("#e9a100"));
        assert_eq!(b.colors.background.as_deref(), Some("#f7f7f2"));
        assert_eq!(b.colors.ink.as_deref(), Some("#16241c"));
        assert_eq!(b.colors.accent.as_deref(), Some("#fcefc7"));
        assert_eq!(b.fonts.heading.as_deref(), Some("Bricolage Grotesque Variable"));
        assert_eq!(b.fonts.body.as_deref(), Some("Atkinson Hyperlegible"));
    }

    #[test]
    fn finds_the_role_of_each_reference_section() {
        let roles: Vec<(Role, String)> = sections_of(HOME).into_iter().map(|s| (s.role, s.title)).collect();
        let only: Vec<Role> = roles.iter().map(|(r, _)| r.clone()).collect();
        assert_eq!(
            only,
            [Role::Hero, Role::Listing, Role::Pricing, Role::Listing, Role::Stats, Role::Testimonials, Role::HowItWorks],
            "{roles:?}"
        );
    }

    #[test]
    fn a_dark_saas_without_css_vars_falls_back_on_meta_and_logo() {
        let html = r##"<html lang="en"><head><title>Acme | Ship faster</title>
            <meta name="theme-color" content="#0B0D12"><link rel="icon" href="/logo.svg">
            <style>:root{--primary: 262 83% 58%} .dark{--primary:#fff} h1,h2{font-family:'Inter Display',sans-serif}</style>
            </head><body><main><h1>Ship &amp; scale</h1><h2>Pricing</h2><p>$12 per month</p>
            <h2>Loved by teams</h2><p>Trusted by 3,000 companies</p></main></body></html>"##;
        let b = brand_from(page_meta(html), "", Some(r##"<svg><path fill="#FFFFFF"/><path fill="#7C3AED"/></svg>"##), None);
        assert_eq!(b.name, "Acme");
        assert_eq!(b.tagline.as_deref(), Some("Ship & scale"));
        assert_eq!(b.colors.primary.as_deref(), Some("hsl(262 83% 58%)"));
        assert_eq!(b.colors.background.as_deref(), Some("#0b0d12"));
        assert_eq!(b.fonts.heading.as_deref(), Some("Inter Display"));
        let roles: Vec<Role> = sections_of(html).into_iter().map(|s| s.role).collect();
        assert_eq!(roles, [Role::Pricing, Role::Testimonials]);
        assert_eq!(svg_brand_color(r##"<svg fill="#fff"><g stroke="#7c3aed"/></svg>"##).as_deref(), Some("#7c3aed"));
    }

    #[test]
    fn resolves_var_chains_and_decodes_entities() {
        let vars = HashMap::from([("--a".to_string(), "var(--b)".to_string()), ("--b".to_string(), "#123".to_string())]);
        assert_eq!(resolve("var(--a)", &vars).as_deref(), Some("#123"));
        assert_eq!(resolve("var(--missing, red)", &vars).as_deref(), Some("red"));
        assert_eq!(resolve("var(--missing)", &vars), None);
        assert_eq!(decode_entities("D&#x27;OR &amp; co &#39;x&#39; & y"), "D'OR & co 'x' & y");
        assert_eq!(text_of("<p>a<!-- c --><b>b</b><script>x</script></p>"), "a b");
    }
}
