//! Pure response rewriting rules for the preview proxy.

/// Response headers that would stop a page from rendering inside the device
/// iframe, or that no longer hold once the body is re-encoded.
pub const DROPPED_RESPONSE_HEADERS: &[&str] = &[
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "strict-transport-security",
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "alt-svc",
];

pub const DROPPED_REQUEST_HEADERS: &[&str] = &[
    "host",
    "connection",
    "accept-encoding",
    "content-length",
    "user-agent",
];

/// The proxy serves plain http on 127.0.0.1, so `Secure` and `Domain` would
/// make the browser drop the cookie entirely.
pub fn rewrite_set_cookie(value: &str) -> String {
    value
        .split(';')
        .map(str::trim)
        .filter(|part| {
            let lower = part.to_ascii_lowercase();
            !(lower == "secure" || lower.starts_with("domain=") || lower == "partitioned")
        })
        .map(|part| {
            if part.eq_ignore_ascii_case("samesite=none") {
                "SameSite=Lax"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Swaps `from` origin for `to` origin when `value` starts with it.
pub fn rewrite_origin(value: &str, from: &str, to: &str) -> Option<String> {
    let rest = value.strip_prefix(from)?;
    if rest.is_empty() || rest.starts_with('/') || rest.starts_with('?') || rest.starts_with('#') {
        Some(format!("{to}{rest}"))
    } else {
        None
    }
}

const BRIDGE_TAG: &str = "<script src=\"/__goscreen/bridge.js\"></script>";

/// Inserts the bridge as the first script so it observes the page from the
/// start, before any app code can install its own listeners.
pub fn inject_bridge(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let insert_at = lower
        .find("<head")
        .and_then(|i| lower[i..].find('>').map(|j| i + j + 1))
        .or_else(|| {
            lower
                .find("<html")
                .and_then(|i| lower[i..].find('>').map(|j| i + j + 1))
        })
        .unwrap_or(0);
    let mut out = String::with_capacity(html.len() + BRIDGE_TAG.len());
    out.push_str(&html[..insert_at]);
    out.push_str(BRIDGE_TAG);
    out.push_str(&html[insert_at..]);
    out
}

pub fn is_html(content_type: Option<&str>) -> bool {
    content_type
        .map(|ct| ct.to_ascii_lowercase().starts_with("text/html"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_loses_secure_and_domain() {
        let out = rewrite_set_cookie("sid=1; Domain=.example.com; Path=/; Secure; HttpOnly; SameSite=None");
        assert_eq!(out, "sid=1; Path=/; HttpOnly; SameSite=Lax");
    }

    #[test]
    fn origin_rewrite_respects_boundaries() {
        let from = "https://example.com";
        let to = "http://127.0.0.1:5000";
        assert_eq!(
            rewrite_origin("https://example.com/a?b", from, to).as_deref(),
            Some("http://127.0.0.1:5000/a?b")
        );
        assert_eq!(rewrite_origin("https://example.com.evil.io/", from, to), None);
        assert_eq!(rewrite_origin("https://other.com/", from, to), None);
    }

    #[test]
    fn bridge_goes_right_after_head() {
        let out = inject_bridge("<!doctype html><HTML><Head lang=x><title>t</title></head>");
        assert!(out.contains("<Head lang=x><script src=\"/__goscreen/bridge.js\"></script><title>"));
    }

    #[test]
    fn bridge_falls_back_to_start() {
        assert!(inject_bridge("<p>hi</p>").starts_with("<script"));
    }
}
