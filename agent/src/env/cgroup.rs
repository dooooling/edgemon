use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CgroupVersion {
    V1,
    V2,
}

#[derive(Debug, Clone, Default)]
pub struct EffectiveLimits {
    pub cpu_quota_cores: Option<f64>,
    pub cpuset_cores: Option<f64>,
    pub memory_max_bytes: Option<u64>,
    pub swap_max_bytes: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct CgroupContext {
    pub version: CgroupVersion,
    pub base_path: PathBuf,
    pub relative_path: String,
    pub limits: EffectiveLimits,
}

pub fn resolve_cgroup_context(is_container: bool) -> Option<CgroupContext> {
    // 1. Determine Cgroup Version
    let v2_marker = Path::new("/sys/fs/cgroup/cgroup.controllers");
    let version = if v2_marker.exists() {
        CgroupVersion::V2
    } else if Path::new("/sys/fs/cgroup/memory").exists()
        || Path::new("/sys/fs/cgroup/cpu").exists()
    {
        CgroupVersion::V1
    } else {
        return None;
    };

    if version == CgroupVersion::V2 {
        resolve_cgroup_v2(is_container)
    } else {
        resolve_cgroup_v1(is_container)
    }
}

fn resolve_cgroup_v2(is_container: bool) -> Option<CgroupContext> {
    let base_root = PathBuf::from("/sys/fs/cgroup");
    if !base_root.exists() {
        return None;
    }

    // Determine target cgroup relative path
    // In containers, prefer /proc/1/cgroup or /proc/self/cgroup
    let rel_path = get_cgroup_v2_path(is_container).unwrap_or_else(|| "/".to_string());
    let mut current = base_root.join(rel_path.trim_start_matches('/'));

    if !current.exists() {
        current = base_root.clone();
    }

    let mut min_cpu_quota_cores: Option<f64> = None;
    let mut min_memory_max: Option<u64> = None;
    let mut min_swap_max: Option<u64> = None;
    let mut effective_cpuset: Option<f64> = None;

    // Traverse ancestors up to /sys/fs/cgroup
    let mut dir: Option<PathBuf> = Some(current.clone());
    while let Some(d) = dir {
        // Read cpu.max
        if let Ok(content) = fs::read_to_string(d.join("cpu.max")) {
            let parts: Vec<&str> = content.split_whitespace().collect();
            if parts.len() >= 2 && parts[0] != "max" {
                if let (Ok(quota), Ok(period)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>())
                {
                    if period > 0.0 && quota > 0.0 {
                        let cores = quota / period;
                        min_cpu_quota_cores =
                            Some(min_cpu_quota_cores.map_or(cores, |m| m.min(cores)));
                    }
                }
            }
        }

        // Read memory.max
        if let Ok(content) = fs::read_to_string(d.join("memory.max")) {
            let val = content.trim();
            if val != "max" {
                if let Ok(bytes) = val.parse::<u64>() {
                    min_memory_max = Some(min_memory_max.map_or(bytes, |m| m.min(bytes)));
                }
            }
        }

        // Read memory.swap.max
        if let Ok(content) = fs::read_to_string(d.join("memory.swap.max")) {
            let val = content.trim();
            if val != "max" {
                if let Ok(bytes) = val.parse::<u64>() {
                    min_swap_max = Some(min_swap_max.map_or(bytes, |m| m.min(bytes)));
                }
            }
        }

        // Read cpuset.cpus.effective (from innermost child only)
        if effective_cpuset.is_none() {
            if let Ok(content) = fs::read_to_string(d.join("cpuset.cpus.effective")) {
                if let Some(count) = parse_cpuset_count(&content) {
                    effective_cpuset = Some(count as f64);
                }
            }
        }

        if d == base_root {
            break;
        }
        dir = d.parent().map(|p| p.to_path_buf());
    }

    Some(CgroupContext {
        version: CgroupVersion::V2,
        base_path: current,
        relative_path: rel_path,
        limits: EffectiveLimits {
            cpu_quota_cores: min_cpu_quota_cores,
            cpuset_cores: effective_cpuset,
            memory_max_bytes: min_memory_max,
            swap_max_bytes: min_swap_max,
        },
    })
}

fn resolve_cgroup_v1(is_container: bool) -> Option<CgroupContext> {
    let cpu_root = PathBuf::from("/sys/fs/cgroup/cpu");
    let mem_root = PathBuf::from("/sys/fs/cgroup/memory");

    let rel_path = get_cgroup_v1_path(is_container).unwrap_or_else(|| "/".to_string());
    let cpu_dir = cpu_root.join(rel_path.trim_start_matches('/'));
    let mem_dir = mem_root.join(rel_path.trim_start_matches('/'));

    let mut min_cpu_quota_cores: Option<f64> = None;
    let mut min_memory_max: Option<u64> = None;

    // Check cpu quota
    let target_cpu = if cpu_dir.exists() { cpu_dir } else { cpu_root };
    if let (Ok(q_str), Ok(p_str)) = (
        fs::read_to_string(target_cpu.join("cpu.cfs_quota_us")),
        fs::read_to_string(target_cpu.join("cpu.cfs_period_us")),
    ) {
        if let (Ok(q), Ok(p)) = (q_str.trim().parse::<f64>(), p_str.trim().parse::<f64>()) {
            if q > 0.0 && p > 0.0 {
                min_cpu_quota_cores = Some(q / p);
            }
        }
    }

    // Check memory limit
    let target_mem = if mem_dir.exists() { mem_dir } else { mem_root };
    if let Ok(m_str) = fs::read_to_string(target_mem.join("memory.limit_in_bytes")) {
        if let Ok(bytes) = m_str.trim().parse::<u64>() {
            // Check if not infinite (> 1PB is typically unlimited)
            if bytes < 1_000_000_000_000_000 {
                min_memory_max = Some(bytes);
            }
        }
    }

    Some(CgroupContext {
        version: CgroupVersion::V1,
        base_path: PathBuf::from("/sys/fs/cgroup"),
        relative_path: rel_path,
        limits: EffectiveLimits {
            cpu_quota_cores: min_cpu_quota_cores,
            cpuset_cores: None,
            memory_max_bytes: min_memory_max,
            swap_max_bytes: None,
        },
    })
}

fn get_cgroup_v2_path(is_container: bool) -> Option<String> {
    let path_file = if is_container {
        "/proc/1/cgroup"
    } else {
        "/proc/self/cgroup"
    };
    let content = fs::read_to_string(path_file)
        .or_else(|_| fs::read_to_string("/proc/self/cgroup"))
        .ok()?;

    for line in content.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() == 3 && (parts[0] == "0" || parts[1].is_empty()) {
            return Some(parts[2].to_string());
        }
    }
    None
}

fn get_cgroup_v1_path(is_container: bool) -> Option<String> {
    let path_file = if is_container {
        "/proc/1/cgroup"
    } else {
        "/proc/self/cgroup"
    };
    let content = fs::read_to_string(path_file)
        .or_else(|_| fs::read_to_string("/proc/self/cgroup"))
        .ok()?;

    for line in content.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() == 3 && (parts[1].contains("cpu") || parts[1].contains("memory")) {
            return Some(parts[2].to_string());
        }
    }
    None
}

pub fn parse_cpuset_count(cpuset_str: &str) -> Option<usize> {
    let trimmed = cpuset_str.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut count = 0;
    for part in trimmed.split(',') {
        let range: Vec<&str> = part.split('-').collect();
        if range.len() == 2 {
            if let (Ok(start), Ok(end)) = (
                range[0].trim().parse::<usize>(),
                range[1].trim().parse::<usize>(),
            ) {
                if end >= start {
                    count += end - start + 1;
                }
            }
        } else if part.trim().parse::<usize>().is_ok() {
            count += 1;
        }
    }

    if count > 0 {
        Some(count)
    } else {
        None
    }
}
