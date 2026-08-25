use edgemon_agent::env::cgroup::parse_cpuset_count;

#[test]
fn test_parse_cpuset_ranges() {
    assert_eq!(parse_cpuset_count("0"), Some(1));
    assert_eq!(parse_cpuset_count("0-3"), Some(4));
    assert_eq!(parse_cpuset_count("0-1,3"), Some(3));
    assert_eq!(parse_cpuset_count("0-7,16-23"), Some(16));
    assert_eq!(parse_cpuset_count(""), None);
    assert_eq!(parse_cpuset_count("   "), None);
}
