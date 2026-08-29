use crate::env::cgroup::CgroupContext;
use crate::env::scope::ResourceScope;
use crate::protocol::CpuMetrics;
use std::fs;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Default)]
struct ProcStatJiffies {
    user: u64,
    nice: u64,
    system: u64,
    idle: u64,
    iowait: u64,
    irq: u64,
    softirq: u64,
    steal: u64,
}

impl ProcStatJiffies {
    fn total(&self) -> u64 {
        self.user
            + self.nice
            + self.system
            + self.idle
            + self.iowait
            + self.irq
            + self.softirq
            + self.steal
    }

    fn busy(&self) -> u64 {
        self.user + self.nice + self.system + self.irq + self.softirq + self.steal
    }
}

pub struct CpuCollector {
    scope: ResourceScope,
    cgroup_ctx: Option<CgroupContext>,
    effective_capacity: f64,

    // Cached recent sample
    latest_metrics: CpuMetrics,

    // Host tracking (Linux)
    last_jiffies: Option<ProcStatJiffies>,

    // Windows tracking
    #[cfg(windows)]
    last_win_busy_total: Option<(u64, u64)>,

    // Container tracking
    last_usage_usec: Option<u64>,
    last_throttled_usec: Option<u64>,
    last_sample_instant: Option<Instant>,
}

impl CpuCollector {
    pub fn new(scope: ResourceScope, cgroup_ctx: Option<CgroupContext>) -> Self {
        let effective_capacity = resolve_effective_capacity(&scope, cgroup_ctx.as_ref());
        Self {
            scope,
            cgroup_ctx,
            effective_capacity,
            latest_metrics: CpuMetrics {
                usage_pct: None,
                throttled_pct: None,
                temp_celsius: None,
                load1: None,
                load5: None,
                load15: None,
                process_total_count: None,
                process_running_count: None,
            },
            last_jiffies: None,
            #[cfg(windows)]
            last_win_busy_total: None,
            last_usage_usec: None,
            last_throttled_usec: None,
            last_sample_instant: None,
        }
    }

    pub fn effective_capacity(&self) -> f64 {
        self.effective_capacity
    }

    pub fn sample(&mut self) -> CpuMetrics {
        let now = Instant::now();
        // Guard against back-to-back calls within 500ms
        if let Some(last_time) = self.last_sample_instant {
            if now.duration_since(last_time) < Duration::from_millis(500)
                && self.latest_metrics.usage_pct.is_some()
            {
                return self.latest_metrics.clone();
            }
        }

        let mut metrics = match self.scope {
            ResourceScope::Container => self.sample_container(now),
            ResourceScope::Machine => self.sample_host(now),
            ResourceScope::Unknown => CpuMetrics {
                usage_pct: None,
                throttled_pct: None,
                temp_celsius: None,
                load1: None,
                load5: None,
                load15: None,
                process_total_count: None,
                process_running_count: None,
            },
        };

        // Enrich with loadavg, process count, and CPU temperature
        if let Some(load_info) = read_proc_loadavg() {
            metrics.load1 = Some(load_info.0);
            metrics.load5 = Some(load_info.1);
            metrics.load15 = Some(load_info.2);
            metrics.process_running_count = Some(load_info.3);
            metrics.process_total_count = Some(load_info.4);
        }

        metrics.temp_celsius = read_cpu_temperature();

        if metrics.usage_pct.is_some() {
            self.latest_metrics = metrics.clone();
        }

        metrics
    }

