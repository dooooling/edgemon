use crate::protocol::NetworkMetrics;
use sha2::{Digest, Sha256};
use std::fs;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct NetCounters {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

pub fn compute_rates(
    prev: Option<NetCounters>,
    curr: Option<NetCounters>,
    elapsed_sec: f64,
) -> (Option<u64>, Option<u64>) {
    match (prev, curr) {
        (Some(p), Some(c)) if elapsed_sec > 0.0 => {
            if c.rx_bytes >= p.rx_bytes && c.tx_bytes >= p.tx_bytes {
                let rx_delta = c.rx_bytes - p.rx_bytes;
                let tx_delta = c.tx_bytes - p.tx_bytes;

                let rx_rate = (rx_delta as f64) / elapsed_sec;
                let tx_rate = (tx_delta as f64) / elapsed_sec;

                (Some(rx_rate.round() as u64), Some(tx_rate.round() as u64))
            } else {
                // Counter rolled over or interface reset: rate is None (Golden Rule 1: Accuracy First, never negative rates)
                (None, None)
            }
        }
        _ => (None, None),
    }
}

pub struct NetworkCollector {
    configured_interface: String,
    active_interface: String,
    boot_id: Option<String>,
    counter_id: Option<String>,

    latest_metrics: NetworkMetrics,
    last_counters: Option<NetCounters>,
    last_sample_instant: Option<Instant>,
    has_successful_read: bool,
}

impl NetworkCollector {
    pub fn new(configured_interface: String, boot_id: Option<String>) -> Self {
        let active_interface = if configured_interface == "auto" {
            discover_default_interface().unwrap_or_else(|| "eth0".to_string())
        } else {
            configured_interface.clone()
        };

        let counter_id = generate_counter_id(boot_id.as_deref(), &active_interface);

        Self {
            configured_interface,
            active_interface: active_interface.clone(),
            boot_id,
            counter_id: counter_id.clone(),
            latest_metrics: NetworkMetrics {
                interface: active_interface,
                counter_id,
                rx_bps: None,
                tx_bps: None,
                rx_total_bytes: 0,
                tx_total_bytes: 0,
                ..Default::default()
            },
            last_counters: None,
            last_sample_instant: None,
            has_successful_read: false,
        }
    }

    pub fn active_interface(&self) -> &str {
        &self.active_interface
    }

    pub fn counter_id(&self) -> Option<&str> {
        self.counter_id.as_deref()
    }

    pub fn set_interface(&mut self, new_iface: String) {
        if self.configured_interface != new_iface {
            self.configured_interface = new_iface.clone();
            self.active_interface = if new_iface == "auto" {
                discover_default_interface().unwrap_or_else(|| "eth0".to_string())
            } else {
                new_iface
            };
            self.counter_id = generate_counter_id(self.boot_id.as_deref(), &self.active_interface);
            self.last_counters = None;
            self.last_sample_instant = None;
            self.has_successful_read = false;
        }
    }

    pub fn sample(&mut self) -> NetworkMetrics {
        let now = Instant::now();

        // Guard against back-to-back calls within 500ms
        if let Some(last_time) = self.last_sample_instant {
            if now.duration_since(last_time) < Duration::from_millis(500)
                && self.latest_metrics.rx_bps.is_some()
            {
                return self.latest_metrics.clone();
            }
        }

        // Auto-refresh interface if set to auto and current interface not found
        if self.configured_interface == "auto" {
            if let Some(discovered) = discover_default_interface() {
                if discovered != self.active_interface {
                    self.active_interface = discovered;
                    self.counter_id =
                        generate_counter_id(self.boot_id.as_deref(), &self.active_interface);
                    self.last_counters = None;
                    self.last_sample_instant = None;
                    self.has_successful_read = false;
                }
            }
        }

        let current_counters = read_network_counters(&self.active_interface);

        let elapsed_sec = self
            .last_sample_instant
            .map(|t| now.duration_since(t).as_secs_f64())
            .unwrap_or(0.0);

        let (rx_bps, tx_bps) = compute_rates(self.last_counters, current_counters, elapsed_sec);

        let (rx_total, tx_total, counter_id_to_report) = match current_counters {
            Some(c) => {
                self.has_successful_read = true;
                self.last_counters = Some(c);
                self.last_sample_instant = Some(now);
                (c.rx_bytes, c.tx_bytes, self.counter_id.clone())
            }
            None => {
                // If reading failed, invalidate last_counters & instant to prevent inflated rate spikes (P1-2)
                self.last_counters = None;
                self.last_sample_instant = None;

                if self.has_successful_read {
                    (
                        self.latest_metrics.rx_total_bytes,
                        self.latest_metrics.tx_total_bytes,
                        self.counter_id.clone(),
                    )
                } else {
                    // Initial reading failed (P0-4): Report None counter_id to avoid fake 0 -> big delta
                    (0, 0, None)
                }
            }
        };

        let sock_stats = read_sockstat();

        let metrics = NetworkMetrics {
            interface: self.active_interface.clone(),
            counter_id: counter_id_to_report,
            rx_bps,
            tx_bps,
            rx_total_bytes: rx_total,
            tx_total_bytes: tx_total,
            tcp_established_count: sock_stats.as_ref().and_then(|s| s.tcp_established_count),
            tcp_tw_count: sock_stats.as_ref().and_then(|s| s.tcp_tw_count),
            tcp_total_count: sock_stats.as_ref().and_then(|s| s.tcp_total_count),
            udp_in_use: sock_stats.as_ref().and_then(|s| s.udp_in_use),
        };

        if metrics.rx_bps.is_some() || current_counters.is_some() {
            self.latest_metrics = metrics.clone();
        }

        metrics
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct SocketStats {
    tcp_established_count: Option<u32>,
    tcp_tw_count: Option<u32>,
    tcp_total_count: Option<u32>,
    udp_in_use: Option<u32>,
}

fn read_sockstat() -> Option<SocketStats> {
    #[cfg(unix)]
    {
        if let Ok(content) = fs::read_to_string("/proc/net/sockstat") {
            let mut stats = SocketStats::default();

            for line in content.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.is_empty() {
                    continue;
                }
                if parts[0] == "TCP:" {
                    for i in 1..parts.len() {
                        if parts[i] == "inuse" && i + 1 < parts.len() {
                            stats.tcp_established_count = parts[i + 1].parse::<u32>().ok();
                        } else if parts[i] == "tw" && i + 1 < parts.len() {
                            stats.tcp_tw_count = parts[i + 1].parse::<u32>().ok();
                        } else if parts[i] == "alloc" && i + 1 < parts.len() {
                            stats.tcp_total_count = parts[i + 1].parse::<u32>().ok();
                        }
                    }
                } else if parts[0] == "UDP:" {
                    for i in 1..parts.len() {
                        if parts[i] == "inuse" && i + 1 < parts.len() {
                            stats.udp_in_use = parts[i + 1].parse::<u32>().ok();
                        }
                    }
                }
            }

            return Some(stats);
        }
    }
    None
}

pub fn read_network_counters(target_iface: &str) -> Option<NetCounters> {
    #[cfg(windows)]
    {
        if let Some(c) = read_windows_network_counters(target_iface) {
            return Some(c);
        }
    }

    read_proc_net_dev_counters(target_iface)
}

#[cfg(windows)]
fn read_windows_network_counters(target_iface: &str) -> Option<NetCounters> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIfTable2, MIB_IF_TABLE2,
    };
    unsafe {
        let mut table_ptr: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut table_ptr) == 0 && !table_ptr.is_null() {
            let table = &*table_ptr;
            let num_entries = table.NumEntries as usize;
            let entries_slice = std::slice::from_raw_parts(table.Table.as_ptr(), num_entries);

            for entry in entries_slice {
                if entry.OperStatus == 1 && entry.Type != 24 {
                    let alias = String::from_utf16_lossy(&entry.Alias);
                    let alias_trimmed = alias.trim_matches('\0').trim();
                    let desc = String::from_utf16_lossy(&entry.Description);
                    let desc_trimmed = desc.trim_matches('\0').trim();

                    let is_match = alias_trimmed.eq_ignore_ascii_case(target_iface)
                        || desc_trimmed.eq_ignore_ascii_case(target_iface);

                    if is_match {
                        let counters = NetCounters {
                            rx_bytes: entry.InOctets,
                            tx_bytes: entry.OutOctets,
                        };
                        FreeMibTable(table_ptr as *const _);
                        return Some(counters);
                    }
                }
            }
            FreeMibTable(table_ptr as *const _);
        }
    }
    None
}

