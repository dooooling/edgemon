use crate::env::cgroup::CgroupContext;
use crate::env::scope::ResourceScope;
use crate::protocol::DiskIoMetrics;
use std::fs;
use std::time::Instant;

#[derive(Debug, Clone, Copy, Default)]
struct IoCounters {
    read_bytes: Option<u64>,
    write_bytes: Option<u64>,
    read_ios: Option<u64>,
    write_ios: Option<u64>,
    io_ticks_ms: Option<u64>,
}

pub struct IoCollector {
    scope: ResourceScope,
    cgroup_ctx: Option<CgroupContext>,
    last_counters: Option<IoCounters>,
    last_sample_instant: Option<Instant>,
}

impl IoCollector {
    pub fn new(scope: ResourceScope, cgroup_ctx: Option<CgroupContext>) -> Self {
        Self {
            scope,
            cgroup_ctx,
            last_counters: None,
            last_sample_instant: None,
        }
    }

    pub fn sample(&mut self) -> DiskIoMetrics {
        let current_counters = match self.scope {
            ResourceScope::Container => read_cgroup_io_counters(self.cgroup_ctx.as_ref()),
            ResourceScope::Machine => read_host_diskstats(),
            ResourceScope::Unknown => None,
        };

        let now = Instant::now();
        let (read_bps, write_bps, read_iops, write_iops, io_util_pct) =
            if let (Some(prev), Some(curr), Some(last_inst)) = (
                self.last_counters,
                current_counters,
                self.last_sample_instant,
            ) {
                let elapsed_sec = now.duration_since(last_inst).as_secs_f64();
                if elapsed_sec > 0.0 {
                    // Rollback (counter reset/remap) yields None and rebaselines,
                    // mirroring network counter semantics — never report 0 for
                    // a reset, and never compute a negative rate.
                    let r_bps = rate_delta(prev.read_bytes, curr.read_bytes, elapsed_sec);
                    let w_bps = rate_delta(prev.write_bytes, curr.write_bytes, elapsed_sec);
                    let r_iops = rate_delta(prev.read_ios, curr.read_ios, elapsed_sec);
                    let w_iops = rate_delta(prev.write_ios, curr.write_ios, elapsed_sec);
                    let util_pct = match rate_delta(prev.io_ticks_ms, curr.io_ticks_ms, elapsed_sec) {
                        Some(ticks_delta) => {
                            let u = ((ticks_delta as f64 / (elapsed_sec * 1000.0)) * 100.0)
                                .clamp(0.0, 100.0);
                            Some((u * 10.0).round() / 10.0)
                        }
                        _ => None,
                    };

                    (r_bps, w_bps, r_iops, w_iops, util_pct)
                } else {
                    (None, None, None, None, None)
                }
            } else {
                (None, None, None, None, None)
            };

        self.last_sample_instant = Some(now);
        self.last_counters = current_counters;

        DiskIoMetrics {
            read_bps,
            write_bps,
            read_iops,
            write_iops,
            io_util_pct,
        }
    }
}

/// Monotonic counter delta over `elapsed_sec`, rounded to whole units.
/// Returns `None` when either side is missing or the counter moved backward
/// (reset/remap): the caller reports null and rebaselines instead of
/// fabricating a zero or negative rate.
fn rate_delta(prev: Option<u64>, curr: Option<u64>, elapsed_sec: f64) -> Option<u64> {
    match (prev, curr) {
        (Some(p), Some(c)) if c >= p => Some(((c - p) as f64 / elapsed_sec).round() as u64),
        _ => None,
    }
}

