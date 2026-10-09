//! Local preview proxy. Each (origin, user agent) pair gets its own
//! 127.0.0.1 listener so root-relative URLs resolve and every proxied site
//! keeps a distinct browser origin.

use std::{collections::HashMap, future::Future, pin::Pin, sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::Response,
    Router,
};
use serde::Serialize;
use tokio::sync::Mutex;
use url::Url;

use super::bridge::{bridge_script, BridgeConfig};
use super::relay::{
    is_local_origin, relay_location, PublicResolver, relay_param, relay_target, DROPPED_RELAY_RESPONSE_HEADERS, RELAY_PATH,
};
use super::rewrite::{
    inject_bridge, is_html, rewrite_origin, rewrite_set_cookie, DROPPED_REQUEST_HEADERS,
    DROPPED_RESPONSE_HEADERS,
};

const MAX_REQUEST_BODY: usize = 64 * 1024 * 1024;

#[derive(Clone, Hash, Eq, PartialEq)]
struct ListenerKey {
    origin: String,
    user_agent: String,
    touch: bool,
}

struct Inner {
    client: reqwest::Client,
    // Cross-origin relay: public addresses only, checked at connect time.
    relay: reqwest::Client,
    probe: reqwest::Client,
    listeners: Mutex<HashMap<ListenerKey, u16>>,
}

pub struct ProxyState(Arc<Inner>);

impl Default for ProxyState {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(60))
            .build()
            .expect("proxy client builds");
        let relay = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .dns_resolver(Arc::new(PublicResolver))
            .timeout(Duration::from_secs(60))
            .build()
            .expect("relay client builds");
        let probe = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(Duration::from_secs(15))
            .build()
            .expect("probe client builds");
        Self(Arc::new(Inner {
            client,
            relay,
            probe,
            listeners: Mutex::new(HashMap::new()),
        }))
    }
}

struct Ctx {
    inner: Arc<Inner>,
    origin: String,
    proxy_origin: String,
    user_agent: String,
    touch: bool,
}