    fn sample_host(&mut self, now: Instant) -> CpuMetrics {
        #[cfg(windows)]
        {
            if let Some((busy, total)) = read_windows_cpu_times() {
                let usage_pct = if let Some((prev_busy, prev_total)) = self.last_win_busy_total {
                    let delta_total = total.saturating_sub(prev_total);
                    let delta_busy = busy.saturating_sub(prev_busy);
                    if delta_total > 0 {
                        Some(round_1_decimal(
                            ((delta_busy as f64) / (delta_total as f64)) * 100.0,
                        ))
                    } else {
                        self.latest_metrics.usage_pct.or(Some(0.0))
                    }
                } else {
                    None
                };
                self.last_win_busy_total = Some((busy, total));
                self.last_sample_instant = Some(now);
                return CpuMetrics {
                    usage_pct,
                    throttled_pct: None,
                    temp_celsius: None,
                    load1: None,
                    load5: None,
                    load15: None,
                    process_total_count: None,
                    process_running_count: None,
                };
            }
        }

        let current_jiffies = match read_proc_stat_cpu_jiffies() {
            Some(j) => j,
            None => {
                return CpuMetrics {
                    usage_pct: None,
                    throttled_pct: None,
                    ..Default::default()
                }
            }
        };

        let usage_pct = if let Some(ref prev) = self.last_jiffies {
            let total_delta = current_jiffies.total().saturating_sub(prev.total());
            let busy_delta = current_jiffies.busy().saturating_sub(prev.busy());

            if total_delta > 0 {
                let pct = ((busy_delta as f64) / (total_delta as f64)) * 100.0;
                Some(round_1_decimal(pct.clamp(0.0, 100.0)))
            } else {
                self.latest_metrics.usage_pct.or(Some(0.0))
            }
        } else {
            None
        };

        self.last_jiffies = Some(current_jiffies);
        self.last_sample_instant = Some(now);

        CpuMetrics {
            usage_pct,
            throttled_pct: None,
            ..Default::default()
        }
    }

    fn sample_container(&mut self, now: Instant) -> CpuMetrics {
        let (usage_usec, throttled_usec) = read_cgroup_cpu_stats(self.cgroup_ctx.as_ref());

        let current_usage = match usage_usec {
            Some(u) => u,
            None => {
                return CpuMetrics {
                    usage_pct: None,
                    throttled_pct: None,
                    ..Default::default()
                };
            }
        };

        let (usage_pct, throttled_pct) = if let (Some(prev_usage), Some(last_time)) =
            (self.last_usage_usec, self.last_sample_instant)
        {
            let elapsed_sec = now.duration_since(last_time).as_secs_f64();
            if elapsed_sec > 0.0 {
                let delta_usage_sec =
                    (current_usage.saturating_sub(prev_usage) as f64) / 1_000_000.0;
                let cores = self.effective_capacity.max(0.01);
                let raw_usage_pct = (delta_usage_sec / (elapsed_sec * cores)) * 100.0;
                let usage = Some(round_1_decimal(raw_usage_pct.clamp(0.0, 100.0)));

                let throttled = if let (Some(curr_throt), Some(prev_throt)) =
                    (throttled_usec, self.last_throttled_usec)
                {
                    let delta_throt_sec =
                        (curr_throt.saturating_sub(prev_throt) as f64) / 1_000_000.0;
                    let raw_throt_pct = (delta_throt_sec / elapsed_sec) * 100.0;
                    Some(round_1_decimal(raw_throt_pct.clamp(0.0, 100.0)))
                } else {
                    None
                };

                (usage, throttled)
            } else {
                (
                    self.latest_metrics.usage_pct,
                    self.latest_metrics.throttled_pct,
                )
            }
        } else {
            (None, None)
        };

        self.last_usage_usec = Some(current_usage);
        if throttled_usec.is_some() {
            self.last_throttled_usec = throttled_usec;
        }
        self.last_sample_instant = Some(now);

        CpuMetrics {
            usage_pct,
            throttled_pct,
            ..Default::default()
        }
    }
}

pub fn get_cpu_model() -> Option<String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_LOCAL_MACHINE, KEY_READ, REG_SZ,
        };

        let key_path: Vec<u16> = "HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0\0"
            .encode_utf16()
            .collect();
        let mut hkey = 0isize;

        unsafe {
            if RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                key_path.as_ptr(),
                0,
                KEY_READ,
                &mut hkey,
            ) == 0
            {
                let name_utf16: Vec<u16> = "ProcessorNameString\0".encode_utf16().collect();
                let mut buf_size = 512u32;
                let mut buf = vec![0u8; 512];
                let mut val_type = 0u32;

                if RegQueryValueExW(
                    hkey,
                    name_utf16.as_ptr(),
                    std::ptr::null_mut(),
                    &mut val_type,
                    buf.as_mut_ptr(),
                    &mut buf_size,
                ) == 0
                    && val_type == REG_SZ
                {
                    RegCloseKey(hkey);
                    let wide_slice = std::slice::from_raw_parts(
                        buf.as_ptr() as *const u16,
                        (buf_size as usize) / 2,
                    );
                    let s = String::from_utf16_lossy(wide_slice);
                    let trimmed = s.trim_matches('\0').trim().to_string();
                    if !trimmed.is_empty() {
                        return Some(trimmed);
                    }
                } else {
                    RegCloseKey(hkey);
                }
            }
        }
        None
    }

    #[cfg(unix)]
    {
        if let Ok(content) = fs::read_to_string("/proc/cpuinfo") {
            for line in content.lines() {
                if line.starts_with("model name")
                    || line.starts_with("Hardware")
                    || line.starts_with("Processor")
                {
                    if let Some(pos) = line.find(':') {
                        let model = line[pos + 1..].trim();
                        if !model.is_empty() {
                            return Some(model.to_string());
                        }
                    }
                }
            }
        }
        None
    }
}

