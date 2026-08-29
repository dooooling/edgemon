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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CpuMetrics {
    pub usage_pct: Option<f64>,
    pub throttled_pct: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temp_celsius: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load1: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load5: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load15: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_total_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_running_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct MemoryMetrics {
    pub used_bytes: Option<u64>,
    pub working_set_bytes: Option<u64>,
    pub swap_used_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oom_kill_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct MountUsage {
    pub mount_point: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub used_bytes: Option<u64>,
    pub fs_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RootfsMetrics {
    pub used_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mounts: Option<Vec<MountUsage>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DiskIoMetrics {
    pub read_bps: Option<u64>,
    pub write_bps: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_iops: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write_iops: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub io_util_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct NetworkMetrics {
    pub interface: String,
    pub counter_id: Option<String>,
    pub rx_bps: Option<u64>,
    pub tx_bps: Option<u64>,
    pub rx_total_bytes: u64,
    pub tx_total_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tcp_established_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tcp_tw_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tcp_total_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub udp_in_use: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProbeResult {
    pub id: String,
    pub status: String, // ok | timeout | dns_error | permission_denied | connect_error | unsupported
    pub latency_ms: Option<f64>,
    pub loss_ratio: f64,
}
