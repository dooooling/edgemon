import { AgentAttachment, MinuteAccumulator } from './ingest';
import { ReportMetrics } from '../protocol/types';
import { NormalizedGeo } from './geo';

export function compactReportMetrics(metrics?: ReportMetrics | null): ReportMetrics {
  if (!metrics) {
    return {
      config_rev: 0,
      network: { interface: 'eth0', rx_total_bytes: 0, tx_total_bytes: 0 },
      probes: [],
    } as unknown as ReportMetrics;
  }

  const res: any = {
    config_rev: metrics.config_rev,
    uptime_sec: metrics.uptime_sec,
    probes: metrics.probes?.map((p) => ({
      id: p.id,
      status: p.status,
      latency_ms: p.latency_ms != null ? Math.round(p.latency_ms * 10) / 10 : undefined,
      loss_ratio: p.loss_ratio,
    })) || [],
    network: {
      interface: metrics.network?.interface || 'eth0',
      rx_total_bytes: metrics.network?.rx_total_bytes ?? 0,
      tx_total_bytes: metrics.network?.tx_total_bytes ?? 0,
    },
  };

  if (metrics.boot_id) res.boot_id = metrics.boot_id;

  if (metrics.cpu) {
    res.cpu = {
      usage_pct: metrics.cpu.usage_pct != null ? Math.round(metrics.cpu.usage_pct * 10) / 10 : undefined,
      throttled_pct: metrics.cpu.throttled_pct != null ? Math.round(metrics.cpu.throttled_pct * 10) / 10 : undefined,
      temp_celsius: metrics.cpu.temp_celsius != null ? Math.round(metrics.cpu.temp_celsius * 10) / 10 : undefined,
    };
  }

  if (metrics.memory) {
    res.memory = {
      used_bytes: metrics.memory.used_bytes,
      working_set_bytes: metrics.memory.working_set_bytes,
      swap_used_bytes: metrics.memory.swap_used_bytes,
    };
  }

  if (metrics.rootfs) {
    res.rootfs = {
      used_bytes: metrics.rootfs.used_bytes,
    };
  }

  if (metrics.io) {
    res.io = {
      read_bps: metrics.io.read_bps,
      write_bps: metrics.io.write_bps,
    };
  }

  if (metrics.network) {
    if (metrics.network.counter_id) res.network.counter_id = metrics.network.counter_id;
    if (metrics.network.rx_bps !== undefined) res.network.rx_bps = metrics.network.rx_bps;
    if (metrics.network.tx_bps !== undefined) res.network.tx_bps = metrics.network.tx_bps;
    if (metrics.network.tcp_established_count !== undefined) res.network.tcp_established_count = metrics.network.tcp_established_count;
  }

  return res as ReportMetrics;
}

export function compactMinuteAccumulator(acc: MinuteAccumulator, isHistorical = false): MinuteAccumulator {
  const res: any = {
    bucket_start_ms: acc.bucket_start_ms,
    first_sample_seq: acc.first_sample_seq,
    last_sample_seq: acc.last_sample_seq,
    rx_delta_sum: Math.round(acc.rx_delta_sum || 0),
    tx_delta_sum: Math.round(acc.tx_delta_sum || 0),
    cpu_sum: Math.round((acc.cpu_sum || 0) * 10) / 10,
    memory_sum: Math.round(acc.memory_sum || 0),
    last_metrics: isHistorical
      ? ({
          config_rev: acc.last_metrics?.config_rev ?? 0,
          boot_id: acc.last_metrics?.boot_id,
          network: {
            interface: acc.last_metrics?.network?.interface || 'eth0',
            counter_id: acc.last_metrics?.network?.counter_id,
            rx_total_bytes: acc.last_metrics?.network?.rx_total_bytes ?? 0,
            tx_total_bytes: acc.last_metrics?.network?.tx_total_bytes ?? 0,
          },
          probes: acc.last_metrics?.probes?.map((p) => ({
            id: p.id,
            status: p.status,
            latency_ms: p.latency_ms != null ? Math.round(p.latency_ms * 10) / 10 : undefined,
            loss_ratio: p.loss_ratio,
          })) || [],
        } as unknown as ReportMetrics)
      : compactReportMetrics(acc.last_metrics),
  };

  if (acc.cpu_count) res.cpu_count = acc.cpu_count;
  if (acc.cpu_throttled_max != null) res.cpu_throttled_max = Math.round(acc.cpu_throttled_max * 10) / 10;
  if (acc.memory_count) res.memory_count = acc.memory_count;
  if (acc.read_bps_sum) res.read_bps_sum = Math.round(acc.read_bps_sum);
  if (acc.read_bps_count) res.read_bps_count = acc.read_bps_count;
  if (acc.write_bps_sum) res.write_bps_sum = Math.round(acc.write_bps_sum);
  if (acc.write_bps_count) res.write_bps_count = acc.write_bps_count;
  if (acc.rx_bps_sum) res.rx_bps_sum = Math.round(acc.rx_bps_sum);
  if (acc.rx_bps_count) res.rx_bps_count = acc.rx_bps_count;
  if (acc.tx_bps_sum) res.tx_bps_sum = Math.round(acc.tx_bps_sum);
  if (acc.tx_bps_count) res.tx_bps_count = acc.tx_bps_count;

  return res as MinuteAccumulator;
}

