use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvType {
    Container,
    Vm,
    Physical,
    Unknown,
}

impl EnvType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Container => "container",
            Self::Vm => "vm",
            Self::Physical => "physical",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectionResult {
    pub env_type: EnvType,
    pub runtime: Option<String>,
    pub host_virtualization_hint: Option<String>,
}

pub fn detect_environment() -> DetectionResult {
    // 1. Detect OpenVZ / Virtuozzo
    if Path::new("/proc/vz").exists() {
        let is_container = !Path::new("/proc/bc").exists() || Path::new("/proc/vz/veinfo").exists();
        return DetectionResult {
            env_type: if is_container {
                EnvType::Container
            } else {
                EnvType::Vm
            },
            runtime: Some("openvz".to_string()),
            host_virtualization_hint: Some("openvz".to_string()),
        };
    }

    // 2. Detect Container (Docker, Podman, LXC, etc.)
    if let Some(runtime) = detect_container_signals() {
        let virt_hint = detect_hypervisor();
        return DetectionResult {
            env_type: EnvType::Container,
            runtime: Some(runtime),
            host_virtualization_hint: virt_hint,
        };
    }

    // 3. Detect Hypervisor / VM
    let virt_hint = detect_hypervisor();
    if let Some(hint) = virt_hint {
        return DetectionResult {
            env_type: EnvType::Vm,
            runtime: None,
            host_virtualization_hint: Some(hint),
        };
    }

    // 4. Fallback: Physical / Unknown
    DetectionResult {
        env_type: EnvType::Physical,
        runtime: None,
        host_virtualization_hint: None,
    }
}

fn detect_container_signals() -> Option<String> {
    if Path::new("/.dockerenv").exists() {
        return Some("docker".to_string());
    }

    if Path::new("/run/.containerenv").exists() {
        return Some("podman".to_string());
    }

    if Path::new("/run/systemd/container").exists() {
        if let Ok(content) = fs::read_to_string("/run/systemd/container") {
            let trimmed = content.trim().to_lowercase();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }

    // Check /proc/1/environ for container=xxx
    if let Ok(environ) = fs::read("/proc/1/environ") {
        let env_str = String::from_utf8_lossy(&environ);
        for var in env_str.split('\0') {
            if let Some(val) = var.strip_prefix("container=") {
                let trimmed = val.trim().to_lowercase();
                if !trimmed.is_empty() {
                    return Some(trimmed);
                }
            }
        }
    }

    // Check /proc/self/cgroup & /proc/1/cgroup
    for cgroup_file in &["/proc/1/cgroup", "/proc/self/cgroup"] {
        if let Ok(content) = fs::read_to_string(cgroup_file) {
            let lower = content.to_lowercase();
            if lower.contains("docker") {
                return Some("docker".to_string());
            }
            if lower.contains("libpod") {
                return Some("podman".to_string());
            }
            if lower.contains("lxc") {
                return Some("lxc".to_string());
            }
            if lower.contains("kubepods") {
                return Some("docker".to_string()); // or containerd
            }
            if lower.contains("containerd") {
                return Some("docker".to_string());
            }
        }
    }

    // Check root mount in /proc/self/mountinfo
    if let Ok(mountinfo) = fs::read_to_string("/proc/self/mountinfo") {
        for line in mountinfo.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Typical mountinfo line has mountpoint at index 4 (0-based)
            if parts.len() > 8 && parts[4] == "/" {
                let lower = line.to_lowercase();
                if lower.contains("overlay")
                    || lower.contains("docker")
                    || lower.contains("containerd")
                {
                    return Some("unknown".to_string());
                }
            }
        }
    }

    None
}

fn detect_hypervisor() -> Option<String> {
    // 1. Check /sys/hypervisor/type
    if let Ok(content) = fs::read_to_string("/sys/hypervisor/type") {
        let trimmed = content.trim().to_lowercase();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }

    // 2. Check DMI product_name and sys_vendor
    let dmi_paths = [
        "/sys/class/dmi/id/product_name",
        "/sys/class/dmi/id/sys_vendor",
        "/sys/class/dmi/id/board_vendor",
        "/sys/class/dmi/id/bios_vendor",
    ];

    for path in &dmi_paths {
        if let Ok(content) = fs::read_to_string(path) {
            let lower = content.to_lowercase();
            if lower.contains("kvm") {
                return Some("kvm".to_string());
            }
            if lower.contains("qemu") {
                return Some("qemu".to_string());
            }
            if lower.contains("vmware") {
                return Some("vmware".to_string());
            }
            if lower.contains("virtualbox") || lower.contains("innotek") {
                return Some("virtualbox".to_string());
            }
            if lower.contains("hyper-v") || lower.contains("microsoft corporation") {
                return Some("hyperv".to_string());
            }
            if lower.contains("xen") {
                return Some("xen".to_string());
            }
            if lower.contains("bhyve") {
                return Some("bhyve".to_string());
            }
            if lower.contains("amazon ec2") {
                return Some("kvm".to_string());
            }
        }
    }

    // 3. Check /proc/cpuinfo flags
    if let Ok(cpuinfo) = fs::read_to_string("/proc/cpuinfo") {
        let lower = cpuinfo.to_lowercase();
        if lower.contains("hypervisor") {
            if lower.contains("kvm") {
                return Some("kvm".to_string());
            }
            if lower.contains("qemu") {
                return Some("qemu".to_string());
            }
            if lower.contains("vmware") {
                return Some("vmware".to_string());
            }
            if lower.contains("xen") {
                return Some("xen".to_string());
            }
            return Some("unknown".to_string());
        }
    }

    None
}
