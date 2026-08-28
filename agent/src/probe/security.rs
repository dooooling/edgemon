use crate::error::{EdgeMonError, Result};
use std::net::{IpAddr, ToSocketAddrs};

pub fn is_private_or_loopback(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || ipv4.is_broadcast()
                || ipv4.is_unspecified()
        }
        IpAddr::V6(ipv6) => {
            ipv6.is_loopback()
                || ipv6.is_unspecified()
                || (ipv6.segments()[0] & 0xfe00) == 0xfc00 // ULA
                || (ipv6.segments()[0] & 0xffc0) == 0xfe80 // Link-local
        }
    }
}

pub fn validate_and_resolve_target(host: &str, port: u16, allow_private: bool) -> Result<IpAddr> {
    let target = format!("{host}:{port}");
    let addrs: Vec<_> = target
        .to_socket_addrs()
        .map_err(|e| EdgeMonError::Security(format!("DNS resolution failed for {host}: {e}")))?
        .collect();

    // Prefer IPv4 if available to support IPv4 ping sockets on dual-stack hosts
    let selected_ip = addrs
        .iter()
        .map(|s| s.ip())
        .find(|ip| ip.is_ipv4())
        .or_else(|| addrs.first().map(|s| s.ip()));

    if let Some(ip) = selected_ip {
        if !allow_private && is_private_or_loopback(&ip) {
            return Err(EdgeMonError::Security(format!(
                "Probing private/loopback destination '{host}' ({ip}) is prohibited"
            )));
        }
        return Ok(ip);
    }

    Err(EdgeMonError::Security(format!(
        "No IP address resolved for {host}"
    )))
}
