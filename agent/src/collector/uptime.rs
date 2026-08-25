#[cfg(not(windows))]
use std::fs;
use crate::env::detect::EnvType;

pub struct UptimeCollector {
    pub _env_type: EnvType,
}

impl UptimeCollector {
    pub fn new(env_type: EnvType) -> Self {
        Self { _env_type: env_type }
    }

    pub fn sample(&self) -> Option<u64> {
        get_system_uptime_sec()
    }
}

pub fn get_system_uptime_sec() -> Option<u64> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::GetTickCount64;
        unsafe {
            let ms = GetTickCount64();
            return Some(ms / 1000);
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
        return Some("windows-host-boot-id".to_string());
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
