use crate::env::cgroup::CgroupContext;
use crate::env::scope::ResourceScope;
use crate::protocol::DiskIoMetrics;
use std::fs;
use std::time::Instant;

#[derive(Debug, Clone, Copy, Default)]
struct IoCounters {
    read_bytes: u64,
    write_bytes: u64,
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
            ResourceScope::Machine | ResourceScope::Unknown => read_host_diskstats(),
        };

        let now = Instant::now();
        let (read_bps, write_bps) = if let (Some(prev), Some(curr), Some(last_inst)) = (
            self.last_counters,
            current_counters,
            self.last_sample_instant,
        ) {
            let elapsed_sec = now.duration_since(last_inst).as_secs_f64();
            if elapsed_sec > 0.0 {
                let r_delta = curr.read_bytes.saturating_sub(prev.read_bytes) as f64;
                let w_delta = curr.write_bytes.saturating_sub(prev.write_bytes) as f64;
                let r_bps = (r_delta / elapsed_sec).round() as u64;
                let w_bps = (w_delta / elapsed_sec).round() as u64;
                (Some(r_bps), Some(w_bps))
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

        self.last_sample_instant = Some(now);
        self.last_counters = current_counters;

        DiskIoMetrics {
            read_bps,
            write_bps,
        }
    }
}

fn read_cgroup_io_counters(cgroup_ctx: Option<&CgroupContext>) -> Option<IoCounters> {
    let ctx = cgroup_ctx?;
    let content = fs::read_to_string(ctx.base_path.join("io.stat")).ok()?;

    let mut total_rbytes = 0u64;
    let mut total_wbytes = 0u64;
    let mut found = false;

    for line in content.lines() {
        for part in line.split_whitespace() {
            if let Some(val) = part.strip_prefix("rbytes=") {
                if let Ok(v) = val.parse::<u64>() {
                    total_rbytes += v;
                    found = true;
                }
            } else if let Some(val) = part.strip_prefix("wbytes=") {
                if let Ok(v) = val.parse::<u64>() {
                    total_wbytes += v;
                    found = true;
                }
            }
        }
    }

    if found {
        Some(IoCounters {
            read_bytes: total_rbytes,
            write_bytes: total_wbytes,
        })
    } else {
        None
    }
}

fn read_host_diskstats() -> Option<IoCounters> {
    let content = fs::read_to_string("/proc/diskstats").ok()?;
    let mut total_rbytes = 0u64;
    let mut total_wbytes = 0u64;
    let mut found = false;

    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 14 {
            let dev_name = parts[2];
            // Filter major disk names (e.g. sda, vda, nvme0n1) to avoid duplicate partition sums
            if is_primary_disk(dev_name) {
                let sectors_read = parts[5].parse::<u64>().unwrap_or(0);
                let sectors_written = parts[9].parse::<u64>().unwrap_or(0);
                total_rbytes += sectors_read * 512;
                total_wbytes += sectors_written * 512;
                found = true;
            }
        }
    }

    if found {
        Some(IoCounters {
            read_bytes: total_rbytes,
            write_bytes: total_wbytes,
        })
    } else {
        None
    }
}

pub fn is_primary_disk(dev: &str) -> bool {
    // Standard SCSI/VirtIO/IDE disks: sda, sdb, vda, xvda, hda (ends with alphabetic char, no partition digit)
    if (dev.starts_with("sd")
        || dev.starts_with("vd")
        || dev.starts_with("xvd")
        || dev.starts_with("hd"))
        && dev.chars().last().is_some_and(|c| c.is_ascii_alphabetic())
    {
        return true;
    }

    // NVMe namespaces: nvme0n1, nvme1n1, nvme0n2... (contains 'n' with digit, but NOT partition 'p<digit>')
    // Partition format is nvme0n1p1, nvme0n1p2
    if dev.starts_with("nvme") {
        if let Some(pos) = dev.rfind('n') {
            let after_n = &dev[pos + 1..];
            if !after_n.is_empty()
                && after_n.chars().all(|c| c.is_ascii_digit())
                && !dev.contains('p')
            {
                return true;
            }
        }
    }

    // MMC/eMMC block devices: mmcblk0, mmcblk1... (ends with digit, does NOT contain partition 'p<digit>' or 'boot<digit>')
    // Partition format is mmcblk0p1, mmcblk0p2, mmcblk0boot0
    if let Some(after) = dev.strip_prefix("mmcblk") {
        if !after.is_empty() && after.chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_primary_disk() {
        assert!(is_primary_disk("sda"));
        assert!(is_primary_disk("sdb"));
        assert!(is_primary_disk("vda"));
        assert!(is_primary_disk("xvda"));
        assert!(is_primary_disk("hda"));
        assert!(!is_primary_disk("sda1"));
        assert!(!is_primary_disk("vda2"));

        assert!(is_primary_disk("nvme0n1"));
        assert!(is_primary_disk("nvme0n2"));
        assert!(is_primary_disk("nvme1n1"));
        assert!(!is_primary_disk("nvme0n1p1"));
        assert!(!is_primary_disk("nvme0n1p2"));

        assert!(is_primary_disk("mmcblk0"));
        assert!(is_primary_disk("mmcblk1"));
        assert!(!is_primary_disk("mmcblk0p1"));
        assert!(!is_primary_disk("mmcblk0p2"));
        assert!(!is_primary_disk("mmcblk0boot0"));
    }
}
