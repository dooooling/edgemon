use crate::probe::tcp::execute_tcp_probe;
use crate::protocol::ProbeResult;

pub fn execute_icmp_probe(id: &str, host: &str, allow_private: bool) -> ProbeResult {
    // In unprivileged Linux containers without ICMP raw sockets, fallback to TCP probe on port 80/443
    // For standard V1, default to port 443 TCP fallback check if raw ICMP socket isn't available
    execute_tcp_probe(id, host, 443, allow_private)
}