// Boxed so the handler -> listener -> handler cycle has a nameable type.
fn ensure_listener(
    inner: Arc<Inner>,
    key: ListenerKey,
) -> Pin<Box<dyn Future<Output = Result<u16, String>> + Send>> {
    Box::pin(async move {
        let mut listeners = inner.listeners.lock().await;
        if let Some(port) = listeners.get(&key) {
            return Ok(*port);
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("proxy bind failed: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("proxy addr failed: {e}"))?
            .port();
        let ctx = Arc::new(Ctx {
            inner: inner.clone(),
            origin: key.origin.clone(),
            proxy_origin: format!("http://127.0.0.1:{port}"),
            user_agent: key.user_agent.clone(),
            touch: key.touch,
        });
        let app = Router::new().fallback(handle).with_state(ctx);
        tauri::async_runtime::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                log::error!("proxy listener on {port} stopped: {e}");
            }
        });
        log::info!("proxy {} -> 127.0.0.1:{port}", key.origin);
        listeners.insert(key, port);
        Ok(port)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyTarget {
    proxied_url: String,
    url: String,
}

fn path_and_query(url: &Url) -> String {
    match url.query() {
        Some(q) => format!("{}?{q}", url.path()),
        None => url.path().to_string(),
    }
}

#[tauri::command]
pub async fn proxy_open(
    state: tauri::State<'_, ProxyState>,
    url: String,
    user_agent: String,
    touch: bool,
) -> Result<ProxyTarget, String> {
    let target = Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    if !matches!(target.scheme(), "http" | "https") {
        return Err("only http and https URLs can be previewed".into());
    }
    // Land on the post-redirect origin (example.com -> www.example.com) so
    // root-relative assets resolve against the right host.
    let resolved = match state
        .0
        .probe
        .get(target.clone())
        .header(header::USER_AGENT, &user_agent)
        .send()
        .await
    {
        Ok(resp) => resp.url().clone(),
        Err(e) => return Err(format!("could not reach {}: {e}", target.host_str().unwrap_or(""))),
    };
    let key = ListenerKey {
        origin: resolved.origin().ascii_serialization(),
        user_agent,
        touch,
    };
    let port = ensure_listener(state.0.clone(), key).await?;
    let mut proxied_url = format!("http://127.0.0.1:{port}{}", path_and_query(&resolved));
    if let Some(fragment) = resolved.fragment() {
        proxied_url.push('#');
        proxied_url.push_str(fragment);
    }
    Ok(ProxyTarget {
        proxied_url,
        url: resolved.to_string(),
    })
}

async fn handle(State(ctx): State<Arc<Ctx>>, req: Request) -> Response {
    match forward(&ctx, req).await {
        Ok(resp) => resp,
        Err(message) => {
            log::warn!("proxy {}: {message}", ctx.origin);
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(Body::from(format!("goScreen preview proxy: {message}")))
                .expect("static response builds")
        }
    }
}

async fn forward(ctx: &Arc<Ctx>, req: Request) -> Result<Response, String> {
    if req.uri().path() == "/__goscreen/bridge.js" {
        let script = bridge_script(&BridgeConfig {
            origin: &ctx.origin,
            proxy_origin: &ctx.proxy_origin,
            user_agent: &ctx.user_agent,
            touch: ctx.touch,
        });
        return Response::builder()
            .header(header::CONTENT_TYPE, "text/javascript; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::from(script))
            .map_err(|e| e.to_string());
    }

    if req.uri().path() == RELAY_PATH {
        return relay(ctx, req).await;
    }

    let path_q = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "/".into());
    let upstream = format!("{}{}", ctx.origin, path_q);
    let (parts, body) = req.into_parts();
    let body = axum::body::to_bytes(body, MAX_REQUEST_BODY)
        .await
        .map_err(|e| format!("request body: {e}"))?;

    let headers = upstream_headers(ctx, &parts.headers, false);

    let resp = ctx
        .inner
        .client
        .request(parts.method, &upstream)
        .headers(headers)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("upstream {upstream}: {e}"))?;

    let status = resp.status();
    let resp_headers = resp.headers().clone();
    let html = is_html(
        resp_headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
    );

    let mut builder = Response::builder().status(status);
    for (name, value) in resp_headers.iter() {
        if DROPPED_RESPONSE_HEADERS.contains(&name.as_str()) {
            continue;
        }
        if name == header::SET_COOKIE {
            if let Some(v) = value
                .to_str()
                .ok()
                .and_then(|v| HeaderValue::from_str(&rewrite_set_cookie(v)).ok())
            {
                builder = builder.header(name, v);
            }
            continue;
        }
        if name == header::LOCATION {
            if let Some(v) = rewrite_location(ctx, &upstream, value).await {
                builder = builder.header(name, v);
            }
            continue;
        }
        builder = builder.header(name, value);
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("upstream body: {e}"))?;
    let body = if html {
        Body::from(inject_bridge(&String::from_utf8_lossy(&bytes)))
    } else {
        Body::from(bytes)
    };
    builder.body(body).map_err(|e| e.to_string())
}

/// The page's request headers as the real site would send them: its own
/// Origin and Referer, the device user agent. A relayed call carries no
/// cookies: the browser's are for 127.0.0.1, not the API.
fn upstream_headers(ctx: &Ctx, incoming: &HeaderMap, relayed: bool) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for (name, value) in incoming.iter() {
        if DROPPED_REQUEST_HEADERS.contains(&name.as_str()) || (relayed && name == header::COOKIE) {
            continue;
        }
        if name == header::ORIGIN || name == header::REFERER {
            if let Some(v) = value
                .to_str()
                .ok()
                .and_then(|v| rewrite_origin(v, &ctx.proxy_origin, &ctx.origin))
                .and_then(|v| HeaderValue::from_str(&v).ok())
            {
                headers.append(name.clone(), v);
            }
            continue;
        }
        headers.append(name.clone(), value.clone());
    }
    if let Ok(ua) = HeaderValue::from_str(&ctx.user_agent) {
        headers.insert(header::USER_AGENT, ua);
    }
    headers
}

