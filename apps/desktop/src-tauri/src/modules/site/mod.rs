//! Site tour discovery: which pages of a site to visit, from its sitemap and
//! its own links. Parsing is pure; only `site_pages` touches the network.

pub mod brand;

use std::{collections::HashSet, time::Duration};

use url::Url;

const ASSET_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "css", "js", "mjs", "map", "json", "xml",
    "txt", "pdf", "zip", "mp4", "webm", "mp3", "woff", "woff2", "ttf", "otf",
];

/// A page worth visiting: same origin, http(s), not an asset, no fragment.
pub fn page_url(raw: &str, base: &Url) -> Option<Url> {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with('#') || raw.starts_with("javascript:") {
        return None;
    }
    let mut url = base.join(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.origin() != base.origin() {
        return None;
    }
    url.set_fragment(None);
    let last = url.path().rsplit('/').next().unwrap_or("");
    if let Some((_, ext)) = last.rsplit_once('.') {
        if ASSET_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) {
            return None;
        }
    }
    Some(url)
}

/// `<loc>` entries of a sitemap (or sitemap index).
pub fn sitemap_locs(xml: &str) -> Vec<String> {
    xml.split("<loc>")
        .skip(1)
        .filter_map(|part| part.split_once("</loc>").map(|(loc, _)| loc.trim().replace("&amp;", "&")))
        .collect()
}

/// `href` values of `<a>` tags, in document order.
pub fn anchor_hrefs(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut from = 0;
    while let Some(start) = lower[from..].find("<a") {
        let tag_start = from + start;
        let Some(end) = lower[tag_start..].find('>') else { break };
        let tag = &html[tag_start..tag_start + end];
        let tag_lower = &lower[tag_start..tag_start + end];
        // "<a " or "<a\n", not "<abbr" or "<article".
        if tag_lower[2..].starts_with(|c: char| c.is_whitespace()) {
            if let Some(i) = tag_lower.find("href=") {
                let rest = &tag[i + 5..];
                let value = match rest.chars().next() {
                    Some(q @ ('"' | '\'')) => rest[1..].split(q).next(),
                    _ => rest.split(|c: char| c.is_whitespace()).next(),
                };
                if let Some(v) = value {
                    out.push(v.replace("&amp;", "&"));
                }
            }
        }
        from = tag_start + end;
    }
    out
}

/// Keeps one URL per path+query, home first, at most `limit`.
pub fn dedupe(urls: impl IntoIterator<Item = Url>, home: &Url, limit: usize) -> Vec<Url> {
    let key = |u: &Url| format!("{}?{}", u.path().trim_end_matches('/'), u.query().unwrap_or(""));
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for u in std::iter::once(home.clone()).chain(urls) {
        if out.len() >= limit {
            break;
        }
        if seen.insert(key(&u)) {
            out.push(u);
        }
    }
    out
}

async fn fetch(client: &reqwest::Client, url: &Url) -> Option<String> {
    let resp = client.get(url.clone()).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

/// Pages for a site tour: the sitemap when there is one, otherwise the
/// links found on the home page and on the pages it links to.
#[tauri::command]
pub async fn site_pages(url: String, limit: Option<usize>) -> Result<Vec<String>, String> {
    let home = Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    if !matches!(home.scheme(), "http" | "https") {
        return Err("Only http and https sites can be toured.".into());
    }
    let limit = limit.unwrap_or(30).clamp(1, 100);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("goScreen site tour")
        .build()
        .map_err(|e| e.to_string())?;

    let mut found: Vec<Url> = Vec::new();
    if let Ok(sitemap) = home.join("/sitemap.xml") {
        if let Some(xml) = fetch(&client, &sitemap).await {
            found.extend(sitemap_locs(&xml).iter().filter_map(|l| page_url(l, &home)));
        }
    }
    if found.is_empty() {
        let html = fetch(&client, &home).await.ok_or_else(|| format!("Could not load {home}"))?;
        let first: Vec<Url> = anchor_hrefs(&html).iter().filter_map(|h| page_url(h, &home)).collect();
        found.extend(first.clone());
        for page in dedupe(first, &home, limit).into_iter().skip(1) {
            if found.len() >= limit * 3 {
                break;
            }
            if let Some(html) = fetch(&client, &page).await {
                found.extend(anchor_hrefs(&html).iter().filter_map(|h| page_url(h, &page)));
            }
        }
    }
    Ok(dedupe(found, &home, limit).into_iter().map(|u| u.to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("https://shop.example/").unwrap()
    }

    #[test]
    fn keeps_same_origin_pages_only() {
        let b = base();
        assert_eq!(page_url("/offres?x=1#top", &b).unwrap().as_str(), "https://shop.example/offres?x=1");
        assert!(page_url("https://other.example/", &b).is_none());
        assert!(page_url("/assets/app.js", &b).is_none());
        assert!(page_url("/favicon.svg", &b).is_none());
        assert!(page_url("#classement", &b).is_none());
        assert!(page_url("mailto:hi@shop.example", &b).is_none());
        assert!(page_url("/packs/annee", &b).is_some());
    }

    #[test]
    fn reads_sitemaps_and_anchors() {
        let xml = "<urlset><url><loc>https://shop.example/</loc></url><url><loc> https://shop.example/a?b=1&amp;c=2 </loc></url></urlset>";
        assert_eq!(sitemap_locs(xml), ["https://shop.example/", "https://shop.example/a?b=1&c=2"]);
        let html = r#"<abbr href="/no"></abbr><a class="x" href="/offres">x</a><A HREF='/packs'>p</A><a href=/raw>r</a><article></article>"#;
        assert_eq!(anchor_hrefs(html), ["/offres", "/packs", "/raw"]);
    }

    #[test]
    fn dedupes_with_home_first() {
        let b = base();
        let urls = ["/b", "/", "/b/", "/c"].iter().filter_map(|u| page_url(u, &b));
        let out: Vec<String> = dedupe(urls, &b, 10).iter().map(|u| u.path().to_string()).collect();
        assert_eq!(out, ["/", "/b", "/c"]);
        assert_eq!(dedupe(std::iter::empty(), &b, 1).len(), 1);
    }
}
