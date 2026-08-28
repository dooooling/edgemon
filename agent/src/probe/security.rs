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
    let addrs: Vec<IpAddr> = target
        .to_socket_addrs()
        .map_err(|e| EdgeMonError::Security(format!("DNS resolution failed for {host}: {e}")))?
        .map(|s| s.ip())
        .collect();

    if addrs.is_empty() {
        return Err(EdgeMonError::Security(format!(
            "No IP address resolved for {host}"
        )));
    }

    let valid_addrs: Vec<IpAddr> = if allow_private {
        addrs.clone()
    } else {
        addrs
            .iter()
            .copied()
            .filter(|ip| !is_private_or_loopback(ip))
            .collect()
    };

    if valid_addrs.is_empty() {
        return Err(EdgeMonError::Security(format!(
            "Probing private/loopback destination '{host}' ({}) is prohibited",
            addrs[0]
        )));
    }

    // Prefer IPv4 among valid candidates, otherwise fallback to first valid IP
    let selected_ip = valid_addrs
        .iter()
        .copied()
        .find(|ip| ip.is_ipv4())
        .or(valid_addrs.first().copied());

    if let Some(ip) = selected_ip {
        return Ok(ip);
    }

    Err(EdgeMonError::Security(format!(
        "No IP address resolved for {host}"
    )))
}
