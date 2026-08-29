use clap::Parser;
use log::{error, info, warn};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
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
use edgemon_agent::error::{AgentError, Result};
use edgemon_agent::probe::icmp::execute_icmp_probe;
use edgemon_agent::probe::tcp::execute_tcp_probe;
use edgemon_agent::protocol::*;
use edgemon_agent::transport::backoff::Backoff;
use edgemon_agent::transport::http::HttpClient;
use edgemon_agent::transport::ws::{WsEvent, WsTransport};

#[derive(Debug, Default)]
pub struct SampleBuffer {
    pub samples: VecDeque<MetricSample>,
    pub sample_seq: u64,
    pub last_sent_sample_seq: u64,
    pub persisted_sample_seq: u64,
    pub dropped_samples: u64,
}

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
    {
        let mut buf = [0u8; 256];
        let res = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut _, buf.len()) };
        if res == 0 {
            if let Ok(s) = unsafe { std::ffi::CStr::from_ptr(buf.as_ptr() as *const _) }.to_str() {
                return s.to_string();
            }
        }
    }
    "unknown-host".to_string()
}

#[cfg(windows)]
fn read_windows_os_version() -> Option<String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_LOCAL_MACHINE, KEY_READ, REG_SZ,
    };

    let key_path: Vec<u16> = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\0"
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
            let read_string = |val_name: &str| -> Option<String> {
                let name_utf16: Vec<u16> =
                    val_name.encode_utf16().chain(std::iter::once(0)).collect();
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
                    let wide_slice = std::slice::from_raw_parts(
                        buf.as_ptr() as *const u16,
                        (buf_size as usize) / 2,
                    );
                    let s = String::from_utf16_lossy(wide_slice);
                    let trimmed = s.trim_matches('\0').trim().to_string();
                    if !trimmed.is_empty() {
                        return Some(trimmed);
                    }
                }
                None
            };

            let read_dword = |val_name: &str| -> Option<u32> {
                let name_utf16: Vec<u16> =
                    val_name.encode_utf16().chain(std::iter::once(0)).collect();
                let mut val = 0u32;
                let mut val_size = std::mem::size_of::<u32>() as u32;
                if RegQueryValueExW(
                    hkey,
                    name_utf16.as_ptr(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut val as *mut u32 as *mut u8,
                    &mut val_size,
                ) == 0
                {
                    return Some(val);
                }
                None
            };

            let display_version = read_string("DisplayVersion");
            let build = read_string("CurrentBuildNumber").or_else(|| read_string("CurrentBuild"));
            let ubr = read_dword("UBR");

            RegCloseKey(hkey);

            let build_str = match (build, ubr) {
                (Some(b), Some(u)) => format!("{}.{}", b, u),
                (Some(b), None) => b,
                _ => String::new(),
            };

            let build_num = build_str
                .split('.')
                .next()
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(0);
            let win_name = if build_num >= 22000 {
                "Windows 11"
            } else {
                "Windows 10"
            };
            let final_ver = match display_version {
                Some(dv) => format!("{} {}", win_name, dv),
                None => win_name.to_string(),
            };

            return Some(final_ver);
        }
    }
    Some("Windows".to_string())
}

#[cfg(windows)]
fn read_windows_kernel_version() -> String {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_LOCAL_MACHINE, KEY_READ, REG_SZ,
    };

    let key_path: Vec<u16> = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\0"
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
            let read_string = |val_name: &str| -> Option<String> {
                let name_utf16: Vec<u16> =
                    val_name.encode_utf16().chain(std::iter::once(0)).collect();
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
                    let wide_slice = std::slice::from_raw_parts(
                        buf.as_ptr() as *const u16,
                        (buf_size as usize) / 2,
                    );
                    let s = String::from_utf16_lossy(wide_slice);
                    let trimmed = s.trim_matches('\0').trim().to_string();
                    if !trimmed.is_empty() {
                        return Some(trimmed);
                    }
                }
                None
            };

            let read_dword = |val_name: &str| -> Option<u32> {
                let name_utf16: Vec<u16> =
                    val_name.encode_utf16().chain(std::iter::once(0)).collect();
                let mut val = 0u32;
                let mut val_size = std::mem::size_of::<u32>() as u32;
                if RegQueryValueExW(
                    hkey,
                    name_utf16.as_ptr(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut val as *mut u32 as *mut u8,
                    &mut val_size,
                ) == 0
                {
                    return Some(val);
                }
                None
            };

            let build = read_string("CurrentBuildNumber").or_else(|| read_string("CurrentBuild"));
            let ubr = read_dword("UBR");

            RegCloseKey(hkey);

            if let Some(b) = build {
                if let Some(u) = ubr {
                    return format!("10.0.{}.{}", b, u);
                }
                return format!("10.0.{}", b);
            }
        }
    }
    "Windows NT".to_string()
}