export function compactAgentAttachment(attachment: AgentAttachment): AgentAttachment {
  const unpersistedHistEntries = Object.entries(attachment.historical_minutes || {})
    .filter(([bucketStr]) => Number(bucketStr) > (attachment.last_persist_bucket_ms || 0));

  const res: any = {
    kind: 'agent',
    node_id: attachment.node_id,
    instance_id: attachment.instance_id,
    traffic_reset_day: attachment.traffic_reset_day,
    is_hidden: attachment.is_hidden,
    hello_ok: attachment.hello_ok,
    connected_at_ms: attachment.connected_at_ms,
    last_seq: attachment.last_seq,
    last_report_received_at_ms: attachment.last_report_received_at_ms,
    config_rev: attachment.config_rev,
    last_persist_bucket_ms: attachment.last_persist_bucket_ms,
    persisted_sample_seq: attachment.persisted_sample_seq,
    last_rx_total_bytes: attachment.last_rx_total_bytes,
    last_tx_total_bytes: attachment.last_tx_total_bytes,
    historical_minutes: Object.fromEntries(
      unpersistedHistEntries.map(([k, v]) => [
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
      dirty: attachment.traffic_state?.dirty ?? false,
    },
  };

  if (attachment.node_name) res.node_name = attachment.node_name;
  if (attachment.last_counter_id) res.last_counter_id = attachment.last_counter_id;
  if (attachment.token_hash) res.token_hash = attachment.token_hash;
  if (attachment.last_token_verified_at_ms) res.last_token_verified_at_ms = attachment.last_token_verified_at_ms;
  if (attachment.last_ping_ts_ms && attachment.last_ping_ts_ms !== attachment.last_report_received_at_ms) {
    res.last_ping_ts_ms = attachment.last_ping_ts_ms;
  }

  if (attachment.geo) {
    res.geo = {
      geo_country: attachment.geo.geo_country,
      cf_colo: attachment.geo.cf_colo,
      edge_rtt_ms: attachment.geo.edge_rtt_ms != null ? Math.round(attachment.geo.edge_rtt_ms * 10) / 10 : undefined,
      edge_transport: attachment.geo.edge_transport,
    } as unknown as NormalizedGeo;
  }

  if (attachment.current_minute) {
    res.current_minute = compactMinuteAccumulator(attachment.current_minute, false);
  }

  if (attachment.traffic_state) {
    if (attachment.traffic_state.active_counter_id) {
      res.traffic_state.active_counter_id = attachment.traffic_state.active_counter_id;
    }
    if (attachment.traffic_state.active_rx_base_bytes != null) {
      res.traffic_state.active_rx_base_bytes = attachment.traffic_state.active_rx_base_bytes;
    }
    if (attachment.traffic_state.active_tx_base_bytes != null) {
      res.traffic_state.active_tx_base_bytes = attachment.traffic_state.active_tx_base_bytes;
    }
    if (attachment.traffic_state.prev_period_settlement) {
      res.traffic_state.prev_period_settlement = attachment.traffic_state.prev_period_settlement;
    }
  }

  return res;
}
