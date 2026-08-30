use crate::env::cgroup::CgroupContext;
use crate::env::scope::ResourceScope;
use crate::protocol::MemoryMetrics;
use std::fs;

pub struct MemoryCollector {
    scope: ResourceScope,
    cgroup_ctx: Option<CgroupContext>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProcMemInfo {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub available_bytes: Option<u64>,
    pub buffers_bytes: u64,
    pub cached_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_free_bytes: u64,
}

impl ProcMemInfo {
    pub fn used_bytes(&self) -> u64 {
        if let Some(avail) = self.available_bytes {
            self.total_bytes.saturating_sub(avail)
        } else {
            self.total_bytes
                .saturating_sub(self.free_bytes + self.buffers_bytes + self.cached_bytes)
        }
    }
}

impl MemoryCollector {
    pub fn new(scope: ResourceScope, cgroup_ctx: Option<CgroupContext>) -> Self {
        Self { scope, cgroup_ctx }
    }

    pub fn effective_limit_bytes(&self) -> Option<u64> {
        #[cfg(windows)]
        {
            if let Some(win) = read_windows_memory() {
                return Some(win.total_bytes);
            }
        }

        if self.scope == ResourceScope::Container {
            if let Some(ctx) = &self.cgroup_ctx {
                if let Some(bytes) = ctx.limits.memory_max_bytes {
                    return Some(bytes);
                }
            }
        }

        // Host limit from /proc/meminfo
        read_proc_meminfo().map(|m| m.total_bytes)
    }

    pub fn effective_swap_limit_bytes(&self) -> Option<u64> {
        #[cfg(windows)]
        {
            if let Some(win) = read_windows_memory() {
                return Some(win.swap_total_bytes);
            }
        }

        if self.scope == ResourceScope::Container {
            if let Some(ctx) = &self.cgroup_ctx {
                if let Some(bytes) = ctx.limits.swap_max_bytes {
                    return Some(bytes);
                }
            }
        }

        read_proc_meminfo().map(|m| m.swap_total_bytes)
    }

    pub fn sample(&self) -> MemoryMetrics {
        match self.scope {
            ResourceScope::Container => self.sample_container(),
            ResourceScope::Machine => self.sample_host(),
            ResourceScope::Unknown => MemoryMetrics {
                used_bytes: None,
                working_set_bytes: None,
                swap_used_bytes: None,
                oom_kill_count: None,
            },
        }
    }

    fn sample_host(&self) -> MemoryMetrics {
        #[cfg(windows)]
        {
            if let Some(win) = read_windows_memory() {
                return MemoryMetrics {
                    used_bytes: Some(win.used_bytes),
                    working_set_bytes: Some(win.used_bytes),
                    swap_used_bytes: Some(win.swap_used_bytes),
                    oom_kill_count: None,
                };
            }
        }

        if let Some(info) = read_proc_meminfo() {
            let used_bytes = if let Some(avail) = info.available_bytes {
                info.total_bytes.saturating_sub(avail)
            } else {
                info.total_bytes
                    .saturating_sub(info.free_bytes + info.buffers_bytes + info.cached_bytes)
            };

            let swap_used_bytes = info.swap_total_bytes.saturating_sub(info.swap_free_bytes);

            return MemoryMetrics {
                used_bytes: Some(used_bytes),
                working_set_bytes: Some(used_bytes),
                swap_used_bytes: Some(swap_used_bytes),
                oom_kill_count: None,
            };
        }

        MemoryMetrics {
            used_bytes: None,
            working_set_bytes: None,
            swap_used_bytes: None,
            oom_kill_count: None,
        }
    }