fn resolve_effective_capacity(scope: &ResourceScope, cgroup_ctx: Option<&CgroupContext>) -> f64 {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{GetSystemInfo, SYSTEM_INFO};
        unsafe {
            let mut info = std::mem::zeroed::<SYSTEM_INFO>();
            GetSystemInfo(&mut info);
            let count = info.dwNumberOfProcessors as f64;
            if count > 0.0 {
                return count;
            }
        }
    }

    if *scope == ResourceScope::Container {
        if let Some(ctx) = cgroup_ctx {
            match (ctx.limits.cpu_quota_cores, ctx.limits.cpuset_cores) {
                (Some(quota), Some(cpuset)) => return quota.min(cpuset),
                (Some(quota), None) => return quota,
                (None, Some(cpuset)) => return cpuset,
                (None, None) => {}
            }
        }
    }

    // Default to host physical/logical CPU count
    let count = num_cpus();
    if count > 0 {
        count as f64
    } else {
        1.0
    }
}

fn num_cpus() -> usize {
    #[cfg(unix)]
    {
        let count = unsafe { libc::sysconf(libc::_SC_NPROCESSORS_ONLN) };
        if count > 0 {
            return count as usize;
        }
    }
    1
}

#[cfg(windows)]
fn read_windows_cpu_times() -> Option<(u64, u64)> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::GetSystemTimes;
    unsafe {
        let mut idle_ft = std::mem::zeroed::<FILETIME>();
        let mut kernel_ft = std::mem::zeroed::<FILETIME>();
        let mut user_ft = std::mem::zeroed::<FILETIME>();
        if GetSystemTimes(&mut idle_ft, &mut kernel_ft, &mut user_ft) != 0 {
            let idle = ((idle_ft.dwHighDateTime as u64) << 32) | (idle_ft.dwLowDateTime as u64);
            let kernel =
                ((kernel_ft.dwHighDateTime as u64) << 32) | (kernel_ft.dwLowDateTime as u64);
            let user = ((user_ft.dwHighDateTime as u64) << 32) | (user_ft.dwLowDateTime as u64);
            let total = kernel + user;
            let busy = total.saturating_sub(idle);
            return Some((busy, total));
        }
    }
    None
}

fn read_proc_stat_cpu_jiffies() -> Option<ProcStatJiffies> {
    if let Ok(content) = fs::read_to_string("/proc/stat") {
        for line in content.lines() {
            if line.starts_with("cpu ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 5 {
                    return None;
                }
                let user = parts[1].parse::<u64>().unwrap_or(0);
                let nice = parts[2].parse::<u64>().unwrap_or(0);
                let system = parts[3].parse::<u64>().unwrap_or(0);
                let idle = parts[4].parse::<u64>().unwrap_or(0);
                let iowait = parts.get(5).and_then(|v| v.parse().ok()).unwrap_or(0);
                let irq = parts.get(6).and_then(|v| v.parse().ok()).unwrap_or(0);
                let softirq = parts.get(7).and_then(|v| v.parse().ok()).unwrap_or(0);
                let steal = parts.get(8).and_then(|v| v.parse().ok()).unwrap_or(0);
                return Some(ProcStatJiffies {
                    user,
                    nice,
                    system,
                    idle,
                    iowait,
                    irq,
                    softirq,
                    steal,
                });
            }
        }
    }
    None
}

