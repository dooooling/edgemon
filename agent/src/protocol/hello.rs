use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HelloData {
    pub agent: AgentInfo,
    pub system: SystemInfo,
    pub environment: EnvironmentInfo,
    pub resources: ResourcesInfo,
    pub sources: MetricSources,
    pub capabilities: CapabilitiesInfo,
    pub boot_id: Option<String>,
    pub network_counter_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentInfo {
    pub version: String,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SystemInfo {
    pub hostname: String,
    pub os: String,
    pub os_version: Option<String>,
    pub kernel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnvironmentInfo {
    #[serde(rename = "type")]
    pub env_type: String, // container | vm | physical | unknown
    pub runtime: Option<String>, // docker | podman | lxc | openvz | unknown
    pub host_virtualization_hint: Option<String>, // kvm | qemu | xen | vmware | hyperv
    pub cgroup_version: Option<u8>, // 1 | 2
    pub resource_scope: String,  // container | machine | unknown
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourcesInfo {
    pub cpu_model_visible: Option<String>,
    pub cpu_capacity_cores: Option<f64>,
    pub memory_limit_bytes: Option<u64>,
    pub swap_limit_bytes: Option<u64>,
    pub rootfs_limit_bytes: Option<u64>,
    pub rootfs_scope: String, // visible_filesystem | unknown
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetricSources {
    pub cpu: String,
    pub memory: String,
    pub io: String,
    pub network: String,
    pub rootfs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapabilitiesInfo {
    pub icmp_probe: bool,
    pub tcp_probe: bool,
}
