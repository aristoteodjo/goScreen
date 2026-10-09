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

/// Anything that is not a public internet address: never reachable through
/// the relay, or a website in a device frame could probe the user's machine
/// and network. IPv4 hidden in IPv6 (mapped, NAT64, 6to4) is checked too.
pub fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, c, _] = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || a == 0 // 0.0.0.0/8
                || a >= 240 // reserved
                || (a == 100 && (b & 0xc0) == 64) // 100.64.0.0/10 CGNAT, Tailscale
                || (a == 192 && b == 0 && c == 0) // 192.0.0.0/24 protocol assignments
                || (a == 198 && (b & 0xfe) == 18) // 198.18.0.0/15 benchmarking
        }
        IpAddr::V6(v6) => {
            let s = v6.segments();
            let embedded_v4 = |hi: u16, lo: u16| IpAddr::V4(std::net::Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8));
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80 // link local
                || (s[0] & 0xffc0) == 0xfec0 // site local (deprecated)
                || v6.to_ipv4_mapped().is_some_and(|v4| is_private(IpAddr::V4(v4)))
                || (s[0] == 0x64 && s[1] == 0xff9b && is_private(embedded_v4(s[6], s[7]))) // NAT64
                || (s[0] == 0x2002 && is_private(embedded_v4(s[1], s[2]))) // 6to4
        }
    }
}

/// DNS for the relay: private answers are dropped at connect time, so a
/// name cannot pass a check and then rebind to 127.0.0.1 for the request.
pub struct PublicResolver;

impl reqwest::dns::Resolve for PublicResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let public: Vec<std::net::SocketAddr> =
                tokio::net::lookup_host((host.as_str(), 0)).await?.filter(|a| !is_private(a.ip())).collect();
            if public.is_empty() {
                return Err(format!("{host} only resolves to private addresses").into());
            }
            Ok(Box::new(public.into_iter()) as reqwest::dns::Addrs)
        })
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
    fn refuses_every_non_public_range() {
        for ip in [
            "0.1.2.3", "224.0.0.1", "240.0.0.1", "198.18.0.5", "192.0.0.8", "100.64.0.1",
            "::ffff:127.0.0.1", "64:ff9b::a00:1", "2002:c0a8:101::", "fec0::1", "ff02::1", "fd00::1",
        ] {
            assert!(is_private(ip.parse().unwrap()), "{ip} should be private");
        }
        for ip in ["8.8.8.8", "76.76.21.21", "2606:4700::1111"] {
            assert!(!is_private(ip.parse().unwrap()), "{ip} is public");
        }
        // Odd IPv4 spellings are normalized by the URL parser before the check.
        for bad in ["http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://[::ffff:7f00:1]/"] {
            assert!(relay_target(bad, false).is_err(), "{bad} should be refused");
        }
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
