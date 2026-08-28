use crate::probe::security::validate_and_resolve_target;
use crate::protocol::ProbeResult;
#[cfg(target_os = "linux")]
use std::net::IpAddr;
#[cfg(target_os = "linux")]
use std::time::Instant;

#[cfg(target_os = "linux")]
#[repr(C)]
struct IcmpHeader {
    icmp_type: u8,
    icmp_code: u8,
    icmp_cksum: u16,
    icmp_id: u16,
    icmp_seq: u16,
}

pub fn can_use_icmp() -> bool {
    #[cfg(target_os = "linux")]
    {
        unsafe {
            // Strictly check unprivileged datagram ICMP socket to match probe execution
            let fd = libc::socket(libc::AF_INET, libc::SOCK_DGRAM, libc::IPPROTO_ICMP);
            if fd >= 0 {
                libc::close(fd);
                return true;
            }
        }
        false
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

pub fn execute_icmp_probe(id: &str, host: &str, allow_private: bool) -> ProbeResult {
    if !can_use_icmp() {
        return ProbeResult {
            id: id.to_string(),
            status: "unsupported".to_string(),
            latency_ms: None,
            loss_ratio: 1.0,
        };
    }

    // SSRF Check: resolve DNS first then inspect destination IP
    let ip = match validate_and_resolve_target(host, 0, allow_private) {
        Ok(ip) => ip,
        Err(e) => {
            let status = if e.to_string().contains("prohibited") {
                "private_target_blocked".to_string()
            } else {
                "dns_error".to_string()
            };
            return ProbeResult {
                id: id.to_string(),
                status,
                latency_ms: None,
                loss_ratio: 1.0,
            };
        }
    };

    #[cfg(target_os = "linux")]
    {
        let ipv4_addr = match ip {
            IpAddr::V4(v4) => v4,
            IpAddr::V6(_) => {
                return ProbeResult {
                    id: id.to_string(),
                    status: "unsupported".to_string(),
                    latency_ms: None,
                    loss_ratio: 1.0,
                };
            }
        };

        let mut latencies: Vec<f64> = Vec::new();
        let total_samples = 3;
        let mut failed_samples = 0;

        for seq in 1..=total_samples {
            unsafe {
                let fd = libc::socket(libc::AF_INET, libc::SOCK_DGRAM, libc::IPPROTO_ICMP);
                if fd < 0 {
                    failed_samples += 1;
                    continue;
                }

                let mut dest_addr: libc::sockaddr_in = std::mem::zeroed();
                dest_addr.sin_family = libc::AF_INET as libc::sa_family_t;

                let ip_str = ipv4_addr.to_string();
                let ip_cstr = match std::ffi::CString::new(ip_str) {
                    Ok(s) => s,
                    Err(_) => {
                        libc::close(fd);
                        failed_samples += 1;
                        continue;
                    }
                };

                if libc::inet_pton(
                    libc::AF_INET,
                    ip_cstr.as_ptr(),
                    &mut dest_addr.sin_addr as *mut _ as *mut libc::c_void,
                ) <= 0
                {
                    libc::close(fd);
                    failed_samples += 1;
                    continue;
                }

                let packet = IcmpHeader {
                    icmp_type: 8, // ICMP Echo Request
                    icmp_code: 0,
                    icmp_cksum: 0,
                    icmp_id: (libc::getpid() as u32 & 0xFFFF) as u16,
                    icmp_seq: seq as u16,
                };

                // In SOCK_DGRAM ICMP sockets, the Linux kernel calculates the ICMP checksum automatically
                let start_time = Instant::now();
                let send_res = libc::sendto(
                    fd,
                    &packet as *const _ as *const libc::c_void,
                    std::mem::size_of::<IcmpHeader>(),
                    0,
                    &dest_addr as *const _ as *const libc::sockaddr,
                    std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t,
                );

                if send_res < 0 {
                    libc::close(fd);
                    failed_samples += 1;
                    continue;
                }

                let mut pfd = libc::pollfd {
                    fd,
                    events: libc::POLLIN,
                    revents: 0,
                };

                let poll_res = libc::poll(&mut pfd, 1, 1000); // 1000ms timeout
                if poll_res > 0 && (pfd.revents & libc::POLLIN) != 0 {
                    let mut recv_buf = [0u8; 128];
                    let recv_len = libc::recv(
                        fd,
                        recv_buf.as_mut_ptr() as *mut libc::c_void,
                        recv_buf.len(),
                        0,
                    );
                    if recv_len >= std::mem::size_of::<IcmpHeader>() as isize {
                        let rtt = start_time.elapsed().as_secs_f64() * 1000.0;
                        latencies.push(rtt);
                    } else {
                        failed_samples += 1;
                    }
                } else {
                    failed_samples += 1;
                }

                libc::close(fd);
            }
        }

        let loss_ratio = failed_samples as f64 / total_samples as f64;
        if latencies.is_empty() {
            ProbeResult {
                id: id.to_string(),
                status: "timeout".to_string(),
                latency_ms: None,
                loss_ratio,
            }
        } else {
            let avg_latency = latencies.iter().sum::<f64>() / latencies.len() as f64;
            ProbeResult {
                id: id.to_string(),
                status: "ok".to_string(),
                latency_ms: Some((avg_latency * 10.0).round() / 10.0),
                loss_ratio,
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = ip;
        ProbeResult {
            id: id.to_string(),
            status: "unsupported".to_string(),
            latency_ms: None,
            loss_ratio: 1.0,
        }
    }
}