fn read_cgroup_io_counters(cgroup_ctx: Option<&CgroupContext>) -> Option<IoCounters> {
    let ctx = cgroup_ctx?;

    // cgroup v2: io.stat
    if let Ok(content) = fs::read_to_string(ctx.io_path.join("io.stat")) {
        let mut total_rbytes = 0u64;
        let mut total_wbytes = 0u64;
        let mut total_rios = 0u64;
        let mut total_wios = 0u64;
        let mut found_bytes = false;
        let mut found_ios = false;

        for line in content.lines() {
            for part in line.split_whitespace() {
                if let Some(val) = part.strip_prefix("rbytes=") {
                    if let Ok(v) = val.parse::<u64>() {
                        total_rbytes += v;
                        found_bytes = true;
                    }
                } else if let Some(val) = part.strip_prefix("wbytes=") {
                    if let Ok(v) = val.parse::<u64>() {
                        total_wbytes += v;
                        found_bytes = true;
                    }
                } else if let Some(val) = part.strip_prefix("rios=") {
                    if let Ok(v) = val.parse::<u64>() {
                        total_rios += v;
                        found_ios = true;
                    }
                } else if let Some(val) = part.strip_prefix("wios=") {
                    if let Ok(v) = val.parse::<u64>() {
                        total_wios += v;
                        found_ios = true;
                    }
                }
            }
        }

        if found_bytes || found_ios {
            return Some(IoCounters {
                read_bytes: if found_bytes {
                    Some(total_rbytes)
                } else {
                    None
                },
                write_bytes: if found_bytes {
                    Some(total_wbytes)
                } else {
                    None
                },
                read_ios: if found_ios { Some(total_rios) } else { None },
                write_ios: if found_ios { Some(total_wios) } else { None },
                io_ticks_ms: None, // cgroup v2 io.stat does not expose io_ticks
            });
        }
    }

    // cgroup v1: blkio.throttle.io_service_bytes / blkio.io_service_bytes
    for filename in &["blkio.throttle.io_service_bytes", "blkio.io_service_bytes"] {
        if let Ok(content) = fs::read_to_string(ctx.io_path.join(filename)) {
            let mut total_rbytes = 0u64;
            let mut total_wbytes = 0u64;
            let mut found = false;
            for line in content.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    let op = parts[1];
                    if let Ok(bytes) = parts[2].parse::<u64>() {
                        if op.eq_ignore_ascii_case("read") {
                            total_rbytes += bytes;
                            found = true;
                        } else if op.eq_ignore_ascii_case("write") {
                            total_wbytes += bytes;
                            found = true;
                        }
                    }
                }
            }
            if found {
                return Some(IoCounters {
                    read_bytes: Some(total_rbytes),
                    write_bytes: Some(total_wbytes),
                    read_ios: None,
                    write_ios: None,
                    io_ticks_ms: None,
                });
            }
        }
    }

    None
}

fn read_host_diskstats() -> Option<IoCounters> {
    let content = fs::read_to_string("/proc/diskstats").ok()?;
    let mut total_rbytes = 0u64;
    let mut total_wbytes = 0u64;
    let mut total_rios = 0u64;
    let mut total_wios = 0u64;
    let mut total_ticks = 0u64;
    let mut found = false;

    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 14 {
            let dev_name = parts[2];
            // Filter major disk names (e.g. sda, vda, nvme0n1) to avoid duplicate partition sums
            if is_primary_disk(dev_name) {
                let reads_completed = parts[3].parse::<u64>().unwrap_or(0);
                let sectors_read = parts[5].parse::<u64>().unwrap_or(0);
                let writes_completed = parts[7].parse::<u64>().unwrap_or(0);
                let sectors_written = parts[9].parse::<u64>().unwrap_or(0);
                let io_ticks = parts[12].parse::<u64>().unwrap_or(0);

                total_rbytes += sectors_read * 512;
                total_wbytes += sectors_written * 512;
                total_rios += reads_completed;
                total_wios += writes_completed;
                total_ticks += io_ticks;
                found = true;
            }
        }
    }

    if found {
        Some(IoCounters {
            read_bytes: Some(total_rbytes),
            write_bytes: Some(total_wbytes),
            read_ios: Some(total_rios),
            write_ios: Some(total_wios),
            io_ticks_ms: Some(total_ticks),
        })
    } else {
        None
    }
}

pub fn is_primary_disk(dev_name: &str) -> bool {
    if dev_name.starts_with("loop")
        || dev_name.starts_with("ram")
        || dev_name.starts_with("dm-")
        || dev_name.starts_with("sr")
        || dev_name.starts_with("zram")
    {
        return false;
    }

    // sdX -> sda, sdb (not sda1)
    if dev_name.starts_with("sd") || dev_name.starts_with("vd") || dev_name.starts_with("xvd") {
        let suffix = &dev_name[2..];
        return suffix.chars().all(|c| c.is_ascii_alphabetic());
    }

    // nvmeXnY -> nvme0n1 (not nvme0n1p1)
    if dev_name.starts_with("nvme") {
        return !dev_name.contains('p');
    }

    // mmcblkX -> mmcblk0 (not mmcblk0p1)
    if dev_name.starts_with("mmcblk") {
        return !dev_name.contains('p');
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_primary_disk() {
        assert!(is_primary_disk("sda"));
        assert!(is_primary_disk("vda"));
        assert!(is_primary_disk("nvme0n1"));
        assert!(!is_primary_disk("sda1"));
        assert!(!is_primary_disk("nvme0n1p1"));
        assert!(!is_primary_disk("loop0"));
        assert!(!is_primary_disk("dm-0"));
    }

    #[test]
    fn test_rate_delta_normal_and_rollback() {
        assert_eq!(rate_delta(Some(1000), Some(3000), 2.0), Some(1000));
        // Missing sides yield None, never zero.
        assert_eq!(rate_delta(None, Some(3000), 2.0), None);
        assert_eq!(rate_delta(Some(1000), None, 2.0), None);
        // Counter reset yields None (caller reports null + rebaselines).
        assert_eq!(rate_delta(Some(5000), Some(100), 2.0), None);
        assert_eq!(rate_delta(Some(100), Some(100), 2.0), Some(0));
    }
}
