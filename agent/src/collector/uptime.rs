use crate::env::detect::EnvType;
#[cfg(not(windows))]
use std::fs;
#[cfg(not(windows))]
use std::time::SystemTime;

pub struct UptimeCollector {
    pub env_type: EnvType,
}

impl UptimeCollector {
    pub fn new(env_type: EnvType) -> Self {
        Self { env_type }
    }

    pub fn sample(&self) -> Option<u64> {
        #[cfg(not(windows))]
        {
            if self.env_type == EnvType::Container {
                if let Some(container_uptime) = get_container_uptime_sec() {
                    return Some(container_uptime);
                }
            }
        }

        get_system_uptime_sec()
    }
}

#[cfg(not(windows))]
fn get_container_uptime_sec() -> Option<u64> {
    if let Ok(metadata) = fs::metadata("/proc/1") {
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = SystemTime::now().duration_since(modified) {
                return Some(duration.as_secs());
            }
        }
    }
    None
}

pub fn get_system_uptime_sec() -> Option<u64> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::GetTickCount64;
        unsafe {
            let ms = GetTickCount64();
            Some(ms / 1000)
        }
    }

    #[cfg(not(windows))]
    {
        let content = fs::read_to_string("/proc/uptime").ok()?;
        let first_part = content.split_whitespace().next()?;
        let secs_f64 = first_part.parse::<f64>().ok()?;
        Some(secs_f64 as u64)
    }
}

pub fn get_boot_id() -> Option<String> {
    #[cfg(windows)]
    {
        Some("windows-host-boot-id".to_string())
    }

    #[cfg(not(windows))]
    {
        if let Ok(content) = fs::read_to_string("/proc/sys/kernel/random/boot_id") {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
        None
    }
}
