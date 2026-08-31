-- EdgeMon D1 Schema Migration V1
-- Baseline Schema for Nodes, Metrics, Traffic, and Alerts

-- 1. General settings
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;

-- 2. Encrypted settings (AES-GCM encrypted tokens, webhook secrets)
CREATE TABLE IF NOT EXISTS secret_settings (
    key           TEXT PRIMARY KEY,
    nonce_b64     TEXT NOT NULL,
    cipher_b64    TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
) WITHOUT ROWID;

-- 3. Monitored nodes
CREATE TABLE IF NOT EXISTS nodes (
    id                       TEXT PRIMARY KEY,
    name                     TEXT NOT NULL,
    token_hash               TEXT NOT NULL UNIQUE,

    sort_order               INTEGER NOT NULL DEFAULT 0,
    hidden                   INTEGER NOT NULL DEFAULT 0,
    note                     TEXT,

    traffic_reset_day        INTEGER NOT NULL DEFAULT 1
                             CHECK (traffic_reset_day BETWEEN 1 AND 31),
    traffic_quota_bytes      INTEGER,

    hostname                 TEXT,
    agent_version            TEXT,

    os                       TEXT,
    os_version               TEXT,
    kernel                   TEXT,
    arch                     TEXT,

    env_type                 TEXT,
    env_runtime              TEXT,
    host_virtualization_hint TEXT,
    cgroup_version           INTEGER,
    resource_scope           TEXT,

    cpu_model_visible        TEXT,
    cpu_capacity_cores       REAL,
    memory_limit_bytes       INTEGER,
    swap_limit_bytes         INTEGER,
    rootfs_limit_bytes       INTEGER,
    rootfs_scope             TEXT,

    egress_ip                TEXT,
    geo_country              TEXT,
    geo_region               TEXT,
    geo_region_code          TEXT,
    geo_city                 TEXT,
    geo_lat                  REAL,
    geo_lon                  REAL,
    geo_timezone             TEXT,
    geo_continent            TEXT,
    asn                      INTEGER,
    as_org                   TEXT,
    cf_colo                  TEXT,

    location_mode            TEXT NOT NULL DEFAULT 'auto'
                             CHECK (location_mode IN ('auto','manual')),
    manual_country           TEXT,
    manual_city              TEXT,
    manual_lat               REAL,
    manual_lon               REAL,

    geo_updated_at_ms        INTEGER,
    expires_at_ms            INTEGER,

    created_at_ms            INTEGER NOT NULL,
    updated_at_ms            INTEGER NOT NULL
);

-- 4. Dynamic node config
CREATE TABLE IF NOT EXISTS node_config (
    node_id       TEXT PRIMARY KEY,
    revision      INTEGER NOT NULL DEFAULT 1,
    config_json   TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,

    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 5. Current node state snapshot
CREATE TABLE IF NOT EXISTS node_state (
    node_id                  TEXT PRIMARY KEY,

    agent_instance_id        TEXT NOT NULL,
    last_seq                 INTEGER NOT NULL,
    last_seen_at_ms          INTEGER NOT NULL,

    boot_id                  TEXT,
    network_counter_id       TEXT,
    network_interface        TEXT,

    cpu_usage_pct            REAL,
    cpu_throttled_pct        REAL,

    memory_used_bytes        INTEGER,
    memory_working_set_bytes INTEGER,
    swap_used_bytes          INTEGER,

    rootfs_used_bytes        INTEGER,

    disk_read_bps            INTEGER,
    disk_write_bps           INTEGER,

    rx_bps                   INTEGER,
    tx_bps                   INTEGER,
    rx_total_bytes           INTEGER,
    tx_total_bytes           INTEGER,

    edge_rtt_ms              REAL,
    edge_transport           TEXT,
    uptime_sec               INTEGER,

    probe_data_json          TEXT,

    persisted_at_ms          INTEGER NOT NULL,

    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 6. Raw metrics (60s buckets, default 7 days retention)
CREATE TABLE IF NOT EXISTS metrics_raw (
    node_id                  TEXT NOT NULL,
    bucket_start_ms          INTEGER NOT NULL,

    cpu_usage_pct            REAL,
    cpu_throttled_pct        REAL,

    memory_used_bytes        INTEGER,
    memory_working_set_bytes INTEGER,
    swap_used_bytes          INTEGER,

    rootfs_used_bytes        INTEGER,

    disk_read_bps            INTEGER,
    disk_write_bps           INTEGER,

    rx_bps                   INTEGER,
    tx_bps                   INTEGER,
    rx_bytes_delta           INTEGER,
    tx_bytes_delta           INTEGER,

    edge_rtt_ms              REAL,
    probe_data_json          TEXT,

    PRIMARY KEY(node_id, bucket_start_ms),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) WITHOUT ROWID;

-- 7. Hourly rollup metrics (1h buckets, default 365 days retention)
CREATE TABLE IF NOT EXISTS metrics_hourly (
    node_id                TEXT NOT NULL,
    bucket_start_ms        INTEGER NOT NULL,

    cpu_avg_pct            REAL,
    cpu_max_pct            REAL,

    memory_avg_bytes       INTEGER,
    memory_max_bytes       INTEGER,

    rootfs_used_last_bytes INTEGER,

    disk_read_avg_bps      INTEGER,
    disk_write_avg_bps     INTEGER,

    rx_bytes               INTEGER,
    tx_bytes               INTEGER,

    edge_rtt_avg_ms        REAL,
    edge_rtt_max_ms        REAL,

    probe_data_json        TEXT,

    PRIMARY KEY(node_id, bucket_start_ms),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) WITHOUT ROWID;

-- 8. Monthly billing/traffic periods
CREATE TABLE IF NOT EXISTS traffic_periods (
    node_id                 TEXT NOT NULL,
    period_start_ms         INTEGER NOT NULL,

    finalized_rx_bytes      INTEGER NOT NULL DEFAULT 0,
    finalized_tx_bytes      INTEGER NOT NULL DEFAULT 0,

    active_counter_id       TEXT,
    active_rx_base_bytes    INTEGER,
    active_tx_base_bytes    INTEGER,

    updated_at_ms           INTEGER NOT NULL,

    PRIMARY KEY(node_id, period_start_ms),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) WITHOUT ROWID;

-- 9. Alert rules
CREATE TABLE IF NOT EXISTS alert_rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id         TEXT,
    type            TEXT NOT NULL,
    threshold       REAL,
    duration_sec    INTEGER,
    enabled         INTEGER NOT NULL DEFAULT 1,
    config_json     TEXT,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL,

    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 10. Alert states
CREATE TABLE IF NOT EXISTS alert_states (
    state_key            TEXT PRIMARY KEY,
    rule_id              INTEGER,
    node_id              TEXT NOT NULL,
    active               INTEGER NOT NULL DEFAULT 0,
    pending_since_ms     INTEGER,
    active_since_ms      INTEGER,
    last_notified_at_ms  INTEGER,
    updated_at_ms        INTEGER NOT NULL,

    FOREIGN KEY(rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- 11. Event audit log
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id    TEXT,
    ts_ms      INTEGER NOT NULL,
    type       TEXT NOT NULL,
    data_json  TEXT,

    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_node_time
ON events(node_id, ts_ms DESC);
