use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetricSample {
    pub sample_seq: u64,
    pub sampled_at_ms: u64,
    pub metrics: ReportData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReportPayload {
    pub samples: Vec<MetricSample>,
    #[serde(default)]
    pub dropped_samples: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReportData {
    pub config_rev: u64,
    pub boot_id: Option<String>,
    pub cpu: CpuMetrics,
    pub memory: MemoryMetrics,
    pub rootfs: RootfsMetrics,
    pub io: DiskIoMetrics,
    pub network: NetworkMetrics,
    pub uptime_sec: Option<u64>,
    pub probes: Vec<ProbeResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CpuMetrics {
    pub usage_pct: Option<f64>,
    pub throttled_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MemoryMetrics {
    pub used_bytes: Option<u64>,
    pub working_set_bytes: Option<u64>,
    pub swap_used_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RootfsMetrics {
    pub used_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiskIoMetrics {
    pub read_bps: Option<u64>,
    pub write_bps: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NetworkMetrics {
    pub interface: String,
    pub counter_id: Option<String>,
    pub rx_bps: Option<u64>,
    pub tx_bps: Option<u64>,
    pub rx_total_bytes: u64,
    pub tx_total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProbeResult {
    pub id: String,
    pub status: String, // ok | timeout | dns_error | permission_denied | connect_error | unsupported
    pub latency_ms: Option<f64>,
    pub loss_ratio: f64,
}
