use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerConfig {
    #[serde(default = "default_sample_interval")]
    pub sample_interval_sec: u64,
    #[serde(default = "default_stream_interval")]
    pub stream_interval_sec: u64,
    #[serde(default = "default_probe_interval")]
    pub probe_interval_sec: u64,
    #[serde(default = "default_network_interface")]
    pub network_interface: String,
    #[serde(default)]
    pub probes: Vec<ProbeTargetConfig>,
}

fn default_sample_interval() -> u64 {
    30
}
fn default_stream_interval() -> u64 {
    30
}
fn default_probe_interval() -> u64 {
    60
}
fn default_network_interface() -> String {
    "auto".to_string()
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            sample_interval_sec: 2,
            stream_interval_sec: 2,
            probe_interval_sec: 60,
            network_interface: "auto".to_string(),
            probes: Vec::new(),
        }
    }
}

fn default_probe_method() -> String {
    "icmp".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProbeTargetConfig {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(alias = "target")]
    pub host: String,
    #[serde(default = "default_probe_method", alias = "protocol")]
    pub method: String, // icmp | tcp
    #[serde(default)]
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WelcomeData {
    pub config_rev: u64,
    pub config: ServerConfig,
    #[serde(default)]
    pub persisted_instance_id: Option<String>,
    #[serde(default)]
    pub persisted_sample_seq: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConfigData {
    pub config_rev: u64,
    pub config: ServerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConfigAckData {
    pub config_rev: u64,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AckData {
    pub persisted_sample_seq: Option<u64>,
    pub config_rev: u64,
    #[serde(default)]
    pub accepted_seq: Option<u64>,
    #[serde(default)]
    pub persisted_seq: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ErrorData {
    pub code: String,
    pub message: String,
}
