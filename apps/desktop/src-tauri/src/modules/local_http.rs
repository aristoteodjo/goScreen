//! Shared guards for the app's own 127.0.0.1 servers (media, Android
//! stream). Previewed sites also live on 127.0.0.1 ports, so URLs must be
//! unguessable and responses readable only by the app itself.

use axum::http::{header, HeaderMap, HeaderValue};

/// Origins the studio webview runs under (prod macOS/Linux, prod Windows, dev).
const APP_ORIGINS: &[&str] = &["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1430"];

/// 128-bit capability token from the OS CSPRNG.
pub fn token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// CORS decision. No Origin (plain `<img>`/`<video>`) is allowed but gets no
/// CORS header, so other pages cannot read pixels; a foreign Origin is refused.
pub fn allowed_origin(headers: &HeaderMap) -> Result<Option<HeaderValue>, ()> {
    match headers.get(header::ORIGIN) {
        None => Ok(None),
        Some(v) if v.to_str().is_ok_and(|o| APP_ORIGINS.contains(&o)) => Ok(Some(v.clone())),
        Some(_) => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_and_long() {
        let (a, b) = (token(), token());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }

    #[test]
    fn only_the_app_origin_may_read() {
        let mut h = HeaderMap::new();
        assert_eq!(allowed_origin(&h), Ok(None));
        h.insert(header::ORIGIN, HeaderValue::from_static("tauri://localhost"));
        assert!(allowed_origin(&h).unwrap().is_some());
        h.insert(header::ORIGIN, HeaderValue::from_static("http://127.0.0.1:51234"));
        assert_eq!(allowed_origin(&h), Err(()));
    }
}
