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

        let metrics = match self.scope {
            ResourceScope::Container => self.sample_container(now),
            ResourceScope::Machine | ResourceScope::Unknown => self.sample_host(now),
        };

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
                    throttled_pct: Some(0.0),
                };
            }
        }

        let current_jiffies = read_proc_stat_cpu_jiffies();
        let (usage_pct, throttled_pct) =
            if let (Some(prev), Some(curr)) = (self.last_jiffies, current_jiffies) {
                let total_delta = curr.total().saturating_sub(prev.total());
                let busy_delta = curr.busy().saturating_sub(prev.busy());
                let pct = if total_delta > 0 {
                    ((busy_delta as f64) / (total_delta as f64)) * 100.0
                } else {
                    0.0
                };
                (Some(round_1_decimal(pct)), Some(0.0))
            } else {
                (None, None)
            };

        self.last_jiffies = current_jiffies;
        self.last_sample_instant = Some(now);
        CpuMetrics {
            usage_pct,
            throttled_pct,
        }
    }

    fn sample_container(&mut self, now: Instant) -> CpuMetrics {
        let (curr_usage_usec, curr_throttled_usec) =
            read_cgroup_cpu_stats(self.cgroup_ctx.as_ref());

        let (usage_pct, throttled_pct) = match (
            self.last_usage_usec,
            curr_usage_usec,
            self.last_sample_instant,
        ) {
            (Some(prev_usage), Some(curr_usage), Some(prev_time)) => {
                let elapsed_sec = now.duration_since(prev_time).as_secs_f64();
                if elapsed_sec > 0.0 && self.effective_capacity > 0.0 {
                    let delta_usage_sec =
                        (curr_usage.saturating_sub(prev_usage) as f64) / 1_000_000.0;
                    let raw_pct =
                        (delta_usage_sec / (elapsed_sec * self.effective_capacity)) * 100.0;
                    let usage_normalized = round_1_decimal(raw_pct.clamp(0.0, 100.0));

                    let throttled = if let (Some(prev_th), Some(curr_th)) =
                        (self.last_throttled_usec, curr_throttled_usec)
                    {
                        let delta_th_sec = (curr_th.saturating_sub(prev_th) as f64) / 1_000_000.0;
                        let th_pct = (delta_th_sec / elapsed_sec) * 100.0;
                        Some(round_1_decimal(th_pct.clamp(0.0, 100.0)))
                    } else {
                        None
                    };

                    (Some(usage_normalized), throttled)
                } else {
                    (None, None)
                }
            }
            _ => (None, None),
        };

        self.last_usage_usec = curr_usage_usec;
        self.last_throttled_usec = curr_throttled_usec;
        self.last_sample_instant = Some(now);

        CpuMetrics {
            usage_pct,
            throttled_pct,
        }
    }
}

pub fn get_cpu_model() -> Option<String> {
    #[cfg(windows)]
    {
        if let Ok(val) = std::env::var("PROCESSOR_IDENTIFIER") {
            return Some(val);
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(content) = fs::read_to_string("/proc/cpuinfo") {
            for line in content.lines() {
                if line.starts_with("model name") {
                    if let Some((_, model)) = line.split_once(':') {
                        return Some(model.trim().to_string());
                    }
                }
            }
        }
    }
    None
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
            if let Some(cores) = ctx.limits.cpu_quota_cores {
                return cores;
            }
            if let Some(cores) = ctx.limits.cpuset_cores {
                return cores;
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
    unsafe {
        let count = libc::sysconf(libc::_SC_NPROCESSORS_ONLN);
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

    let stat_file = ctx.base_path.join("cpu.stat");
    if let Ok(content) = fs::read_to_string(&stat_file) {
        let mut usage_usec = None;
        let mut throttled_usec = None;

        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() == 2 {
                if parts[0] == "usage_usec" {
                    usage_usec = parts[1].parse::<u64>().ok();
                } else if parts[0] == "throttled_usec" {
                    throttled_usec = parts[1].parse::<u64>().ok();
                }
            }
        }
        if usage_usec.is_some() {
            return (usage_usec, throttled_usec);
        }
    }

    // Fallback to cgroup v1: cpuacct.usage (nanoseconds)
    let acct_file = ctx.base_path.join("cpuacct.usage");
    if let Ok(content) = fs::read_to_string(&acct_file) {
        if let Ok(ns) = content.trim().parse::<u64>() {
            return (Some(ns / 1000), Some(0));
        }
    }

    (None, None)
}

fn round_1_decimal(val: f64) -> f64 {
    (val * 10.0).round() / 10.0
}
