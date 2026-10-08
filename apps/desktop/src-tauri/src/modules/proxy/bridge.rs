use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConfig<'a> {
    pub origin: &'a str,
    pub proxy_origin: &'a str,
    pub user_agent: &'a str,
    pub touch: bool,
}

const TEMPLATE: &str = include_str!("bridge.js");

pub fn bridge_script(cfg: &BridgeConfig) -> String {
    let json = serde_json::to_string(cfg).expect("bridge config serializes");
    TEMPLATE.replace("__GOSCREEN_CONFIG__", &json)
}
