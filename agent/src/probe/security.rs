use crate::error::{EdgeMonError, Result};
use std::net::{IpAddr, ToSocketAddrs};

pub fn is_private_or_loopback(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            let octets = ipv4.octets();
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || ipv4.is_broadcast()
                || ipv4.is_unspecified()
                || octets[0] == 0 // 0.0.0.0/8
                || (octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127) // CGNAT (RFC 6598) 100.64.0.0/10
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0) // IETF Protocol Assignments (RFC 6890)
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)) // Benchmark Testing (RFC 2544)
                || octets[0] >= 224 // Multicast & Reserved (224.0.0.0/4 and 240.0.0.0/4)
        }
        IpAddr::V6(ipv6) => {
            if let Some(v4) = ipv6.to_ipv4_mapped() {
                return is_private_or_loopback(&IpAddr::V4(v4));
            }
            ipv6.is_loopback()
                || ipv6.is_unspecified()
                || (ipv6.segments()[0] & 0xfe00) == 0xfc00 // ULA (fc00::/7)
                || (ipv6.segments()[0] & 0xffc0) == 0xfe80 // Link-local (fe80::/10)
                || (ipv6.segments()[0] & 0xff00) == 0xff00 // Multicast (ff00::/8)
                || (ipv6.segments()[0] == 0x2001 && ipv6.segments()[1] == 0x0db8) // Documentation (2001:db8::/32)
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

    if !allow_private {
        // Fail-Closed: If ANY resolved IP is private or restricted, reject entire target
        for ip in &addrs {
            if is_private_or_loopback(ip) {
                return Err(EdgeMonError::Security(format!(
                    "Probing private/loopback destination '{host}' ({ip}) is prohibited"
                )));
            }
        }
    }

    // Prefer IPv4 among resolved candidates, otherwise fallback to first IP
    let selected_ip = addrs
        .iter()
        .copied()
        .find(|ip| ip.is_ipv4())
        .or_else(|| addrs.first().copied());

    if let Some(ip) = selected_ip {
        return Ok(ip);
    }

    Err(EdgeMonError::Security(format!(
        "No IP address resolved for {host}"
    )))
}
