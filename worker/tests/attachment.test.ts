import { describe, it, expect } from 'vitest';
import { AgentAttachment, MinuteAccumulator, finalizeAccumulator, mergeIntoAccumulator } from '../src/services/ingest';
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

describe('DO WebSocket Attachment 2048-Byte Boundary & Lifecycle Tests', () => {
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
        dirty: true,
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

  it('preserves active traffic segment baselines completely intact during compaction', () => {
    const rawMetrics = createMockMetrics(2, 2);
    const minute = createMockMinute(rawMetrics);

    const attachment: AgentAttachment = {
      kind: 'agent',
      node_id: 'test-node-traffic',
      node_name: 'test-node',
      instance_id: 'test-inst',
      traffic_reset_day: 1,
      is_hidden: false,
      geo: { geo_country: 'US', cf_colo: 'SJC', edge_rtt_ms: 5.0, edge_transport: 'quic', geo_region: null, geo_region_code: null, geo_city: null, geo_lat: null, geo_lon: null, geo_timezone: null, geo_continent: null, asn: null, as_org: null, egress_ip: null },
      hello_ok: true,
      connected_at_ms: 1000,
      last_seq: 10,
      last_report_received_at_ms: 2000,
      config_rev: 1,
      last_persist_bucket_ms: 0,
      persisted_sample_seq: 0,
      last_counter_id: 'counter-xyz',
      last_rx_total_bytes: 50000,
      last_tx_total_bytes: 30000,
      last_ping_ts_ms: 2000,
      current_minute: minute,
      historical_minutes: {},
      traffic_state: {
        period_start_ms: 1000,
        finalized_rx_bytes: 100000,
        finalized_tx_bytes: 80000,
        active_counter_id: 'counter-xyz',
        active_rx_base_bytes: 40000, // +10000 active rx
        active_tx_base_bytes: 25000, // +5000 active tx
        dirty: true,
      },
    };

    const compacted = compactAgentAttachment(attachment);

    // Assert active segment is preserved so DO wakeup never loses active delta
    expect(compacted.traffic_state.active_counter_id).toBe('counter-xyz');
    expect(compacted.traffic_state.active_rx_base_bytes).toBe(40000);
    expect(compacted.traffic_state.active_tx_base_bytes).toBe(25000);
    expect(compacted.traffic_state.dirty).toBe(true);
  });

  it('guarantees full lifecycle: compaction -> deserialize -> accumulate -> minute rollover -> finalizeAccumulator without null errors', () => {
    const rawMetrics = createMockMetrics(2, 2);
    const minute = createMockMinute(rawMetrics);

    const originalAttachment: AgentAttachment = {
      kind: 'agent',
      node_id: 'node-lifecycle',
      node_name: 'test-node',
      instance_id: 'inst-1',
      traffic_reset_day: 1,
      is_hidden: false,
      geo: { geo_country: 'JP', cf_colo: 'NRT', edge_rtt_ms: 20.0, edge_transport: 'tcp', geo_region: null, geo_region_code: null, geo_city: null, geo_lat: null, geo_lon: null, geo_timezone: null, geo_continent: null, asn: null, as_org: null, egress_ip: null },
      hello_ok: true,
      connected_at_ms: 1787640000000,
      last_seq: 100,
      last_report_received_at_ms: 1787640060000,
      config_rev: 2,
      last_persist_bucket_ms: 1787639880000,
      persisted_sample_seq: 90,
      last_counter_id: 'ctr-1',
      last_rx_total_bytes: 10000,
      last_tx_total_bytes: 5000,
      last_ping_ts_ms: 1787640060000,
      current_minute: minute,
      historical_minutes: {
        '1787639940000': minute,
      },
      traffic_state: {
        period_start_ms: 1787616000000,
        finalized_rx_bytes: 5000,
        finalized_tx_bytes: 2000,
        active_counter_id: 'ctr-1',
        active_rx_base_bytes: 1000,
        active_tx_base_bytes: 500,
        dirty: true,
      },
    };

    // 1. Simulate DO compaction and serialization
    const compacted = compactAgentAttachment(originalAttachment);
    const serialized = JSON.stringify(compacted);

    // 2. Simulate DO hibernation wake-up (deserialization)
    const restored: AgentAttachment = JSON.parse(serialized);

    // 3. Accumulate next sample into restored current_minute
    const nextMetrics = createMockMetrics(2, 2);
    nextMetrics.cpu.usage_pct = 50.0;
    mergeIntoAccumulator(restored.current_minute!, {
      sample_seq: 101,
      sampled_at_ms: Date.now(),
      metrics: nextMetrics,
    }, 1000, 2000);

    // 4. Finalize historical minute and current minute
    const histAcc = restored.historical_minutes['1787639940000'];
    expect(histAcc).toBeDefined();
    const finalizedHist = finalizeAccumulator(histAcc);
    expect(finalizedHist.report.config_rev).toBeDefined();
    expect(finalizedHist.report.network.interface).toBe('eth0');

    const finalizedCurrent = finalizeAccumulator(restored.current_minute!);
    expect(finalizedCurrent.report.cpu.usage_pct).toBeDefined();
    expect(finalizedCurrent.rxDelta).toBeGreaterThan(0);
  });
});
