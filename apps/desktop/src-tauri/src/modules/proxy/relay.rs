//! Cross-origin relay. A previewed page lives on 127.0.0.1, so APIs that only
//! allow the real site's origin (CORS) refuse it. The bridge sends such
//! fetch/XHR calls to `/__goscreen/relay?u=<url>` on the page's own listener;
//! the proxy replays them with the real site as Origin. Pure rules here.

use std::net::IpAddr;

use url::Url;

pub const RELAY_PATH: &str = "/__goscreen/relay";

/// Response headers that make no sense once the call is same-origin.
pub const DROPPED_RELAY_RESPONSE_HEADERS: &[&str] = &[
    "access-control-allow-origin",
    "access-control-allow-credentials",
    "access-control-allow-headers",
    "access-control-allow-methods",
    "access-control-expose-headers",
    "access-control-max-age",
    "set-cookie",
];

/// The `u` parameter of a relay query string.
pub fn relay_param(query: Option<&str>) -> Option<String> {
    url::form_urlencoded::parse(query?.as_bytes()).find(|(k, _)| k == "u").map(|(_, v)| v.into_owned())
}

/// Loopback, private, link-local and similar: never reachable through the relay,
/// or a website in a device frame could probe the user's machine and network.
pub fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()
                // 100.64.0.0/10 (CGNAT, Tailscale)
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                || v6.to_ipv4_mapped().is_some_and(|v4| is_private(IpAddr::V4(v4)))
        }
    }
}

/// What the relay may call: http(s), a public host. `allow_local` is set when
/// the previewed site is itself local (a dev server calling its local API).
pub fn relay_target(raw: &str, allow_local: bool) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Invalid relay URL.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only http and https can be relayed.".into());
    }
    let host = url.host_str().ok_or("Relay URL has no host.")?;
    if !allow_local {
        let bare = host.trim_start_matches('[').trim_end_matches(']');
        if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
            return Err("Local addresses cannot be relayed.".into());
        }
        if let Ok(ip) = bare.parse::<IpAddr>() {
            if is_private(ip) {
                return Err("Private addresses cannot be relayed.".into());
            }
        }
    }
    Ok(url)
}

/// A redirect from the relayed API stays on the relay.
pub fn relay_location(base: &Url, location: &str) -> Option<String> {
    let next = base.join(location).ok()?;
    let encoded: String = url::form_urlencoded::byte_serialize(next.as_str().as_bytes()).collect();
    Some(format!("{RELAY_PATH}?u={encoded}"))
}

/// Whether the previewed origin is a local dev server.
pub fn is_local_origin(origin: &str) -> bool {
    Url::parse(origin)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .is_some_and(|h| {
            h == "localhost" || h.ends_with(".localhost") || h.parse::<IpAddr>().is_ok_and(is_private)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relays_public_https_apis() {
        let u = relay_target("https://oeufsdor-api.vercel.app/api/v1/offers?zone=1", false).unwrap();
        assert_eq!(u.host_str(), Some("oeufsdor-api.vercel.app"));
    }

    #[test]
    fn refuses_local_and_private_targets() {
        for bad in [
            "http://localhost:8080/",
            "http://127.0.0.1/",
            "http://10.0.0.2/admin",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/",
            "http://100.100.1.1/",
            "file:///etc/passwd",
            "http://printer.local/",
        ] {
            assert!(relay_target(bad, false).is_err(), "{bad} should be refused");
        }
        assert!(relay_target("http://localhost:4000/api", true).is_ok());
    }

    #[test]
    fn reads_the_target_and_keeps_redirects_on_the_relay() {
        assert_eq!(relay_param(Some("u=https%3A%2F%2Fa.com%2Fx%3Fy%3D1")), Some("https://a.com/x?y=1".into()));
        assert_eq!(relay_param(Some("v=1")), None);
        let base = Url::parse("https://api.a.com/v1/offers").unwrap();
        assert_eq!(relay_location(&base, "/v1/offers/").unwrap(), "/__goscreen/relay?u=https%3A%2F%2Fapi.a.com%2Fv1%2Foffers%2F");
    }

    #[test]
    fn knows_local_dev_origins() {
        assert!(is_local_origin("http://localhost:3000"));
        assert!(is_local_origin("http://127.0.0.1:5173"));
        assert!(!is_local_origin("https://oeufsdor.vercel.app"));
    }
}
