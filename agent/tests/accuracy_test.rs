use edgemon_agent::collector::disk::DiskCollector;
use edgemon_agent::collector::memory::parse_proc_meminfo_str;
use edgemon_agent::collector::network::{compute_rates, parse_proc_net_dev_str, NetCounters};
use edgemon_agent::env::cgroup::{parse_cpuset_count, resolve_cgroup_v2_ancestor_limits};
use edgemon_agent::env::detect::EnvType;
use edgemon_agent::env::scope::{determine_resource_scope, ResourceScope};
use std::fs::{self, File};
use std::io::Write;
use tempfile::tempdir;

#[test]
fn test_cgroup_v2_ancestor_limits_cpu_and_memory_min_constraint() {
    let tmp = tempdir().expect("failed to create tempdir");
    let base_root = tmp.path().to_path_buf();

    let parent = base_root.join("docker");
    let child = parent.join("container-123");
    fs::create_dir_all(&child).expect("failed to create nested dirs");

    // Parent limit: memory.max = 512MB (536870912), cpu.max = "50000 100000" (0.5 cores)
    let mut f_mem_p = File::create(parent.join("memory.max")).unwrap();
    writeln!(f_mem_p, "536870912").unwrap();
    let mut f_cpu_p = File::create(parent.join("cpu.max")).unwrap();
    writeln!(f_cpu_p, "50000 100000").unwrap();

    // Child limit: memory.max = 1GB (1073741824) (larger), cpu.max = "200000 100000" (2.0 cores)
    let mut f_mem_c = File::create(child.join("memory.max")).unwrap();
    writeln!(f_mem_c, "1073741824").unwrap();
    let mut f_cpu_c = File::create(child.join("cpu.max")).unwrap();
    writeln!(f_cpu_c, "200000 100000").unwrap();

    // cpuset in child: "0-3" (4 cores)
    let mut f_cpuset = File::create(child.join("cpuset.cpus.effective")).unwrap();
    writeln!(f_cpuset, "0-3").unwrap();

    let limits = resolve_cgroup_v2_ancestor_limits(&base_root, &child);

    // Assert: ancestor traversal calculates the minimum valid quota across all layers
    assert_eq!(limits.memory_max_bytes, Some(536870912)); // 512MB wins over 1GB
    assert_eq!(limits.cpu_quota_cores, Some(0.5)); // 0.5 cores wins over 2.0 cores
    assert_eq!(limits.cpuset_cores, Some(4.0));
}

#[test]
fn test_proc_meminfo_fallback_calculation_without_memavailable() {
    // 1. Normal modern kernel with MemAvailable
    let modern_meminfo = "\
MemTotal:        8167888 kB
MemFree:         3124500 kB
MemAvailable:    5420100 kB
Buffers:          182300 kB
Cached:          2345600 kB
SwapTotal:       2097148 kB
SwapFree:        2097148 kB
";
    let info_modern = parse_proc_meminfo_str(modern_meminfo).expect("parse failed");
    assert_eq!(info_modern.total_bytes, 8167888 * 1024);
    assert_eq!(info_modern.available_bytes, Some(5420100 * 1024));
    // Used = Total - Available
    assert_eq!(info_modern.used_bytes(), (8167888 - 5420100) * 1024);

    // 2. Legacy Linux 2.6 / 3.x kernel without MemAvailable
    let legacy_meminfo = "\
MemTotal:        4096000 kB
MemFree:         1000000 kB
Buffers:          200000 kB
Cached:           800000 kB
SwapTotal:       1048576 kB
SwapFree:         524288 kB
";
    let info_legacy = parse_proc_meminfo_str(legacy_meminfo).expect("parse failed");
    assert_eq!(info_legacy.total_bytes, 4096000 * 1024);
    assert_eq!(info_legacy.available_bytes, None);
    // Used = Total - (Free + Buffers + Cached) = 4096000 - (1000000 + 200000 + 800000) = 2096000 kB
    assert_eq!(info_legacy.used_bytes(), 2096000 * 1024);
}

