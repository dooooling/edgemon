import { ReportMetrics } from '../protocol/types';
import { NormalizedGeo } from '../services/geo';

export interface RawBucketMetric {
  bucketStartMs: number;
  report: ReportMetrics;
  rxDelta: number;
  txDelta: number;
}

export interface CheckpointParams {
  nodeId: string;
  instanceId: string;
  seq: number;
  latestReport: ReportMetrics;
  geo: NormalizedGeo;
  serverTimeMs: number;
  persistedSampleSeq: number;
  droppedSamples?: number;
  buckets: RawBucketMetric[];
  trafficStatements?: D1PreparedStatement[];
}

export async function persist60sCheckpoint(
  db: D1Database,
  params: CheckpointParams
): Promise<void> {
  const {
    nodeId,
    instanceId,
    seq,
    latestReport,
    geo,
    serverTimeMs,
    persistedSampleSeq = 0,
    droppedSamples = 0,
    buckets = [],
    trafficStatements = [],
  } = params;

  const probesJson = JSON.stringify(latestReport.probes || []);
  const statements: D1PreparedStatement[] = [];

  // 1. Upsert node_state with instance-scoped persisted_sample_seq watermark tracking (P0-1)
  statements.push(
    db
      .prepare(
        `INSERT INTO node_state (
          node_id, agent_instance_id, last_seq, last_seen_at_ms, boot_id,
          network_counter_id, network_interface, cpu_usage_pct, cpu_throttled_pct,
          memory_used_bytes, memory_working_set_bytes, swap_used_bytes, rootfs_used_bytes,
          disk_read_bps, disk_write_bps, rx_bps, tx_bps, rx_total_bytes, tx_total_bytes,
          edge_rtt_ms, edge_transport, uptime_sec, probe_data_json, persisted_at_ms,
          persisted_instance_id, persisted_sample_seq, dropped_samples
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(node_id) DO UPDATE SET
          agent_instance_id = excluded.agent_instance_id,
          last_seq = excluded.last_seq,
          last_seen_at_ms = excluded.last_seen_at_ms,
          boot_id = excluded.boot_id,
          network_counter_id = excluded.network_counter_id,
          network_interface = excluded.network_interface,
          cpu_usage_pct = excluded.cpu_usage_pct,
          cpu_throttled_pct = excluded.cpu_throttled_pct,
          memory_used_bytes = excluded.memory_used_bytes,
          memory_working_set_bytes = excluded.memory_working_set_bytes,
          swap_used_bytes = excluded.swap_used_bytes,
          rootfs_used_bytes = excluded.rootfs_used_bytes,
          disk_read_bps = excluded.disk_read_bps,
          disk_write_bps = excluded.disk_write_bps,
          rx_bps = excluded.rx_bps,
          tx_bps = excluded.tx_bps,
          rx_total_bytes = excluded.rx_total_bytes,
          tx_total_bytes = excluded.tx_total_bytes,
          edge_rtt_ms = excluded.edge_rtt_ms,
          edge_transport = excluded.edge_transport,
          uptime_sec = excluded.uptime_sec,
          probe_data_json = excluded.probe_data_json,
          persisted_at_ms = excluded.persisted_at_ms,
          persisted_instance_id = excluded.persisted_instance_id,
          persisted_sample_seq = CASE
            WHEN node_state.persisted_instance_id = excluded.persisted_instance_id
            THEN MAX(node_state.persisted_sample_seq, excluded.persisted_sample_seq)
            ELSE excluded.persisted_sample_seq
          END,
          dropped_samples = excluded.dropped_samples`
      )
      .bind(
        nodeId,
        instanceId,
        seq,
        serverTimeMs,
        latestReport.boot_id || null,
        latestReport.network?.counter_id || null,
        latestReport.network?.interface || 'eth0',
        latestReport.cpu?.usage_pct ?? null,
        latestReport.cpu?.throttled_pct ?? null,
        latestReport.memory?.used_bytes ?? null,
        latestReport.memory?.working_set_bytes ?? null,
        latestReport.memory?.swap_used_bytes ?? null,
        latestReport.rootfs?.used_bytes ?? null,
        latestReport.io?.read_bps ?? null,
        latestReport.io?.write_bps ?? null,
        latestReport.network?.rx_bps ?? null,
        latestReport.network?.tx_bps ?? null,
        latestReport.network?.rx_total_bytes ?? 0,
        latestReport.network?.tx_total_bytes ?? 0,
        geo.edge_rtt_ms,
        geo.edge_transport,
        latestReport.uptime_sec ?? null,
        probesJson,
        serverTimeMs,
        instanceId,
        persistedSampleSeq,
        droppedSamples
      )
  );

  // 2. Upsert each minute bucket to metrics_raw (P0-2 & P0-3 idempotent delta overwrite)
  for (const b of buckets) {
    const bucketProbesJson = JSON.stringify(b.report.probes || []);
    statements.push(
      db
        .prepare(
          `INSERT INTO metrics_raw (
            node_id, bucket_start_ms, cpu_usage_pct, cpu_throttled_pct,
            memory_used_bytes, memory_working_set_bytes, swap_used_bytes,
            rootfs_used_bytes, disk_read_bps, disk_write_bps,
            rx_bps, tx_bps, rx_bytes_delta, tx_bytes_delta,
            edge_rtt_ms, probe_data_json
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
          ON CONFLICT(node_id, bucket_start_ms) DO UPDATE SET
            cpu_usage_pct = excluded.cpu_usage_pct,
            cpu_throttled_pct = excluded.cpu_throttled_pct,
            memory_used_bytes = excluded.memory_used_bytes,
            memory_working_set_bytes = excluded.memory_working_set_bytes,
            swap_used_bytes = excluded.swap_used_bytes,
            rootfs_used_bytes = excluded.rootfs_used_bytes,
            disk_read_bps = excluded.disk_read_bps,
            disk_write_bps = excluded.disk_write_bps,
            rx_bps = excluded.rx_bps,
            tx_bps = excluded.tx_bps,
            rx_bytes_delta = excluded.rx_bytes_delta,
            tx_bytes_delta = excluded.tx_bytes_delta,
            edge_rtt_ms = excluded.edge_rtt_ms,
            probe_data_json = excluded.probe_data_json`
        )
        .bind(
          nodeId,
          b.bucketStartMs,
          b.report.cpu?.usage_pct ?? null,
          b.report.cpu?.throttled_pct ?? null,
          b.report.memory?.used_bytes ?? null,
          b.report.memory?.working_set_bytes ?? null,
          b.report.memory?.swap_used_bytes ?? null,
          b.report.rootfs?.used_bytes ?? null,
          b.report.io?.read_bps ?? null,
          b.report.io?.write_bps ?? null,
          b.report.network?.rx_bps ?? null,
          b.report.network?.tx_bps ?? null,
          b.rxDelta,
          b.txDelta,
          geo.edge_rtt_ms,
          bucketProbesJson
        )
    );
  }

  // 3. Append traffic_periods atomic statements
  if (trafficStatements && trafficStatements.length > 0) {
    statements.push(...trafficStatements);
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}