    fn sample_container(&self) -> MemoryMetrics {
        let ctx = match &self.cgroup_ctx {
            Some(c) => c,
            None => {
                return MemoryMetrics {
                    used_bytes: None,
                    working_set_bytes: None,
                    swap_used_bytes: None,
                    oom_kill_count: None,
                };
            }
        };

        let oom_kill_count = read_cgroup_oom_kill_count(ctx);

        // cgroup v2: memory.current, memory.stat
        let current_file = ctx.memory_path.join("memory.current");
        if let Ok(content) = fs::read_to_string(&current_file) {
            if let Ok(current_bytes) = content.trim().parse::<u64>() {
                let stat_file = ctx.memory_path.join("memory.stat");
                let inactive_file_bytes = if let Ok(stat_content) = fs::read_to_string(&stat_file) {
                    parse_memory_stat_inactive_file(&stat_content)
                } else {
                    0
                };

                let working_set_bytes = current_bytes.saturating_sub(inactive_file_bytes);

                let swap_used_bytes = if let Ok(swap_content) =
                    fs::read_to_string(ctx.memory_path.join("memory.swap.current"))
                {
                    swap_content.trim().parse::<u64>().ok()
                } else {
                    None
                };

                return MemoryMetrics {
                    used_bytes: Some(current_bytes),
                    working_set_bytes: Some(working_set_bytes),
                    swap_used_bytes,
                    oom_kill_count,
                };
            }
        }

        // cgroup v1: memory.usage_in_bytes, memory.stat
        let v1_usage_file = ctx.memory_path.join("memory.usage_in_bytes");
        if let Ok(content) = fs::read_to_string(&v1_usage_file) {
            if let Ok(usage_bytes) = content.trim().parse::<u64>() {
                let stat_file = ctx.memory_path.join("memory.stat");
                let inactive_file_bytes = if let Ok(stat_content) = fs::read_to_string(&stat_file) {
                    parse_memory_stat_inactive_file(&stat_content)
                } else {
                    0
                };

                let working_set_bytes = usage_bytes.saturating_sub(inactive_file_bytes);
                return MemoryMetrics {
                    used_bytes: Some(usage_bytes),
                    working_set_bytes: Some(working_set_bytes),
                    swap_used_bytes: None,
                    oom_kill_count,
                };
            }
        }

        // Golden Rule 1: Never report host false data when in container scope
        MemoryMetrics {
            used_bytes: None,
            working_set_bytes: None,
            swap_used_bytes: None,
            oom_kill_count: None,
        }
    }
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy)]
struct WindowsMemInfo {
    total_bytes: u64,
    used_bytes: u64,
    swap_total_bytes: u64,
    swap_used_bytes: u64,
}

#[cfg(windows)]
fn read_windows_memory() -> Option<WindowsMemInfo> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    unsafe {
        let mut status = std::mem::zeroed::<MEMORYSTATUSEX>();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) != 0 {
            let total = status.ullTotalPhys;
            let avail = status.ullAvailPhys;
            let used = total.saturating_sub(avail);

            let page_total = status.ullTotalPageFile;
            let page_avail = status.ullAvailPageFile;
            let page_used = page_total.saturating_sub(page_avail);

            return Some(WindowsMemInfo {
                total_bytes: total,
                used_bytes: used,
                swap_total_bytes: page_total.saturating_sub(total),
                swap_used_bytes: page_used.saturating_sub(used),
            });
        }
    }
    None
}

pub fn parse_proc_meminfo_str(content: &str) -> Option<ProcMemInfo> {
    let mut info = ProcMemInfo::default();
    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let key = parts[0].trim_end_matches(':');
            let val_kb = parts[1].parse::<u64>().unwrap_or(0);
            let val_bytes = val_kb * 1024;

            match key {
                "MemTotal" => info.total_bytes = val_bytes,
                "MemFree" => info.free_bytes = val_bytes,
                "MemAvailable" => info.available_bytes = Some(val_bytes),
                "Buffers" => info.buffers_bytes = val_bytes,
                "Cached" => info.cached_bytes = val_bytes,
                "SwapTotal" => info.swap_total_bytes = val_bytes,
                "SwapFree" => info.swap_free_bytes = val_bytes,
                _ => {}
            }
        }
    }
    if info.total_bytes > 0 {
        Some(info)
    } else {
        None
    }
}

fn read_proc_meminfo() -> Option<ProcMemInfo> {
    let content = fs::read_to_string("/proc/meminfo").ok()?;
    parse_proc_meminfo_str(&content)
}

fn parse_memory_stat_inactive_file(content: &str) -> u64 {
    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() == 2 && parts[0] == "inactive_file" {
            return parts[1].parse::<u64>().unwrap_or(0);
        }
    }
    0
}

fn read_cgroup_oom_kill_count(ctx: &CgroupContext) -> Option<u64> {
    // cgroup v2: memory.events -> oom_kill <count>
    let events_file = ctx.memory_path.join("memory.events");
    if let Ok(content) = fs::read_to_string(&events_file) {
        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() == 2 && parts[0] == "oom_kill" {
                return parts[1].parse::<u64>().ok();
            }
        }
    }

    // cgroup v1: memory.oom_control -> oom_kill <count>
    let oom_control_file = ctx.memory_path.join("memory.oom_control");
    if let Ok(content) = fs::read_to_string(&oom_control_file) {
        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() == 2 && parts[0] == "oom_kill" {
                return parts[1].parse::<u64>().ok();
            }
        }
    }

    None
}
