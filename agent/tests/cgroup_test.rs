use edgemon_agent::env::cgroup::{
    min_v1_cpu_quota_along, min_v1_mem_limit_along, parse_cpuset_count,
};
use std::fs;
use tempfile::TempDir;

#[test]
fn test_parse_cpuset_ranges() {
    assert_eq!(parse_cpuset_count("0"), Some(1));
    assert_eq!(parse_cpuset_count("0-3"), Some(4));
    assert_eq!(parse_cpuset_count("0-1,3"), Some(3));
    assert_eq!(parse_cpuset_count("0-7,16-23"), Some(16));
    assert_eq!(parse_cpuset_count(""), None);
    assert_eq!(parse_cpuset_count("   "), None);
}

#[test]
fn test_v1_ancestor_quota_inherited_from_parent() {
    // Parent constrains to 0.5 cores, child is unlimited (-1): ancestor wins.
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("cpu");
    let child = root.join("docker").join("abc123");
    fs::create_dir_all(&child).unwrap();
    fs::write(root.join("cpu.cfs_quota_us"), "50000").unwrap();
    fs::write(root.join("cpu.cfs_period_us"), "100000").unwrap();
    fs::write(child.join("cpu.cfs_quota_us"), "-1").unwrap();
    fs::write(child.join("cpu.cfs_period_us"), "100000").unwrap();

    assert_eq!(min_v1_cpu_quota_along(&root, &child), Some(0.5));
}

#[test]
fn test_v1_ancestor_mem_takes_minimum() {
    // Parent 512MB, child 1GB: the tighter ancestor limit applies.
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("memory");
    let child = root.join("docker").join("abc123");
    fs::create_dir_all(&child).unwrap();
    fs::write(root.join("memory.limit_in_bytes"), "536870912").unwrap();
    fs::write(child.join("memory.limit_in_bytes"), "1073741824").unwrap();

    assert_eq!(min_v1_mem_limit_along(&root, &child), Some(536870912));
}

#[test]
fn test_v1_unlimited_everywhere_yields_none() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("cpu");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("cpu.cfs_quota_us"), "-1").unwrap();
    fs::write(root.join("cpu.cfs_period_us"), "100000").unwrap();

    assert_eq!(min_v1_cpu_quota_along(&root, &root), None);
    assert_eq!(min_v1_mem_limit_along(&root, &root), None);
}