fn read_cgroup_cpu_stats(cgroup_ctx: Option<&CgroupContext>) -> (Option<u64>, Option<u64>) {
    let ctx = match cgroup_ctx {
        Some(c) => c,
        None => return (None, None),
    };

    let stat_file = ctx.cpu_path.join("cpu.stat");
    let mut usage_usec = None;
    let mut throttled_usec = None;

    if let Ok(content) = fs::read_to_string(&stat_file) {
        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() == 2 {
                if parts[0] == "usage_usec" {
                    usage_usec = parts[1].parse::<u64>().ok();
                } else if parts[0] == "throttled_usec" {
                    throttled_usec = parts[1].parse::<u64>().ok();
                } else if parts[0] == "throttled_time" {
                    // cgroup v1: throttled_time is in nanoseconds -> convert to usec
                    throttled_usec = parts[1].parse::<u64>().map(|ns| ns / 1000).ok();
                }
            }
        }
        if usage_usec.is_some() {
            return (usage_usec, throttled_usec);
        }
    }

    // Fallback to cgroup v1: cpuacct.usage (nanoseconds)
    let acct_file = ctx.cpu_path.join("cpuacct.usage");
    if let Ok(content) = fs::read_to_string(&acct_file) {
        if let Ok(ns) = content.trim().parse::<u64>() {
            return (Some(ns / 1000), throttled_usec);
        }
    }

    (None, None)
}

fn round_1_decimal(val: f64) -> f64 {
    (val * 10.0).round() / 10.0
}

fn read_proc_loadavg() -> Option<(f64, f64, f64, u32, u32)> {
    #[cfg(unix)]
    {
        if let Ok(content) = fs::read_to_string("/proc/loadavg") {
            let parts: Vec<&str> = content.split_whitespace().collect();
            if parts.len() >= 4 {
                let load1 = parts[0].parse::<f64>().ok()?;
                let load5 = parts[1].parse::<f64>().ok()?;
                let load15 = parts[2].parse::<f64>().ok()?;

                let mut proc_running = 0u32;
                let mut proc_total = 0u32;
                if let Some((r, t)) = parts[3].split_once('/') {
                    proc_running = r.parse::<u32>().unwrap_or(0);
                    proc_total = t.parse::<u32>().unwrap_or(0);
                }

                return Some((load1, load5, load15, proc_running, proc_total));
            }
        }
    }
    None
}

fn read_cpu_temperature() -> Option<f64> {
    #[cfg(unix)]
    {
        // 1. Try /sys/class/thermal/thermal_zone*/temp
        if let Ok(entries) = fs::read_dir("/sys/class/thermal") {
            let mut highest_temp: Option<f64> = None;
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("thermal_zone") {
                    let temp_path = entry.path().join("temp");
                    if let Ok(content) = fs::read_to_string(temp_path) {
                        if let Ok(milli) = content.trim().parse::<i64>() {
                            let temp = (milli as f64) / 1000.0;
                            if temp > 0.0 && temp < 130.0 {
                                highest_temp =
                                    Some(highest_temp.map_or(temp, |h: f64| h.max(temp)));
                            }
                        }
                    }
                }
            }
            if highest_temp.is_some() {
                return highest_temp.map(round_1_decimal);
            }
        }

        // 2. Try /sys/class/hwmon/hwmon*/temp*_input
        if let Ok(entries) = fs::read_dir("/sys/class/hwmon") {
            let mut highest_temp: Option<f64> = None;
            for entry in entries.flatten() {
                if let Ok(sub_entries) = fs::read_dir(entry.path()) {
                    for sub in sub_entries.flatten() {
                        let sub_name = sub.file_name().to_string_lossy().to_string();
                        if sub_name.starts_with("temp") && sub_name.ends_with("_input") {
                            if let Ok(content) = fs::read_to_string(sub.path()) {
                                if let Ok(milli) = content.trim().parse::<i64>() {
                                    let temp = (milli as f64) / 1000.0;
                                    if temp > 0.0 && temp < 130.0 {
                                        highest_temp =
                                            Some(highest_temp.map_or(temp, |h: f64| h.max(temp)));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if highest_temp.is_some() {
                return highest_temp.map(round_1_decimal);
            }
        }
    }
    None
}