/// Replays a cross-origin fetch/XHR of the page with the real site as Origin,
/// so APIs that only allow that origin answer (see `relay.rs`).
async fn relay(ctx: &Arc<Ctx>, req: Request) -> Result<Response, String> {
    let raw = relay_param(req.uri().query()).ok_or("Relay needs a u= parameter.")?;
    let allow_local = is_local_origin(&ctx.origin);
    let target = relay_target(&raw, allow_local)?;
    // Names are checked by the relay client's resolver at connect time (no
    // rebinding window); IP literals by `relay_target`. Redirects are never
    // followed here: they come back to the relay and are checked again.
    let client = if allow_local { &ctx.inner.client } else { &ctx.inner.relay };
    let (parts, body) = req.into_parts();
    let body = axum::body::to_bytes(body, MAX_REQUEST_BODY)
        .await
        .map_err(|e| format!("request body: {e}"))?;
    let headers = upstream_headers(ctx, &parts.headers, true);
    let resp = client
        .request(parts.method, target.clone())
        .headers(headers)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("relay {target}: {e}"))?;

    let mut builder = Response::builder().status(resp.status());
    for (name, value) in resp.headers().iter() {
        let n = name.as_str();
        if DROPPED_RESPONSE_HEADERS.contains(&n) || DROPPED_RELAY_RESPONSE_HEADERS.contains(&n) {
            continue;
        }
        if name == header::LOCATION {
            if let Some(v) = value.to_str().ok().and_then(|v| relay_location(&target, v)) {
                builder = builder.header(name, v);
            }
            continue;
        }
        builder = builder.header(name, value);
    }
    let bytes = resp.bytes().await.map_err(|e| format!("relay body: {e}"))?;
    builder.body(Body::from(bytes)).map_err(|e| e.to_string())
}

// Same-origin redirects stay on this listener; cross-origin ones (SSO, apex
// to www) get their own listener so the iframe never leaves the proxy.
async fn rewrite_location(ctx: &Arc<Ctx>, upstream: &str, value: &HeaderValue) -> Option<HeaderValue> {
    let raw = value.to_str().ok()?;
    let base = Url::parse(upstream).ok()?;
    let next = base.join(raw).ok()?;
    if !matches!(next.scheme(), "http" | "https") {
        return HeaderValue::from_str(raw).ok();
    }
    let origin = next.origin().ascii_serialization();
    let proxy_origin = if origin == ctx.origin {
        ctx.proxy_origin.clone()
    } else {
        let key = ListenerKey {
            origin,
            user_agent: ctx.user_agent.clone(),
            touch: ctx.touch,
        };
        let port = ensure_listener(ctx.inner.clone(), key).await.ok()?;
        format!("http://127.0.0.1:{port}")
    };
    let mut out = format!("{proxy_origin}{}", path_and_query(&next));
    if let Some(f) = next.fragment() {
        out.push('#');
        out.push_str(f);
    }
    HeaderValue::from_str(&out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;

    async fn upstream() -> String {
        let app = Router::new()
            .route(
                "/",
                get(|| async {
                    Response::builder()
                        .header(header::CONTENT_TYPE, "text/html")
                        .header("x-frame-options", "DENY")
                        .header(header::SET_COOKIE, "sid=1; Secure; SameSite=None")
                        .body(Body::from("<html><head><title>t</title></head></html>"))
                        .unwrap()
                }),
            )
            .route(
                "/go",
                get(|| async {
                    Response::builder()
                        .status(StatusCode::FOUND)
                        .header(header::LOCATION, "/")
                        .body(Body::empty())
                        .unwrap()
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn proxies_html_without_framing_headers() {
        let origin = upstream().await;
        let state = ProxyState::default();
        let key = ListenerKey { origin: origin.clone(), user_agent: "TestUA".into(), touch: true };
        let port = ensure_listener(state.0.clone(), key.clone()).await.unwrap();
        assert_eq!(ensure_listener(state.0.clone(), key).await.unwrap(), port);

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let resp = client.get(format!("http://127.0.0.1:{port}/")).send().await.unwrap();
        assert!(resp.headers().get("x-frame-options").is_none());
        assert_eq!(
            resp.headers().get(header::SET_COOKIE).unwrap(),
            "sid=1; SameSite=Lax"
        );
        let body = resp.text().await.unwrap();
        assert!(body.contains("/__goscreen/bridge.js"));

        let redirect = client.get(format!("http://127.0.0.1:{port}/go")).send().await.unwrap();
        assert_eq!(
            redirect.headers().get(header::LOCATION).unwrap(),
            &format!("http://127.0.0.1:{port}/")
        );

        let bridge = client
            .get(format!("http://127.0.0.1:{port}/__goscreen/bridge.js"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(bridge.contains("\"userAgent\":\"TestUA\""));
        assert!(!bridge.contains("__GOSCREEN_CONFIG__"));
    }
}
