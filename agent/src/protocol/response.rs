use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerConfig {
    pub sample_interval_sec: u64,
    pub report_interval_sec: u64,
    pub probe_interval_sec: u64,
    pub network_interface: String,
    #[serde(default)]
    pub probes: Vec<ProbeTargetConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProbeTargetConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub method: String, // icmp | tcp
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RealtimeHint {
    pub interval_sec: u64,
    pub lease_sec: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WelcomeData {
    pub config_rev: u64,
    pub config: ServerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AckData {
    pub config_rev: u64,
    pub config: Option<ServerConfig>,
    pub realtime: Option<RealtimeHint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ErrorData {
    pub code: String,
    pub message: String,
}