pub fn discover_default_interface() -> Option<String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::NetworkManagement::IpHelper::{
            FreeMibTable, GetIfTable2, MIB_IF_TABLE2,
        };
        unsafe {
            let mut table_ptr: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
            if GetIfTable2(&mut table_ptr) == 0 && !table_ptr.is_null() {
                let table = &*table_ptr;
                let num_entries = table.NumEntries as usize;
                let entries_slice = std::slice::from_raw_parts(table.Table.as_ptr(), num_entries);
                let mut best_iface: Option<String> = None;
                let mut max_bytes = 0u64;

                for entry in entries_slice {
                    // Type 6: Ethernet, Type 71: 802.11 Wireless
                    if entry.OperStatus == 1 && (entry.Type == 6 || entry.Type == 71) {
                        let alias = String::from_utf16_lossy(&entry.Alias);
                        let alias_trimmed = alias.trim_matches('\0').trim().to_string();
                        let bytes = entry.InOctets + entry.OutOctets;
                        if bytes >= max_bytes || best_iface.is_none() {
                            max_bytes = bytes;
                            best_iface = Some(alias_trimmed);
                        }
                    }
                }
                FreeMibTable(table_ptr as *const _);
                if let Some(iface) = best_iface {
                    return Some(iface);
                }
            }
        }
        Some("Ethernet".to_string())
    }

    #[cfg(not(windows))]
    {
        // 1. Check /proc/net/route for default gateway interface (Destination == 00000000)
        if let Ok(content) = fs::read_to_string("/proc/net/route") {
            for line in content.lines().skip(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 && parts[1] == "00000000" {
                    return Some(parts[0].to_string());
                }
            }
        }

        // 2. Fallback: First non-lo interface in /proc/net/dev
        if let Ok(content) = fs::read_to_string("/proc/net/dev") {
            for line in content.lines().skip(2) {
                if let Some(idx) = line.find(':') {
                    let iface = line[..idx].trim();
                    if iface != "lo"
                        && !iface.starts_with("docker")
                        && !iface.starts_with("veth")
                        && !iface.starts_with("br-")
                    {
                        return Some(iface.to_string());
                    }
                }
            }
        }

        None
    }
}

