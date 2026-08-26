use crate::probe::security::validate_and_resolve_target;
use crate::protocol::ProbeResult;
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

pub fn execute_tcp_probe(id: &str, host: &str, port: u16, allow_private: bool) -> ProbeResult {
    let resolved_ip = match validate_and_resolve_target(host, port, allow_private) {
        Ok(ip) => ip,
        Err(err) => {
            let status = if err.to_string().contains("prohibited") {
                "permission_denied"
            } else {
                "dns_error"
            };
            return ProbeResult {
                id: id.to_string(),
                status: status.to_string(),
                latency_ms: None,
                loss_ratio: 1.0,
            };
        }
    };

    let socket_addr = SocketAddr::new(resolved_ip, port);
    let sample_count = 3;
    let timeout = Duration::from_secs(3);
    let mut latencies: Vec<f64> = Vec::with_capacity(sample_count);
    let mut failures = 0;

    for _ in 0..sample_count {
        let start = Instant::now();
        match TcpStream::connect_timeout(&socket_addr, timeout) {
            Ok(stream) => {
                let rtt = start.elapsed().as_secs_f64() * 1000.0;
                latencies.push(rtt);
                drop(stream);
            }
            Err(_) => {
                failures += 1;
            }
        }
    }

    let loss_ratio = (failures as f64) / (sample_count as f64);
    if latencies.is_empty() {
        ProbeResult {
            id: id.to_string(),
            status: "timeout".to_string(),
            latency_ms: None,
            loss_ratio: 1.0,
        }
    } else {
        latencies.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = latencies[latencies.len() / 2];
        ProbeResult {
            id: id.to_string(),
            status: "ok".to_string(),
            latency_ms: Some((median * 10.0).round() / 10.0),
            loss_ratio: (loss_ratio * 100.0).round() / 100.0,
        }
    }
}
