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
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
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
                dest_addr.sin_addr.s_addr = u32::from_ne_bytes(ipv4_addr.octets());

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

    #[cfg(target_os = "windows")]
    {
        use std::net::IpAddr;
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

        for _ in 1..=total_samples {
            if let Some(rtt) = win_icmp::ping_v4(ipv4_addr, 1500) {
                latencies.push(rtt);
            } else {
                failed_samples += 1;
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

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
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

#[cfg(target_os = "windows")]
mod win_icmp {
    use std::ffi::c_void;
    use std::net::Ipv4Addr;

    #[repr(C)]
    struct IpOptionInformation {
        ttl: u8,
        tos: u8,
        flags: u8,
        options_size: u8,
        options_data: *mut u8,
    }

    #[repr(C)]
    struct IcmpEchoReply {
        address: u32,
        status: u32,
        round_trip_time: u32,
        data_size: u16,
        reserved: u16,
        data: *mut c_void,
        options: IpOptionInformation,
    }

    #[link(name = "iphlpapi")]
    extern "system" {
        fn IcmpCreateFile() -> *mut c_void;
        fn IcmpCloseHandle(handle: *mut c_void) -> i32;
        fn IcmpSendEcho(
            handle: *mut c_void,
            destination_address: u32,
            request_data: *const c_void,
            request_size: u16,
            request_options: *mut IpOptionInformation,
            reply_buffer: *mut c_void,
            reply_size: u32,
            timeout: u32,
        ) -> u32;
    }

    pub fn ping_v4(ip: Ipv4Addr, timeout_ms: u32) -> Option<f64> {
        unsafe {
            let handle = IcmpCreateFile();
            if handle.is_null() || handle as isize == -1 {
                return None;
            }
            let send_data = [0u8; 32];
            let reply_buf_size = std::mem::size_of::<IcmpEchoReply>() + 32 + 8;
            let mut reply_buf = vec![0u8; reply_buf_size];
            let dest_u32 = u32::from_ne_bytes(ip.octets());

            let ret = IcmpSendEcho(
                handle,
                dest_u32,
                send_data.as_ptr() as *const c_void,
                send_data.len() as u16,
                std::ptr::null_mut(),
                reply_buf.as_mut_ptr() as *mut c_void,
                reply_buf_size as u32,
                timeout_ms,
            );

            IcmpCloseHandle(handle);

            if ret > 0 {
                let reply = &*(reply_buf.as_ptr() as *const IcmpEchoReply);
                if reply.status == 0 {
                    return Some(reply.round_trip_time as f64);
                }
            }
            None
        }
    }
}
