use edgemon_agent::protocol::*;
use std::fs;
use std::path::PathBuf;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("protocol")
        .join("fixtures")
        .join(name)
}

#[test]
fn test_parse_hello_fixture() {
    let path = fixture_path("hello.json");
    let content = fs::read_to_string(&path).expect("Failed to read hello.json fixture");
    let envelope: Envelope<HelloData> =
        serde_json::from_str(&content).expect("Failed to parse hello.json");

    assert_eq!(envelope.v, 1);
    assert_eq!(envelope.msg_type, "hello");
    assert_eq!(envelope.data.agent.version, "0.1.0");
    assert_eq!(envelope.data.environment.env_type, "container");
    assert_eq!(envelope.data.resources.cpu_capacity_cores, Some(0.5));
    assert_eq!(envelope.data.resources.memory_limit_bytes, Some(536870912));
    assert_eq!(envelope.data.resources.rootfs_limit_bytes, None);
    assert_eq!(envelope.data.resources.rootfs_scope, "unknown");
}

#[test]
fn test_parse_welcome_fixture() {
    let path = fixture_path("welcome.json");
    let content = fs::read_to_string(&path).expect("Failed to read welcome.json fixture");
    let envelope: Envelope<WelcomeData> =
        serde_json::from_str(&content).expect("Failed to parse welcome.json");

    assert_eq!(envelope.v, 1);
    assert_eq!(envelope.msg_type, "welcome");
    assert_eq!(envelope.data.config_rev, 1);
    assert_eq!(envelope.data.config.sample_interval_sec, 2);
    assert_eq!(envelope.data.config.stream_interval_sec, 2);
    assert_eq!(envelope.data.config.probes.len(), 1);
    assert_eq!(envelope.data.config.probes[0].id, "cf-dns");
}

#[test]
fn test_parse_report_fixture() {
    let path = fixture_path("report.json");
    let content = fs::read_to_string(&path).expect("Failed to read report.json fixture");
    let envelope: Envelope<ReportData> =
        serde_json::from_str(&content).expect("Failed to parse report.json");

    assert_eq!(envelope.v, 1);
    assert_eq!(envelope.msg_type, "report");
    assert_eq!(envelope.data.cpu.usage_pct, Some(14.5));
    assert_eq!(envelope.data.memory.used_bytes, Some(184549376));
    assert_eq!(envelope.data.rootfs.used_bytes, None);
    assert_eq!(envelope.data.network.rx_total_bytes, 918273645);
    assert_eq!(envelope.data.probes.len(), 1);
    assert_eq!(envelope.data.probes[0].status, "ok");
}

#[test]
fn test_parse_config_fixture() {
    let path = fixture_path("config.json");
    let content = fs::read_to_string(&path).expect("Failed to read config.json fixture");
    let envelope: Envelope<ConfigData> =
        serde_json::from_str(&content).expect("Failed to parse config.json");

    assert_eq!(envelope.v, 1);
    assert_eq!(envelope.msg_type, "config");
    assert_eq!(envelope.data.config_rev, 2);
    assert_eq!(envelope.data.config.stream_interval_sec, 2);
    assert_eq!(envelope.data.config.probes.len(), 1);
}

#[test]
fn test_parse_config_ack_fixture() {
    let path = fixture_path("config_ack.json");
    let content = fs::read_to_string(&path).expect("Failed to read config_ack.json fixture");
    let envelope: Envelope<ConfigAckData> =
        serde_json::from_str(&content).expect("Failed to parse config_ack.json");

    assert_eq!(envelope.v, 1);
    assert_eq!(envelope.msg_type, "config_ack");
    assert_eq!(envelope.data.config_rev, 2);
    assert_eq!(envelope.data.status, "applied");
}

#[test]
fn test_parse_ack_fixture() {
    let path = fixture_path("ack.json");
    let content = fs::read_to_string(&path).expect("Failed to read ack.json fixture");
    let envelope: Envelope<AckData> =
        serde_json::from_str(&content).expect("Failed to parse ack.json");

    assert_eq!(envelope.v, 1);
    assert_eq!(envelope.msg_type, "ack");
    assert_eq!(envelope.data.config_rev, 1);
    assert_eq!(envelope.data.accepted_seq, Some(1900));
    assert_eq!(envelope.data.persisted_seq, Some(1900));
}

#[test]
fn test_parse_error_fixture() {
    let path = fixture_path("error.json");
    let content = fs::read_to_string(&path).expect("Failed to read error.json fixture");
    let envelope: Envelope<ErrorData> =
        serde_json::from_str(&content).expect("Failed to parse error.json");

    assert_eq!(envelope.v, 1);
    assert_eq!(envelope.msg_type, "error");
    assert_eq!(envelope.data.code, "INSTANCE_MISMATCH");
}
