use crate::error::{EdgeMonError, Result};
use crate::protocol::ProbeTargetConfig;
use clap::Parser;
use std::fs;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(author, version, about = "EdgeMon Agent - Lightweight Linux & Windows Telemetry Daemon", long_about = None)]
pub struct CliArgs {
    /// Server URL (e.g. https://monitor.example.com or http://127.0.0.1:8787)
    #[arg(short, long, env = "EDGEMON_SERVER")]
    pub server: String,

    /// Node ID (UUID)
    #[arg(short = 'i', long = "id", env = "EDGEMON_NODE_ID")]
    pub node_id: String,

    /// Path to file containing node authentication token
    #[arg(long = "token-file", value_name = "PATH")]
    pub token_file: Option<PathBuf>,

    /// Node authentication token (use --token-file in production)
    #[arg(long = "token", env = "EDGEMON_TOKEN", hide_env_values = true)]
    pub token: Option<String>,

    /// Allow insecure HTTP / WS server URLs (for local testing only)
    #[arg(long = "allow-http", default_value_t = false)]
    pub allow_http: bool,

    /// Allow probing private and loopback IP addresses
    #[arg(long = "allow-private-probes", default_value_t = false)]
    pub allow_private_probes: bool,

    /// Enable simulated telemetry metrics for local development & UI verification
    #[arg(long = "mock", default_value_t = false)]
    pub mock: bool,
}

#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub server_url: String,
    pub node_id: String,
    pub token: String,
    pub allow_http: bool,
    pub allow_private_probes: bool,
    pub mock: bool,

    // Dynamic configuration (updated via Welcome / WSS Config Push)
    pub sample_interval_sec: u64,
    pub stream_interval_sec: u64,
    pub probe_interval_sec: u64,
    pub network_interface: String,
    pub probes: Vec<ProbeTargetConfig>,
    pub config_rev: u64,
}

impl AgentConfig {
    pub fn from_cli(cli: CliArgs) -> Result<Self> {
        // Enforce HTTPS unless explicitly permitted
        if !cli.allow_http
            && !cli.server.starts_with("https://")
            && !cli.server.starts_with("wss://")
        {
            return Err(EdgeMonError::Config(
                "Production server URL must use HTTPS / WSS. Pass --allow-http for local testing only.".into(),
            ));
        }

        // Resolve token: token-file > CLI/Env token
        let token = if let Some(path) = &cli.token_file {
            let content = fs::read_to_string(path).map_err(|e| {
                EdgeMonError::Config(format!("Failed to read token file {}: {e}", path.display()))
            })?;
            content.trim().to_string()
        } else if let Some(tok) = cli.token {
            tok.trim().to_string()
        } else {
            return Err(EdgeMonError::Config(
                "Authentication token must be provided via --token-file or EDGEMON_TOKEN environment variable.".into(),
            ));
        };

        if token.is_empty() {
            return Err(EdgeMonError::Config("Token cannot be empty".into()));
        }

        Ok(Self {
            server_url: cli.server.trim_end_matches('/').to_string(),
            node_id: cli.node_id,
            token,
            allow_http: cli.allow_http,
            allow_private_probes: cli.allow_private_probes,
            mock: cli.mock,

            // Default baseline values (2s real-time streaming)
            sample_interval_sec: 2,
            stream_interval_sec: 2,
            probe_interval_sec: 60,
            network_interface: "auto".to_string(),
            probes: Vec::new(),
            config_rev: 0,
        })
    }
}