#[test]
fn test_network_counter_64bit_parsing_and_rate_reset() {
    let dev_content = "\
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 123456789       0    0    0    0     0          0         0 123456789       0    0    0    0     0       0          0
  eth0: 98765432109876 1000    0    0    0     0          0         0 12345678901234  800    0    0    0     0       0          0
";

    // 1. 64-bit counter parsing
    let counters = parse_proc_net_dev_str(dev_content, "eth0").expect("eth0 not found");
    assert_eq!(counters.rx_bytes, 98765432109876u64);
    assert_eq!(counters.tx_bytes, 12345678901234u64);

    // 2. Non-existent interface returns None
    assert!(parse_proc_net_dev_str(dev_content, "eth99").is_none());

    // 3. First sample (prev is None): rate must be (None, None)
    let rate_initial = compute_rates(None, Some(counters), 2.0);
    assert_eq!(rate_initial, (None, None));

    // 4. Normal monotonic delta: 1000 bytes over 2.0s -> 500 B/s
    let prev = NetCounters {
        rx_bytes: 10000,
        tx_bytes: 20000,
    };
    let curr = NetCounters {
        rx_bytes: 11000, // +1000 bytes
        tx_bytes: 22000, // +2000 bytes
    };
    let rate_normal = compute_rates(Some(prev), Some(curr), 2.0);
    assert_eq!(rate_normal, (Some(500), Some(1000)));

    // 5. Counter Rollback / Interface Reset: curr < prev -> rate MUST be (None, None) (Golden Rule 1: Never negative)
    let curr_reset = NetCounters {
        rx_bytes: 5000, // counter dropped from 10000 to 5000
        tx_bytes: 10000,
    };
    let rate_reset = compute_rates(Some(prev), Some(curr_reset), 2.0);
    assert_eq!(rate_reset, (None, None));

    // 6. Zero elapsed time safeguard: rate must be (None, None)
    let rate_zero_time = compute_rates(Some(prev), Some(curr), 0.0);
    assert_eq!(rate_zero_time, (None, None));
}

#[test]
fn test_systemd_service_cgroup_isolation_on_vps() {
    // When running on a KVM VM or Bare-metal VPS, the agent service itself lives in a systemd slice cgroup
    // Golden Rule 1: We MUST NOT treat the service cgroup as the instance boundary.
    let scope_vm = determine_resource_scope(&EnvType::Vm, true);
    assert_eq!(scope_vm, ResourceScope::Machine);

    let scope_phys = determine_resource_scope(&EnvType::Physical, true);
    assert_eq!(scope_phys, ResourceScope::Machine);

    // In contrast, Docker/LXC container scope is Container
    let scope_container = determine_resource_scope(&EnvType::Container, true);
    assert_eq!(scope_container, ResourceScope::Container);
}

#[test]
fn test_container_overlayfs_rootfs_limit_returns_none() {
    // In container environments with untrusted host backing filesystem (OverlayFS),
    // DiskCollector must return trusted_limit_bytes = None and used_bytes = None (rendered as N/A in UI)
    let collector = DiskCollector::new(EnvType::Container);
    assert_eq!(collector.trusted_limit_bytes(), None);
    assert_eq!(collector.scope_str(), "container_untrusted");

    let sample = collector.sample();
    assert_eq!(sample.used_bytes, None);
}

#[test]
fn test_graceful_handling_of_missing_and_corrupt_files() {
    // Empty / corrupt meminfo returns None without panicking
    assert!(parse_proc_meminfo_str("").is_none());
    assert!(parse_proc_meminfo_str("Invalid: corrupt data\nAnother: bad").is_none());

    // Corrupt net dev returns None
    assert!(parse_proc_net_dev_str("Not a net dev format", "eth0").is_none());

    // Invalid cpuset strings return None
    assert_eq!(parse_cpuset_count("invalid-range-abc"), None);
}
