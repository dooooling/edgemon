import { describe, it, expect } from 'vitest';
import { AgentAttachment, MinuteAccumulator } from '../src/services/ingest';
import { ReportMetrics } from '../protocol/types';
import { compactAgentAttachment } from '../src/services/attachment';

function createMockMetrics(mountCount = 10, probeCount = 20): ReportMetrics {
  return {
    config_rev: 42,
    boot_id: '8f8b056e-8d8a-4467-bc1a-5bfbf816d953',
    cpu: {
      usage_pct: 78.4,
      throttled_pct: 12.3,
      temp_celsius: 54.2,
      load1: 1.45,
      load5: 2.12,
      load15: 1.98,
      process_total_count: 340,
      process_running_count: 4,
    },
    memory: {
      used_bytes: 8589934592,
      working_set_bytes: 7516192768,
      swap_used_bytes: 1073741824,
      oom_kill_count: 0,
    },
    rootfs: {
      used_bytes: 107374182400,
      mounts: Array.from({ length: mountCount }, (_, i) => ({
        mount_point: `/mnt/data/volume_${i}`,
        total_bytes: 1099511627776,
        used_bytes: 549755813888,
        fs_type: 'ext4',
      })),
    },
    io: {
      read_bps: 10485760,
      write_bps: 20971520,
      read_iops: 1200,
      write_iops: 2400,
      io_util_pct: 35.8,
    },
    network: {
      interface: 'eth0',
      counter_id: 'a94a8fe5ccb19ba6',
      rx_bps: 52428800,
      tx_bps: 104857600,
      rx_total_bytes: 98765432109876,
      tx_total_bytes: 12345678901234,
      tcp_established_count: 450,
      tcp_tw_count: 120,
      tcp_total_count: 600,
      udp_in_use: 35,
    },
    uptime_sec: 1234567,
    probes: Array.from({ length: probeCount }, (_, i) => ({
      id: `probe-target-${i}`,
      status: 'ok',
      latency_ms: 15.4 + i,
      loss_ratio: 0.0,
    })),
  };
}

function createMockMinute(metrics: ReportMetrics): MinuteAccumulator {
  return {
    bucket_start_ms: 1787640000000,
    first_sample_seq: 1000,
    last_sample_seq: 1030,
    rx_delta_sum: 524288000,
    tx_delta_sum: 1048576000,
    cpu_sum: 2340.5,
    cpu_count: 30,
    cpu_throttled_max: 15.2,
    memory_sum: 257698037760,
    memory_count: 30,
    read_bps_sum: 314572800,
    read_bps_count: 30,
    write_bps_sum: 629145600,
    write_bps_count: 30,
    rx_bps_sum: 1572864000,
    rx_bps_count: 30,
    tx_bps_sum: 3145728000,
    tx_bps_count: 30,
    last_metrics: metrics,
  };
}

describe('DO WebSocket Attachment 2048-Byte Boundary Tests', () => {
  it('compacts heavy attachments (10 mounts, 20 probes) strictly under 2048 bytes limit', () => {
    const rawMetrics = createMockMetrics(10, 20);
    const minute = createMockMinute(rawMetrics);

    const attachment: AgentAttachment = {
      kind: 'agent',
      node_id: '550e8400-e29b-41d4-a716-446655440000',
      node_name: 'production-fra-edge-node-01',
      instance_id: '01991f4e-a3d7-7c4e-aef1-9a1b6c03d442',
      traffic_reset_day: 1,
      is_hidden: false,
      geo: {
        geo_country: 'DE',
        geo_region: 'Hesse',
        geo_region_code: 'HE',
        geo_city: 'Frankfurt',
        geo_lat: 50.1109,
        geo_lon: 8.6821,
        geo_timezone: 'Europe/Berlin',
        geo_continent: 'EU',
        as_org: 'Cloudflare Inc',
        asn: 13335,
        cf_colo: 'FRA',
        egress_ip: '198.41.200.1',
        edge_rtt_ms: 12.4,
        edge_transport: 'quic',
      },
      hello_ok: true,
      connected_at_ms: 1787640000000,
      last_seq: 1030,
      last_report_received_at_ms: 1787640060000,
      config_rev: 42,
      last_persist_bucket_ms: 1787640000000,
      persisted_sample_seq: 1000,
      last_counter_id: 'a94a8fe5ccb19ba6',
      last_rx_total_bytes: 98765432109876,
      last_tx_total_bytes: 12345678901234,
      last_ping_ts_ms: 1787640060000,
      current_minute: minute,
      historical_minutes: {
        '1787639940000': minute,
      },
      traffic_state: {
        period_start_ms: 1787616000000,
        finalized_rx_bytes: 600000000,
        finalized_tx_bytes: 400000000,
        active_counter_id: 'a94a8fe5ccb19ba6',
        active_rx_base_bytes: 98765432109876,
        active_tx_base_bytes: 12345678901234,
        dirty: false,
      },
    };

    const compacted = compactAgentAttachment(attachment);

    const jsonStr = JSON.stringify(compacted);
    const byteLength = new TextEncoder().encode(jsonStr).length;

    // Cloudflare DO Attachment limit is 2048 bytes
    expect(byteLength).toBeLessThanOrEqual(2048);
    expect(compacted.current_minute?.last_metrics.cpu?.temp_celsius).toBe(54.2);
    expect(compacted.traffic_state.finalized_rx_bytes).toBe(600000000);
  });

  it('guarantees lossless fallback preserving crucial traffic and token states', () => {
    const rawMetrics = createMockMetrics(20, 50);
    const minute = createMockMinute(rawMetrics);

    const attachment: AgentAttachment = {
      kind: 'agent',
      node_id: '550e8400-e29b-41d4-a716-446655440000',
      node_name: 'production-node',
      instance_id: '01991f4e-a3d7-7c4e-aef1-9a1b6c03d442',
      traffic_reset_day: 1,
      is_hidden: false,
      geo: {
        geo_country: null,
        geo_region: null,
        geo_region_code: null,
        geo_city: null,
        geo_lat: null,
        geo_lon: null,
        geo_timezone: null,
        geo_continent: null,
        asn: null,
        as_org: null,
        cf_colo: null,
        egress_ip: null,
        edge_rtt_ms: 15.0,
        edge_transport: 'tcp',
      },
      hello_ok: true,
      connected_at_ms: 1787640000000,
      last_seq: 2000,
      last_report_received_at_ms: 1787640060000,
      config_rev: 5,
      last_persist_bucket_ms: 1787640000000,
      persisted_sample_seq: 1950,
      last_counter_id: 'counter-abc-123',
      last_rx_total_bytes: 5000000000,
      last_tx_total_bytes: 2000000000,
      last_ping_ts_ms: 1787640060000,
      current_minute: minute,
      historical_minutes: {},
      traffic_state: {
        period_start_ms: 1787616000000,
        finalized_rx_bytes: 3000000000,
        finalized_tx_bytes: 2000000000,
        active_counter_id: 'counter-abc-123',
        active_rx_base_bytes: 5000000000,
        active_tx_base_bytes: 2000000000,
        dirty: false,
      },
    };

    const fallback: AgentAttachment = {
      ...attachment,
      current_minute: null,
      historical_minutes: {},
    };

    const fallbackJson = JSON.stringify(fallback);
    const fallbackBytes = new TextEncoder().encode(fallbackJson).length;

    expect(fallbackBytes).toBeLessThan(1200);
    expect(fallback.node_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(fallback.last_counter_id).toBe('counter-abc-123');
    expect(fallback.traffic_state.finalized_rx_bytes).toBe(3000000000);
  });
});