pub fn parse_proc_net_dev_str(content: &str, target_iface: &str) -> Option<NetCounters> {
    for line in content.lines().skip(2) {
        if let Some(idx) = line.find(':') {
            let iface = line[..idx].trim();
            if iface == target_iface {
                let parts: Vec<&str> = line[idx + 1..].split_whitespace().collect();
                if parts.len() >= 9 {
                    let rx_bytes = parts[0].parse::<u64>().ok()?;
                    let tx_bytes = parts[8].parse::<u64>().ok()?;
                    return Some(NetCounters { rx_bytes, tx_bytes });
                }
            }
        }
    }
    None
}

pub fn read_proc_net_dev_counters(target_iface: &str) -> Option<NetCounters> {
    let content = fs::read_to_string("/proc/net/dev").ok()?;
    parse_proc_net_dev_str(&content, target_iface)
}

pub fn get_netns_inode() -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(meta) = fs::metadata("/proc/self/ns/net") {
            return Some(meta.ino());
        }
    }
    None
}

pub fn generate_counter_id(boot_id: Option<&str>, iface: &str) -> Option<String> {
    let mut hasher = Sha256::new();
    hasher.update(boot_id.unwrap_or("nobootid").as_bytes());
    hasher.update(get_netns_inode().unwrap_or(0).to_string().as_bytes());
    hasher.update(iface.as_bytes());
    let hash = hasher.finalize();
    let hex = format!("{:x}", hash);
    Some(hex[..16].to_string())
}
