import { AgentAttachment, MinuteAccumulator } from './ingest';
import { ReportMetrics } from '../protocol/types';

export function compactReportMetrics(metrics: ReportMetrics): ReportMetrics {
  return {
    config_rev: metrics.config_rev,
    cpu: {
      usage_pct: metrics.cpu?.usage_pct,
      throttled_pct: metrics.cpu?.throttled_pct,
      temp_celsius: metrics.cpu?.temp_celsius,
    },
    memory: {
      used_bytes: metrics.memory?.used_bytes,
    },
    rootfs: {
      used_bytes: metrics.rootfs?.used_bytes,
    },
    io: {
      read_bps: metrics.io?.read_bps,
      write_bps: metrics.io?.write_bps,
    },
    network: {
      interface: metrics.network?.interface || 'eth0',
      rx_bps: metrics.network?.rx_bps,
      tx_bps: metrics.network?.tx_bps,
    } as unknown as ReportMetrics['network'],
    uptime_sec: metrics.uptime_sec,
    probes: [],
  };
}

export function compactMinuteAccumulator(acc: MinuteAccumulator, isHistorical = false): MinuteAccumulator {
  if (isHistorical) {
    return {
      bucket_start_ms: acc.bucket_start_ms,
      first_sample_seq: 0,
      last_sample_seq: 0,
      rx_delta_sum: Math.round(acc.rx_delta_sum || 0),
      tx_delta_sum: Math.round(acc.tx_delta_sum || 0),
      cpu_sum: Math.round((acc.cpu_sum || 0) * 100) / 100,
      cpu_count: acc.cpu_count || 0,
      cpu_throttled_max: acc.cpu_throttled_max ?? null,
      memory_sum: Math.round(acc.memory_sum || 0),
      memory_count: acc.memory_count || 0,
      read_bps_sum: Math.round(acc.read_bps_sum || 0),
      read_bps_count: acc.read_bps_count || 0,
      write_bps_sum: Math.round(acc.write_bps_sum || 0),
      write_bps_count: acc.write_bps_count || 0,
      rx_bps_sum: Math.round(acc.rx_bps_sum || 0),
      rx_bps_count: acc.rx_bps_count || 0,
      tx_bps_sum: Math.round(acc.tx_bps_sum || 0),
      tx_bps_count: acc.tx_bps_count || 0,
      last_metrics: null as unknown as ReportMetrics,
    };
  }
  return {
    bucket_start_ms: acc.bucket_start_ms,
    first_sample_seq: acc.first_sample_seq,
    last_sample_seq: acc.last_sample_seq,
    rx_delta_sum: Math.round(acc.rx_delta_sum || 0),
    tx_delta_sum: Math.round(acc.tx_delta_sum || 0),
    cpu_sum: Math.round((acc.cpu_sum || 0) * 100) / 100,
    cpu_count: acc.cpu_count || 0,
    cpu_throttled_max: acc.cpu_throttled_max ?? null,
    memory_sum: Math.round(acc.memory_sum || 0),
    memory_count: acc.memory_count || 0,
    read_bps_sum: Math.round(acc.read_bps_sum || 0),
    read_bps_count: acc.read_bps_count || 0,
    write_bps_sum: Math.round(acc.write_bps_sum || 0),
    write_bps_count: acc.write_bps_count || 0,
    rx_bps_sum: Math.round(acc.rx_bps_sum || 0),
    rx_bps_count: acc.rx_bps_count || 0,
    tx_bps_sum: Math.round(acc.tx_bps_sum || 0),
    tx_bps_count: acc.tx_bps_count || 0,
    last_metrics: compactReportMetrics(acc.last_metrics),
  };
}

export function compactAgentAttachment(attachment: AgentAttachment): AgentAttachment {
  const latestHistEntry = Object.entries(attachment.historical_minutes || {}).slice(-1);
  return {
    kind: 'agent',
    node_id: attachment.node_id,
    node_name: (attachment.node_name || '').slice(0, 8),
    instance_id: attachment.instance_id,
    traffic_reset_day: attachment.traffic_reset_day,
    is_hidden: attachment.is_hidden,
    geo: {
      geo_country: attachment.geo?.geo_country,
      cf_colo: attachment.geo?.cf_colo,
      edge_rtt_ms: attachment.geo?.edge_rtt_ms,
    } as unknown as NormalizedGeo,
    hello_ok: attachment.hello_ok,
    connected_at_ms: attachment.connected_at_ms,
    last_seq: attachment.last_seq,
    last_report_received_at_ms: attachment.last_report_received_at_ms,
    config_rev: attachment.config_rev,
    last_persist_bucket_ms: attachment.last_persist_bucket_ms,
    persisted_sample_seq: attachment.persisted_sample_seq,
    last_counter_id: attachment.last_counter_id,
    last_rx_total_bytes: attachment.last_rx_total_bytes,
    last_tx_total_bytes: attachment.last_tx_total_bytes,
    last_ping_ts_ms: attachment.last_ping_ts_ms,
    current_minute: attachment.current_minute
      ? compactMinuteAccumulator(attachment.current_minute, false)
      : null,
    historical_minutes: Object.fromEntries(
      latestHistEntry.map(([k, v]) => [
        k,
        compactMinuteAccumulator(v, true),
      ])
    ),
    traffic_state: {
      period_start_ms: attachment.traffic_state?.period_start_ms ?? 0,
      finalized_rx_bytes: attachment.traffic_state?.finalized_rx_bytes ?? 0,
      finalized_tx_bytes: attachment.traffic_state?.finalized_tx_bytes ?? 0,
      active_counter_id: null,
      active_rx_base_bytes: null,
      active_tx_base_bytes: null,
      dirty: false,
    },
  };
}