fn get_os_version() -> Option<String> {
    #[cfg(windows)]
    {
        read_windows_os_version()
    }

    #[cfg(unix)]
    {
        if let Ok(content) = std::fs::read_to_string("/etc/os-release")
            .or_else(|_| std::fs::read_to_string("/usr/lib/os-release"))
        {
            for line in content.lines() {
                if let Some(val) = line.strip_prefix("PRETTY_NAME=") {
                    let trimmed = val.trim_matches('"').trim_matches('\'').trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
        None
    }
}

fn get_kernel_version() -> String {
    #[cfg(windows)]
    {
        read_windows_kernel_version()
    }
    #[cfg(unix)]
    {
        let mut uname_buf = std::mem::MaybeUninit::<libc::utsname>::uninit();
        let res = unsafe { libc::uname(uname_buf.as_mut_ptr()) };
        if res == 0 {
            let uname = unsafe { uname_buf.assume_init() };
            let release = unsafe { std::ffi::CStr::from_ptr(uname.release.as_ptr() as *const _) }
                .to_string_lossy();
            return release.into_owned();
        }
        "unknown-kernel".to_string()
    }
}

fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    info!(
        "Starting EdgeMon Agent v{} (WSS Architecture v1.0)",
        env!("CARGO_PKG_VERSION")
    );

    let cli = CliArgs::parse();
    let is_mock = cli.mock;
    let config = AgentConfig::from_cli(cli)?;

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

    // 2. Measure True Initial Hardware Limits (Accuracy First)
    let init_cpu = CpuCollector::new(scope, cgroup_ctx.clone());
    let init_mem = MemoryCollector::new(scope, cgroup_ctx.clone());
    let init_disk = DiskCollector::new(detection.env_type.clone());
    let init_net = NetworkCollector::new(config.network_interface.clone(), boot_id.clone());

    let true_cpu_capacity = init_cpu.effective_capacity();
    let true_mem_limit = init_mem.effective_limit_bytes();
    let true_swap_limit = init_mem.effective_swap_limit_bytes();
    let true_rootfs_limit = init_disk.trusted_limit_bytes();
    let true_rootfs_scope = init_disk.scope_str().to_string();
    let initial_net_counter_id = init_net.counter_id().map(|s| s.to_string());

    // 3. Shared State across Threads
    let shared_buffer: Arc<Mutex<SampleBuffer>> = Arc::new(Mutex::new(SampleBuffer::default()));
    let shared_config = Arc::new(RwLock::new(config.clone()));
    let shared_probes: Arc<RwLock<Vec<ProbeResult>>> = Arc::new(RwLock::new(Vec::new()));

    // 4. Thread 1: Dedicated Probe Background Thread (P1-2: completely decoupled from 2s sampling loop)
    {
        let probe_shared_config = Arc::clone(&shared_config);
        let probe_results_cache = Arc::clone(&shared_probes);
        thread::spawn(move || {
            let mut last_probe_time = Instant::now() - Duration::from_secs(3600);
            let mut last_config_rev = 0u64;
            loop {
                let (probe_interval, probes, allow_private, config_rev) = {
                    let cfg = probe_shared_config.read().unwrap();
                    (
                        cfg.probe_interval_sec,
                        cfg.probes.clone(),
                        cfg.allow_private_probes,
                        cfg.config_rev,
                    )
                };

                let now = Instant::now();
                if (!probes.is_empty() && last_config_rev != config_rev)
                    || now.duration_since(last_probe_time) >= Duration::from_secs(probe_interval)
                {
                    last_config_rev = config_rev;
                    let mut current_results = Vec::new();
                    for target in &probes {
                        let res = if target.method == "icmp" {
                            execute_icmp_probe(&target.id, &target.host, allow_private)
                        } else {
                            execute_tcp_probe(
                                &target.id,
                                &target.host,
                                target.port.unwrap_or(80),
                                allow_private,
                            )
                        };
                        current_results.push(res);
                    }
                    // Record finish time so interval timing is measured from probe completion
                    last_probe_time = Instant::now();
                    if let Ok(mut cache) = probe_results_cache.write() {
                        *cache = current_results;
                    }
                }

                thread::sleep(Duration::from_millis(500));
            }
        });
    }

    // 5. Thread 2: Collector Loop (2s Sample, non-blocking 0us probe reading)
    {
        let shared_buffer = Arc::clone(&shared_buffer);
        let shared_config = Arc::clone(&shared_config);
        let shared_probes = Arc::clone(&shared_probes);
        let boot_id = boot_id.clone();
        let detection = detection.clone();
        let cgroup_ctx = cgroup_ctx.clone();

        thread::spawn(move || {
            let mut cpu_collector = CpuCollector::new(scope, cgroup_ctx.clone());
            let memory_collector = MemoryCollector::new(scope, cgroup_ctx.clone());
            let disk_collector = DiskCollector::new(detection.env_type.clone());
            let mut io_collector = IoCollector::new(scope, cgroup_ctx.clone());
            let mut net_collector = NetworkCollector::new("auto".to_string(), boot_id.clone());
            let uptime_collector = UptimeCollector::new(detection.env_type.clone());

            let mut last_sample_time = Instant::now() - Duration::from_secs(10);
            let mut current_interface = "auto".to_string();

            let mut mock_uptime = 1_245_600u64;
            let mut mock_rx_total = 1_572_864_000u64;
            let mut mock_tx_total = 524_288_000u64;

            loop {
                let now = Instant::now();
                let (sample_interval, config_rev, net_iface) = {
                    let cfg = shared_config.read().unwrap();
                    (
                        cfg.sample_interval_sec,
                        cfg.config_rev,
                        cfg.network_interface.clone(),
                    )
                };

                // Dynamic network interface update
                if net_iface != current_interface {
                    info!("[Collector] Switching network interface to: {}", net_iface);
                    net_collector.set_interface(net_iface.clone());
                    current_interface = net_iface;
                }

                // Fast System Metric Sampling (2s)
                if now.duration_since(last_sample_time) >= Duration::from_secs(sample_interval) {
                    last_sample_time = now;
                    let probe_results = shared_probes.read().map(|p| p.clone()).unwrap_or_default();

                    let snapshot = if is_mock {
                        mock_uptime += sample_interval;
                        let rx_delta = (1_200_000 + (current_ts_ms() % 500_000)) * sample_interval;
                        let tx_delta = (450_000 + (current_ts_ms() % 200_000)) * sample_interval;
                        mock_rx_total += rx_delta;
                        mock_tx_total += tx_delta;

                        let cpu_pct = 14.0 + ((current_ts_ms() % 12000) as f64 / 1000.0);
                        ReportData {
                            config_rev,
                            boot_id: Some("mock-boot-id-4bc98ba4".to_string()),
                            cpu: CpuMetrics {
                                usage_pct: Some((cpu_pct * 10.0).round() / 10.0),
                                throttled_pct: Some(0.0),
                                temp_celsius: Some(42.5),
                                load1: Some(0.35),
                                load5: Some(0.28),
                                load15: Some(0.19),
                                process_total_count: Some(186),
                                process_running_count: Some(2),
                            },
                            memory: MemoryMetrics {
                                used_bytes: Some(2_147_483_648 + (current_ts_ms() % 80_000_000)),
                                working_set_bytes: Some(1_610_612_736),
                                swap_used_bytes: Some(67_108_864),
                                oom_kill_count: Some(0),
                            },
                            rootfs: RootfsMetrics {
                                used_bytes: Some(34_359_738_368),
                                mounts: None,
                            },
                            io: DiskIoMetrics {
                                read_bps: Some(1_048_576),
                                write_bps: Some(2_097_152),
                                read_iops: Some(120),
                                write_iops: Some(380),
                                io_util_pct: Some(4.5),
                            },
                            network: NetworkMetrics {
                                counter_id: Some("mock-net-counter".to_string()),
                                interface: "eth0".to_string(),
                                rx_bps: Some(rx_delta / sample_interval),
                                tx_bps: Some(tx_delta / sample_interval),
                                rx_total_bytes: mock_rx_total,
                                tx_total_bytes: mock_tx_total,
                                tcp_established_count: Some(28),
                                tcp_tw_count: Some(12),
                                tcp_total_count: Some(45),
                                udp_in_use: Some(6),
                            },
                            uptime_sec: Some(mock_uptime),
                            probes: vec![ProbeResult {
                                id: "Cloudflare 1.1.1.1".to_string(),
                                status: "ok".to_string(),
                                latency_ms: Some(11.8),
                                loss_ratio: 0.0,
                            }],
                        }
                    } else {
                        ReportData {
                            config_rev,
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

                    // Push sample into bounded RAM SampleBuffer (Max 300 samples, ~10 mins)
                    if let Ok(mut buf) = shared_buffer.lock() {
                        buf.sample_seq += 1;
                        let seq = buf.sample_seq;
                        buf.samples.push_back(MetricSample {
                            sample_seq: seq,
                            sampled_at_ms: current_ts_ms(),
                            metrics: snapshot,
                        });
                        if buf.samples.len() > 300 {
                            buf.samples.pop_front();
                            buf.dropped_samples += 1;
                            warn!(
                                "[Buffer] Overflow! Dropped oldest sample. Total dropped: {}",
                                buf.dropped_samples
                            );
                        }
                    }
                }

                thread::sleep(Duration::from_millis(200));
            }
        });
    }

    // 5. Thread 2: Transport Loop (WSS Primary Stream + HTTP Fallback)
    let instance_id = Uuid::new_v4().to_string();
    let mut seq: u64 = 1;
    let mut http_registered = false;
    let mut backoff = Backoff::new();
    let http_client = HttpClient::new(
        config.server_url.clone(),
        config.node_id.clone(),
        config.token.clone(),
    );

    info!("[Transport] Initialized with instance_id: {}", instance_id);

    // Prepare Accurate Hello Payload (Accuracy First)
    let hello_payload = HelloData {
        agent: AgentInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            arch: std::env::consts::ARCH.to_string(),
        },
        system: SystemInfo {
            hostname: hostname.clone(),
            os: if cfg!(windows) {
                "windows".to_string()
            } else {
                "linux".to_string()
            },
            os_version: get_os_version(),
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
            cpu_capacity_cores: Some(true_cpu_capacity),
            memory_limit_bytes: true_mem_limit,
            swap_limit_bytes: true_swap_limit,
            rootfs_limit_bytes: true_rootfs_limit,
            rootfs_scope: true_rootfs_scope,
        },
        sources: MetricSources {
            cpu: if is_container {
                "cgroup".to_string()
            } else {
                "procfs".to_string()
            },
            memory: if is_container {
                "cgroup".to_string()
            } else {
                "procfs".to_string()
            },
            io: if is_container {
                "cgroup".to_string()
            } else {
                "diskstats".to_string()
            },
            network: "netns".to_string(),
            rootfs: "statvfs".to_string(),
        },
        capabilities: CapabilitiesInfo {
            icmp_probe: edgemon_agent::probe::icmp::can_use_icmp(),
            tcp_probe: true,
        },
        boot_id: boot_id.clone(),
        network_counter_id: initial_net_counter_id,
    };

    loop {
        info!("[WSS] Attempting stream connection...");

        match WsTransport::connect(
            &config.server_url,
            &config.node_id,
            &config.token,
            &instance_id,
            config.allow_http,
        ) {
            Ok(mut ws) => {
                // Step A: Send Hello
                match ws.send_hello(seq, hello_payload.clone()) {
                    Ok(welcome) => {
                        info!(
                            "[WSS] Stream Handshake Complete! Active config revision: {}",
                            welcome.config_rev
                        );
                        seq += 1;
                        backoff.reset();

                        {
                            let mut cfg_guard = shared_config.write().unwrap();
                            cfg_guard.config_rev = welcome.config_rev;
                            cfg_guard.sample_interval_sec =
                                welcome.config.sample_interval_sec.clamp(1, 60);
                            cfg_guard.stream_interval_sec =
                                welcome.config.stream_interval_sec.clamp(1, 60);
                            cfg_guard.probe_interval_sec =
                                welcome.config.probe_interval_sec.clamp(10, 3600);
                            cfg_guard.network_interface = welcome.config.network_interface;
                            cfg_guard.probes = welcome.config.probes;
                        }

                        // Align persisted_sample_seq watermark from Welcome
                        {
                            if let Ok(mut buf) = shared_buffer.lock() {
                                if welcome.persisted_instance_id.as_deref() == Some(&instance_id) {
                                    if let Some(p_seq) = welcome.persisted_sample_seq {
                                        buf.persisted_sample_seq =
                                            buf.persisted_sample_seq.max(p_seq);
                                        let target_p_seq = buf.persisted_sample_seq;
                                        let before_len = buf.samples.len();
                                        buf.samples.retain(|s| s.sample_seq > target_p_seq);
                                        let freed = before_len - buf.samples.len();
                                        info!(
                                            "[Transport] Welcome synced persisted_sample_seq: {} (freed {} cached samples)",
                                            buf.persisted_sample_seq, freed
                                        );
                                    }
                                }
                                buf.last_sent_sample_seq = buf.persisted_sample_seq;
                            }
                        }

                        // Step B: STREAMING LOOP (every stream_interval_sec, default 2s)
                        let mut last_report_time = Instant::now() - Duration::from_secs(10);

                        loop {
                            let stream_interval =
                                { shared_config.read().unwrap().stream_interval_sec };

                            // Send Report samples batch (up to 16 samples per report)
                            if last_report_time.elapsed() >= Duration::from_secs(stream_interval) {
                                last_report_time = Instant::now();

                                let (batch_samples, dropped) = {
                                    if let Ok(buf) = shared_buffer.lock() {
                                        let unsent: Vec<MetricSample> = buf
                                            .samples
                                            .iter()
                                            .filter(|s| s.sample_seq > buf.last_sent_sample_seq)
                                            .take(300)
                                            .cloned()
                                            .collect();
                                        (unsent, buf.dropped_samples)
                                    } else {
                                        (Vec::new(), 0)
                                    }
                                };

                                if !batch_samples.is_empty() {
                                    for chunk in batch_samples.chunks(48) {
                                        let max_batch_seq =
                                            chunk.iter().map(|s| s.sample_seq).max().unwrap_or(0);
                                        let payload = ReportPayload {
                                            samples: chunk.to_vec(),
                                            dropped_samples: dropped,
                                        };
                                        if let Err(e) = ws.send_report(seq, payload) {
                                            warn!("[WSS] Failed to send report frame: {}", e);
                                            break;
                                        }
                                        seq += 1;
                                        if let Ok(mut buf) = shared_buffer.lock() {
                                            buf.last_sent_sample_seq =
                                                buf.last_sent_sample_seq.max(max_batch_seq);
                                        }
                                    }
                                }
                            }

                            // Send RFC6455 Keepalive Ping & Check Pong Timeout
                            if let Err(e) = ws.tick_keepalive() {
                                warn!("[WSS] Keepalive / Pong error: {}", e);
                                break;
                            }

                            // Poll Incoming Events (Config push, Ack, Close)
                            if let Some(event) = ws.poll_incoming() {
                                match event {
                                    WsEvent::ConfigPushed(new_cfg, rev) => {
                                        info!("[WSS] Applying pushed config revision: {}", rev);
                                        {
                                            let mut cfg_guard = shared_config.write().unwrap();
                                            cfg_guard.config_rev = rev;
                                            cfg_guard.sample_interval_sec =
                                                new_cfg.sample_interval_sec.clamp(1, 60);
                                            cfg_guard.stream_interval_sec =
                                                new_cfg.stream_interval_sec.clamp(1, 60);
                                            cfg_guard.probe_interval_sec =
                                                new_cfg.probe_interval_sec.clamp(10, 3600);
                                            cfg_guard.network_interface = new_cfg.network_interface;
                                            cfg_guard.probes = new_cfg.probes;
                                        }
                                        let _ = ws.send_config_ack(seq, rev);
                                        seq += 1;
                                    }
                                    WsEvent::AckReceived {
                                        config_rev,
                                        persisted_sample_seq,
                                    } => {
                                        log::debug!("[WSS] Server ACK checkpoint (rev: {}, persisted_sample_seq: {:?})", config_rev, persisted_sample_seq);
                                        if let Some(watermark) = persisted_sample_seq {
                                            if let Ok(mut buf) = shared_buffer.lock() {
                                                buf.persisted_sample_seq =
                                                    buf.persisted_sample_seq.max(watermark);
                                                let target_p_seq = buf.persisted_sample_seq;
                                                let before_len = buf.samples.len();
                                                buf.samples.retain(|s| s.sample_seq > target_p_seq);
                                                let freed = before_len - buf.samples.len();
                                                if freed > 0 {
                                                    log::debug!(
                                                        "[Buffer] Cleaned {} ACKed samples up to sample_seq: {}",
                                                        freed, buf.persisted_sample_seq
                                                    );
                                                }
                                            }
                                        }
                                    }
                                    WsEvent::FatalClose(code, reason) => {
                                        error!("[WSS] Fatal auth/policy close from server ({}: {}). Terminating.", code, reason);
                                        return Ok(());
                                    }
                                    WsEvent::Disconnected(reason) => {
                                        warn!(
                                            "[WSS] Disconnected: {}. Entering HTTP fallback...",
                                            reason
                                        );
                                        break;
                                    }
                                }
                            }

                            thread::sleep(Duration::from_millis(50));
                        }
                    }
                    Err(AgentError::Fatal(msg)) => {
                        error!(
                            "[WSS] Fatal error from server: {}. Terminating agent process.",
                            msg
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        warn!("[WSS] Hello failed: {}", e);
                    }
                }
            }
            Err(AgentError::Fatal(msg)) => {
                error!(
                    "[WSS] Fatal connection error: {}. Terminating agent process.",
                    msg
                );
                return Ok(());
            }
            Err(e) => {
                warn!("[WSS] Connection failed: {}", e);
            }
        }

        // Step C: BACKOFF & HTTP FALLBACK (30s interval while WSS is disconnected)
        let retry_delay = backoff.next_delay();
        info!(
            "[Transport] WSS disconnected. Retrying in {:?} (Running 30s HTTP fallback)...",
            retry_delay
        );

        let fallback_deadline = Instant::now() + retry_delay;
        let mut last_http_fallback_time = Instant::now() - Duration::from_secs(60);

        while Instant::now() < fallback_deadline {
            if last_http_fallback_time.elapsed() >= Duration::from_secs(30) {
                last_http_fallback_time = Instant::now();

                // 1. Ensure instance is registered via Hello first over HTTP
                if !http_registered {
                    let hello_env = Envelope::new(
                        "hello",
                        &instance_id,
                        seq,
                        current_ts_ms(),
                        hello_payload.clone(),
                    );
                    match http_client.send_hello(&hello_env) {
                        Ok(welcome) => {
                            info!("[HTTP Fallback] Successfully registered via Hello (Config rev: {})", welcome.config_rev);
                            http_registered = true;
                            seq += 1;
                            {
                                let mut cfg_guard = shared_config.write().unwrap();
                                cfg_guard.config_rev = welcome.config_rev;
                                cfg_guard.sample_interval_sec =
                                    welcome.config.sample_interval_sec.clamp(1, 60);
                                cfg_guard.stream_interval_sec =
                                    welcome.config.stream_interval_sec.clamp(1, 60);
                                cfg_guard.probe_interval_sec =
                                    welcome.config.probe_interval_sec.clamp(10, 3600);
                                cfg_guard.network_interface = welcome.config.network_interface;
                                cfg_guard.probes = welcome.config.probes;
                            }
                            if let Ok(mut buf) = shared_buffer.lock() {
                                if welcome.persisted_instance_id.as_deref() == Some(&instance_id) {
                                    if let Some(p_seq) = welcome.persisted_sample_seq {
                                        buf.persisted_sample_seq =
                                            buf.persisted_sample_seq.max(p_seq);
                                        let target_p_seq = buf.persisted_sample_seq;
                                        buf.samples.retain(|s| s.sample_seq > target_p_seq);
                                    }
                                }
                                buf.last_sent_sample_seq = buf.persisted_sample_seq;
                            }
                        }
                        Err(e) => {
                            warn!("[HTTP Fallback] Hello failed: {}", e);
                            if e.to_string().contains("INSTANCE_MISMATCH")
                                || e.to_string().contains("TOKEN_REVOKED")
                                || e.to_string().contains("NODE_DISABLED")
                            {
                                error!(
                                    "[HTTP Fallback] Fatal error during Hello ({}). Terminating agent process.",
                                    e
                                );
                                return Ok(());
                            }
                        }
                    }
                }

                // 2. Send HTTP Report if registered
                if http_registered {
                    let (batch_samples, dropped) = {
                        if let Ok(buf) = shared_buffer.lock() {
                            let unsent: Vec<MetricSample> = buf
                                .samples
                                .iter()
                                .filter(|s| s.sample_seq > buf.persisted_sample_seq)
                                .take(300)
                                .cloned()
                                .collect();
                            (unsent, buf.dropped_samples)
                        } else {
                            (Vec::new(), 0)
                        }
                    };

                    if !batch_samples.is_empty() {
                        let payload = ReportPayload {
                            samples: batch_samples,
                            dropped_samples: dropped,
                        };
                        let report_env =
                            Envelope::new("report", &instance_id, seq, current_ts_ms(), payload);
                        match http_client.send_report(&report_env) {
                            Ok(ack) => {
                                info!(
                                    "[HTTP Fallback] Sent 30s report batch #{} (Server ACK rev: {}, persisted_sample_seq: {:?})",
                                    seq, ack.config_rev, ack.persisted_sample_seq
                                );
                                seq += 1;
                                if let Some(p_seq) = ack.persisted_sample_seq {
                                    if let Ok(mut buf) = shared_buffer.lock() {
                                        buf.persisted_sample_seq =
                                            buf.persisted_sample_seq.max(p_seq);
                                        let target_p_seq = buf.persisted_sample_seq;
                                        buf.samples.retain(|s| s.sample_seq > target_p_seq);
                                    }
                                }
                                let current_rev = shared_config.read().unwrap().config_rev;
                                if ack.config_rev > current_rev {
                                    info!("[HTTP Fallback] Server has newer config rev {} > {}. Triggering re-hello.", ack.config_rev, current_rev);
                                    http_registered = false;
                                }
                            }
                            Err(e) => {
                                warn!("[HTTP Fallback] Report failed: {}", e);
                                if e.to_string().contains("INSTANCE_MISMATCH") {
                                    error!("[HTTP Fallback] Instance mismatch: replaced by another agent instance. Terminating agent process.");
                                    return Ok(());
                                }
                                if e.to_string().contains("HELLO_REQUIRED")
                                    || e.to_string().contains("STALE_OR_DUPLICATE_SEQ")
                                    || e.to_string().contains("NON_MONOTONIC_SEQ")
                                {
                                    http_registered = false;
                                    seq += 1;
                                }
                            }
                        }
                    }
                }
            }

            thread::sleep(Duration::from_millis(200));
        }
    }
}
