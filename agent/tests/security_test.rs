use edgemon_agent::probe::security::is_private_or_loopback;
use std::net::IpAddr;

#[test]
fn test_loopback_and_private_ipv4() {
    assert!(is_private_or_loopback(
        &"127.0.0.1".parse::<IpAddr>().unwrap()
    ));
    assert!(is_private_or_loopback(
        &"10.0.0.1".parse::<IpAddr>().unwrap()
    ));
    assert!(is_private_or_loopback(
        &"172.16.0.1".parse::<IpAddr>().unwrap()
    ));
    assert!(is_private_or_loopback(
        &"192.168.1.1".parse::<IpAddr>().unwrap()
    ));
    assert!(is_private_or_loopback(
        &"169.254.1.1".parse::<IpAddr>().unwrap()
    ));
    assert!(is_private_or_loopback(
        &"0.0.0.0".parse::<IpAddr>().unwrap()
    ));
    assert!(is_private_or_loopback(
        &"100.64.0.1".parse::<IpAddr>().unwrap()
    )); // CGNAT
    assert!(is_private_or_loopback(
        &"224.0.0.1".parse::<IpAddr>().unwrap()
    )); // Multicast

    // Public IP must return false
    assert!(!is_private_or_loopback(
        &"1.1.1.1".parse::<IpAddr>().unwrap()
    ));
    assert!(!is_private_or_loopback(
        &"8.8.8.8".parse::<IpAddr>().unwrap()
    ));
    assert!(!is_private_or_loopback(
        &"104.16.132.229".parse::<IpAddr>().unwrap()
    ));
}

#[test]
fn test_loopback_and_private_ipv6() {
    assert!(is_private_or_loopback(&"::1".parse::<IpAddr>().unwrap()));
    assert!(is_private_or_loopback(&"::".parse::<IpAddr>().unwrap()));
    assert!(is_private_or_loopback(
        &"fe80::1".parse::<IpAddr>().unwrap()
    )); // Link local
    assert!(is_private_or_loopback(
        &"fc00::1".parse::<IpAddr>().unwrap()
    )); // ULA
    assert!(is_private_or_loopback(
        &"::ffff:127.0.0.1".parse::<IpAddr>().unwrap()
    )); // IPv4-mapped loopback
    assert!(is_private_or_loopback(
        &"::ffff:10.0.0.1".parse::<IpAddr>().unwrap()
    )); // IPv4-mapped private
    assert!(is_private_or_loopback(
        &"ff02::1".parse::<IpAddr>().unwrap()
    )); // IPv6 Multicast

    // Public IPv6
    assert!(!is_private_or_loopback(
        &"2606:4700:4700::1111".parse::<IpAddr>().unwrap()
    ));
}

#[test]
fn test_validate_and_resolve_target_localhost_blocked_by_default() {
    let res = edgemon_agent::probe::security::validate_and_resolve_target("127.0.0.1", 80, false);
    assert!(res.is_err());
    assert!(res.unwrap_err().to_string().contains("prohibited"));

    let res_allowed =
        edgemon_agent::probe::security::validate_and_resolve_target("127.0.0.1", 80, true);
    assert!(res_allowed.is_ok());
    assert_eq!(res_allowed.unwrap(), "127.0.0.1".parse::<IpAddr>().unwrap());
}
