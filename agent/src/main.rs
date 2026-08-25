use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use clap::Parser;
use log::{error, info, warn};
use uuid::Uuid;

use edgemon_agent::collector::cpu::{get_cpu_model, CpuCollector};
use edgemon_agent::collector::disk::DiskCollector;
use edgemon_agent::collector::io::IoCollector;
use edgemon_agent::collector::memory::MemoryCollector;
use edgemon_agent::collector::network::NetworkCollector;
use edgemon_agent::collector::uptime::{get_boot_id, UptimeCollector};
use edgemon_agent::config::{AgentConfig, CliArgs};
use edgemon_agent::env::cgroup::{resolve_cgroup_context, CgroupVersion};
use edgemon_agent::env::detect::{detect_environment, EnvType};
use edgemon_agent::env::scope::determine_resource_scope;
use edgemon_agent::error::Result;
use edgemon_agent::probe::icmp::execute_icmp_probe;
use edgemon_agent::probe::tcp::execute_tcp_probe;
use edgemon_agent::protocol::*;
use edgemon_agent::transport::backoff::Backoff;
use edgemon_agent::transport::http::HttpClient;

fn current_ts_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn get_system_hostname() -> String {
    #[cfg(windows)]
    {
        if let Ok(host) = std::env::var("COMPUTERNAME") {
            return host;
        }
    }
    #[cfg(unix)]
    unsafe {
        let mut buf = [0u8; 256];
        if libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) == 0 {
            if let Ok(s) = std::ffi::CStr::from_ptr(buf.as_ptr() as *const libc::c_char).to_str() {
                return s.to_string();
            }
        }
    }
    "unknown-host".to_string()
}

fn get_kernel_version() -> String {
    #[cfg(windows)]
    {
        "Windows NT (x86_64)".to_string()
    }
    #[cfg(unix)]
    unsafe {
        let mut uname_buf = std::mem::MaybeUninit::<libc::utsname>::uninit();
        if libc::uname(uname_buf.as_mut_ptr()) == 0 {
            let uname = uname_buf.assume_init();
            let release = std::ffi::CStr::from_ptr(uname.release.as_ptr()).to_string_lossy();
            return release.into_owned();
        }
        "unknown-kernel".to_string()
    }
}

fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    info!("Starting EdgeMon Agent v{}", env!("CARGO_PKG_VERSION"));

    let cli = CliArgs::parse();
    let is_mock = cli.mock;
    let mut config = AgentConfig::from_cli(cli)?;

    // 1. Environment and Cgroup Detection
    let detection = detect_environment();
    let is_container = detection.env_type == EnvType::Container;
    let cgroup_ctx = resolve_cgroup_context(is_container);
    let scope = determine_resource_scope(&detection.env_type, cgroup_ctx.is_some());

    info!(
        "Environment: {:?}, Runtime: {:?}, Virtualization: {:?}, Scope: {:?}, Mock: {}",
        detection.env_type, detection.runtime, detection.host_virtualization_hint, scope, is_mock
    );

    let boot_id = get_boot_id();
    let hostname = get_system_hostname();
    let kernel = get_kernel_version();

    // 2. Initialize Collectors
    let mut cpu_collector = CpuCollector::new(scope, cgroup_ctx.clone());
    let memory_collector = MemoryCollector::new(scope, cgroup_ctx.clone());
    let disk_collector = DiskCollector::new(detection.env_type.clone());
    let mut io_collector = IoCollector::new(scope, cgroup_ctx.clone());
    let mut net_collector = NetworkCollector::new(config.network_interface.clone(), boot_id.clone());
    let uptime_collector = UptimeCollector::new(detection.env_type.clone());

    // 3. Initialize Transport
    let http_client = HttpClient::new(config.server_url.clone(), config.node_id.clone(), config.token.clone());
    let mut backoff = Backoff::new(Duration::from_secs(2), Duration::from_secs(300));

    let mut instance_id = Uuid::new_v4().to_string();
    let mut seq: u64 = 1;
    let mut realtime_lease_until: Option<Instant> = None;

    let mut mock_uptime = 1_245_600u64;
    let mut mock_rx_total = 1_572_864_000u64;
    let mut mock_tx_total = 524_288_000u64;

    loop {
        // Step A: Send Hello
        info!("Registering with server via Hello (instance_id: {})...", instance_id);

        let hello_data = if is_mock {
            HelloData {
                agent: AgentInfo {
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    arch: "x86_64".to_string(),
                },
                system: SystemInfo {
                    hostname: "vps-tokyo-01".to_string(),
                    os: "linux".to_string(),
                    os_version: Some("Debian GNU/Linux 12 (bookworm)".to_string()),
                    kernel: "6.6.137-linux-kvm".to_string(),
                },
                environment: EnvironmentInfo {
                    env_type: "kvm".to_string(),
                    runtime: Some("KVM".to_string()),
                    host_virtualization_hint: Some("KVM".to_string()),
                    cgroup_version: Some(2),
                    resource_scope: "machine".to_string(),
                },
                resources: ResourcesInfo {
                    cpu_model_visible: Some("AMD EPYC 9654 96-Core Processor".to_string()),
                    cpu_capacity_cores: Some(4.0),
                    memory_limit_bytes: Some(8 * 1024 * 1024 * 1024),
                    swap_limit_bytes: Some(2 * 1024 * 1024 * 1024),
                    rootfs_limit_bytes: Some(120 * 1024 * 1024 * 1024),
                    rootfs_scope: "machine".to_string(),
                },
                sources: MetricSources {
                    cpu: "procfs".to_string(),
                    memory: "procfs".to_string(),
                    io: "diskstats".to_string(),
                    network: "netns".to_string(),
                    rootfs: "statvfs".to_string(),
                },
                capabilities: CapabilitiesInfo {
                    icmp_probe: true,
                    tcp_probe: true,
                },
                boot_id: Some("mock-boot-id-4bc98ba4".to_string()),
                network_counter_id: Some("mock-net-counter".to_string()),
            }
        } else {
            HelloData {
                agent: AgentInfo {
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    arch: std::env::consts::ARCH.to_string(),
                },
                system: SystemInfo {
                    hostname: hostname.clone(),
                    os: if cfg!(windows) { "windows".to_string() } else { "linux".to_string() },
                    os_version: None,
                    kernel: kernel.clone(),
                },
                environment: EnvironmentInfo {
                    env_type: detection.env_type.as_str().to_string(),
                    runtime: detection.runtime.clone(),
                    host_virtualization_hint: detection.host_virtualization_hint.clone(),
                    cgroup_version: cgroup_ctx.as_ref().map(|c| match c.version {
                        CgroupVersion::V1 => 1,
                        CgroupVersion::V2 => 2,
                    }),
                    resource_scope: scope.as_str().to_string(),
                },
                resources: ResourcesInfo {
                    cpu_model_visible: get_cpu_model(),
                    cpu_capacity_cores: Some(cpu_collector.effective_capacity()),
                    memory_limit_bytes: memory_collector.effective_limit_bytes(),
                    swap_limit_bytes: memory_collector.effective_swap_limit_bytes(),
                    rootfs_limit_bytes: disk_collector.trusted_limit_bytes(),
                    rootfs_scope: disk_collector.scope_str().to_string(),
                },
                sources: MetricSources {
                    cpu: if is_container { "cgroup".to_string() } else { "procfs".to_string() },
                    memory: if is_container { "cgroup".to_string() } else { "procfs".to_string() },
                    io: if is_container { "cgroup".to_string() } else { "diskstats".to_string() },
                    network: "netns".to_string(),
                    rootfs: disk_collector.scope_str().to_string(),
                },
                capabilities: CapabilitiesInfo {
                    icmp_probe: true,
                    tcp_probe: true,
                },
                boot_id: boot_id.clone(),
                network_counter_id: net_collector.counter_id().map(|s| s.to_string()),
            }
        };

        let hello_envelope = Envelope::new("hello", &instance_id, seq, current_ts_ms(), hello_data);
        match http_client.send_hello(&hello_envelope) {
            Ok(welcome) => {
                info!("Successfully registered with server. Active config rev: {}", welcome.config_rev);
                config.config_rev = welcome.config_rev;
                config.sample_interval_sec = welcome.config.sample_interval_sec.clamp(1, 60);
                config.report_interval_sec = welcome.config.report_interval_sec.clamp(5, 300);
                config.probe_interval_sec = welcome.config.probe_interval_sec.clamp(10, 3600);
                net_collector.set_interface(welcome.config.network_interface);
                backoff.reset();
                seq += 1;
                break;
            }
            Err(e) => {
                error!("Hello failed: {e}. Retrying in {:?}...", backoff.next_delay());
                thread::sleep(backoff.next_delay());
            }
        }
    }

    // Main Sampling & Reporting Loop
    info!("Starting telemetry sampling loop (sample: {}s, normal report: {}s)...", config.sample_interval_sec, config.report_interval_sec);

    let mut last_sample_time = Instant::now();
    let mut last_report_time = Instant::now();
    let mut last_probe_time = Instant::now() - Duration::from_secs(config.probe_interval_sec);
    let mut probe_results: Vec<ProbeResult> = Vec::new();
    let mut server_probes: Vec<ProbeTargetConfig> = Vec::new();

    loop {
        let now = Instant::now();

        // 1. Fast Metrics Sampling
        if now.duration_since(last_sample_time) >= Duration::from_secs(config.sample_interval_sec) {
            last_sample_time = now;
            let _ = cpu_collector.sample();
            let _ = memory_collector.sample();
            let _ = io_collector.sample();
            let _ = net_collector.sample();
        }

        // 2. Network Probes
        if now.duration_since(last_probe_time) >= Duration::from_secs(config.probe_interval_sec) {
            last_probe_time = now;
            probe_results.clear();
            for target in &server_probes {
                let res = if target.method == "icmp" {
                    execute_icmp_probe(&target.id, &target.host, config.allow_private_probes)
                } else {
                    execute_tcp_probe(&target.id, &target.host, target.port.unwrap_or(80), config.allow_private_probes)
                };
                probe_results.push(res);
            }
        }

        // 3. Report Submission (normal interval or 2s realtime lease)
        let is_realtime = realtime_lease_until.map_or(false, |until| now < until);
        let target_report_interval = if is_realtime { 2 } else { config.report_interval_sec };

        if now.duration_since(last_report_time) >= Duration::from_secs(target_report_interval) {
            last_report_time = now;

            let report_data = if is_mock {
                mock_uptime += target_report_interval;
                let rx_delta = (1_200_000 + (current_ts_ms() % 500_000)) * target_report_interval;
                let tx_delta = (450_000 + (current_ts_ms() % 200_000)) * target_report_interval;
                mock_rx_total += rx_delta;
                mock_tx_total += tx_delta;

                let cpu_pct = 14.0 + ((current_ts_ms() % 12000) as f64 / 1000.0);
                ReportData {
                    config_rev: config.config_rev,
                    boot_id: Some("mock-boot-id-4bc98ba4".to_string()),
                    cpu: CpuMetrics {
                        usage_pct: Some((cpu_pct * 10.0).round() / 10.0),
                        throttled_pct: Some(0.0),
                    },
                    memory: MemoryMetrics {
                        used_bytes: Some(2_147_483_648 + ((current_ts_ms() % 80_000_000) as u64)),
                        working_set_bytes: Some(1_610_612_736),
                        swap_used_bytes: Some(67_108_864),
                    },
                    rootfs: RootfsMetrics {
                        used_bytes: Some(34_359_738_368),
                    },
                    io: DiskIoMetrics {
                        read_bps: Some(1_048_576),
                        write_bps: Some(2_097_152),
                    },
                    network: NetworkMetrics {
                        counter_id: Some("mock-net-counter".to_string()),
                        interface: "eth0".to_string(),
                        rx_bps: Some(rx_delta / target_report_interval),
                        tx_bps: Some(tx_delta / target_report_interval),
                        rx_total_bytes: mock_rx_total,
                        tx_total_bytes: mock_tx_total,
                    },
                    uptime_sec: Some(mock_uptime),
                    probes: vec![
                        ProbeResult {
                            id: "Cloudflare 1.1.1.1".to_string(),
                            status: "ok".to_string(),
                            latency_ms: Some(11.8),
                            loss_ratio: 0.0,
                        },
                        ProbeResult {
                            id: "Google 8.8.8.8".to_string(),
                            status: "ok".to_string(),
                            latency_ms: Some(16.5),
                            loss_ratio: 0.0,
                        },
                    ],
                }
            } else {
                ReportData {
                    config_rev: config.config_rev,
                    boot_id: boot_id.clone(),
                    cpu: cpu_collector.sample(),
                    memory: memory_collector.sample(),
                    rootfs: disk_collector.sample(),
                    io: io_collector.sample(),
                    network: net_collector.sample(),
                    uptime_sec: uptime_collector.sample(),
                    probes: probe_results.clone(),
                }
            };

            let report_envelope = Envelope::new("report", &instance_id, seq, current_ts_ms(), report_data);

            match http_client.send_report(&report_envelope) {
                Ok(ack) => {
                    info!("Report #{} accepted by server. (realtime: {})", seq, is_realtime);
                    seq += 1;
                    backoff.reset();

                    // Check for Realtime Lease Hint
                    if let Some(rt) = ack.realtime {
                        info!("Received realtime lease: {}s at {}s interval", rt.lease_sec, rt.interval_sec);
                        realtime_lease_until = Some(Instant::now() + Duration::from_secs(rt.lease_sec));
                    }

                    // Check for Config Update
                    if let Some(new_cfg) = ack.config {
                        info!("Received updated config revision: {}", ack.config_rev);
                        config.config_rev = ack.config_rev;
                        config.sample_interval_sec = new_cfg.sample_interval_sec.clamp(1, 60);
                        config.report_interval_sec = new_cfg.report_interval_sec.clamp(5, 300);
                        config.probe_interval_sec = new_cfg.probe_interval_sec.clamp(10, 3600);
                        net_collector.set_interface(new_cfg.network_interface);
                        server_probes = new_cfg.probes;
                    }
                }
                Err(err) => {
                    warn!("Report failed: {err}");
                    if err.to_string().contains("INSTANCE_MISMATCH") || err.to_string().contains("HELLO_REQUIRED") {
                        warn!("Server requested re-registration. Re-initializing instance...");
                        instance_id = Uuid::new_v4().to_string();
                        seq = 1;
                    }
                }
            }
        }

        // Sleep until next tick
        thread::sleep(Duration::from_millis(500));
    }
}
