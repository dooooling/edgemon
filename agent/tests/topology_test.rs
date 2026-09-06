#![cfg(unix)]

use edgemon_agent::collector::topology::read_linux_topology;
use std::fs;
use tempfile::TempDir;

fn write_cpu(dir: &TempDir, cpu: &str, core_id: Option<&str>, package_id: Option<&str>) {
    let topo = dir.path().join(cpu).join("topology");
    fs::create_dir_all(&topo).unwrap();
    if let Some(core) = core_id {
        fs::write(topo.join("core_id"), core).unwrap();
    }
    if let Some(package) = package_id {
        fs::write(topo.join("physical_package_id"), package).unwrap();
    }
}

#[test]
fn test_smt_topology_two_cores_four_threads() {
    // Simulates 1 package x 2 cores x 2 threads (e.g. small SMT machine).
    let dir = TempDir::new().unwrap();
    write_cpu(&dir, "cpu0", Some("0\n"), Some("0\n"));
    write_cpu(&dir, "cpu1", Some("0\n"), Some("0\n"));
    write_cpu(&dir, "cpu2", Some("1\n"), Some("0\n"));
    write_cpu(&dir, "cpu3", Some("1\n"), Some("0\n"));

    let topo = read_linux_topology(dir.path());
    assert_eq!(topo.logical_cores, 4);
    assert_eq!(topo.physical_cores, Some(2));
}

#[test]
fn test_multi_package_topology() {
    // 2 packages x 1 core x 1 thread.
    let dir = TempDir::new().unwrap();
    write_cpu(&dir, "cpu0", Some("0"), Some("0"));
    write_cpu(&dir, "cpu1", Some("0"), Some("1"));

    let topo = read_linux_topology(dir.path());
    assert_eq!(topo.logical_cores, 2);
    assert_eq!(topo.physical_cores, Some(2));
}

#[test]
fn test_broken_topology_yields_null_physical() {
    // One CPU misses its topology files: never fabricate, report null.
    let dir = TempDir::new().unwrap();
    write_cpu(&dir, "cpu0", Some("0"), Some("0"));
    write_cpu(&dir, "cpu1", None, None);

    let topo = read_linux_topology(dir.path());
    assert_eq!(topo.physical_cores, None);
}

#[test]
fn test_empty_and_noise_entries() {
    let dir = TempDir::new().unwrap();
    fs::create_dir_all(dir.path().join("cpufreq")).unwrap();
    fs::create_dir_all(dir.path().join("cpuidle")).unwrap();
    fs::write(dir.path().join("online"), "0-3").unwrap();

    let topo = read_linux_topology(dir.path());
    assert_eq!(topo.logical_cores, 0);
    assert_eq!(topo.physical_cores, None);
}
