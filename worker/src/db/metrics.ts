import { ReportMetrics } from '../protocol/types';
import { NormalizedGeo } from '../services/geo';

export interface NodeStateRow {
  node_id: string;
  agent_instance_id: string;
  last_seq: number;
  last_seen_at_ms: number;
  boot_id: string | null;
  network_counter_id: string | null;
  network_interface: string | null;
  cpu_usage_pct: number | null;
  cpu_throttled_pct: number | null;
  memory_used_bytes: number | null;
  memory_working_set_bytes: number | null;
  swap_used_bytes: number | null;
  rootfs_used_bytes: number | null;
  disk_read_bps: number | null;
  disk_write_bps: number | null;
  rx_bps: number | null;
  tx_bps: number | null;
  rx_total_bytes: number | null;
  tx_total_bytes: number | null;
  edge_rtt_ms: number | null;
  edge_transport: string | null;
  uptime_sec: number | null;
  probe_data_json: string | null;
  persisted_at_ms: number;
  persisted_instance_id?: string | null;
  persisted_sample_seq?: number;
  dropped_samples?: number;
}

export async function getNodeState(db: D1Database, nodeId: string): Promise<NodeStateRow | null> {
  return await db.prepare('SELECT * FROM node_state WHERE node_id = ?').bind(nodeId).first<NodeStateRow>();
}

export async function upsertNodeState(
  db: D1Database,
  nodeId: string,
  instanceId: string,
  seq: number,
  report: ReportMetrics,
  geo: NormalizedGeo,
  persistedAtMs: number,
  persistedSampleSeq = 0,
  droppedSamples = 0
): Promise<void> {
  const probesJson = JSON.stringify(report.probes);
  await db
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
      persistedAtMs,
      report.boot_id || null,
      report.network.counter_id || null,
      report.network.interface,
      report.cpu.usage_pct ?? null,
      report.cpu.throttled_pct ?? null,
      report.memory.used_bytes ?? null,
      report.memory.working_set_bytes ?? null,
      report.memory.swap_used_bytes ?? null,
      report.rootfs.used_bytes ?? null,
      report.io.read_bps ?? null,
      report.io.write_bps ?? null,
      report.network.rx_bps ?? null,
      report.network.tx_bps ?? null,
      report.network.rx_total_bytes,
      report.network.tx_total_bytes,
      geo.edge_rtt_ms,
      geo.edge_transport,
      report.uptime_sec ?? null,
      probesJson,
      persistedAtMs,
      instanceId,
      persistedSampleSeq,
      droppedSamples
    )
    .run();
}

export async function upsertMetricsRaw(
  db: D1Database,
  nodeId: string,
  bucketStartMs: number,
  report: ReportMetrics,
  edgeRttMs: number | null,
  rxDelta = 0,
  txDelta = 0
): Promise<void> {
  const probesJson = JSON.stringify(report.probes);
  await db
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
      bucketStartMs,
      report.cpu.usage_pct ?? null,
      report.cpu.throttled_pct ?? null,
      report.memory.used_bytes ?? null,
      report.memory.working_set_bytes ?? null,
      report.memory.swap_used_bytes ?? null,
      report.rootfs.used_bytes ?? null,
      report.io.read_bps ?? null,
      report.io.write_bps ?? null,
      report.network.rx_bps ?? null,
      report.network.tx_bps ?? null,
      rxDelta,
      txDelta,
      edgeRttMs,
      probesJson
    )
    .run();
}

export async function getRawHistory(db: D1Database, nodeId: string, fromMs: number, toMs: number): Promise<unknown[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM metrics_raw
       WHERE node_id = ? AND bucket_start_ms >= ? AND bucket_start_ms <= ?
       ORDER BY bucket_start_ms ASC`
    )
    .bind(nodeId, fromMs, toMs)
    .all();
  return rows.results || [];
}

export async function getHourlyHistory(db: D1Database, nodeId: string, fromMs: number, toMs: number): Promise<unknown[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM metrics_hourly
       WHERE node_id = ? AND bucket_start_ms >= ? AND bucket_start_ms <= ?
       ORDER BY bucket_start_ms ASC`
    )
    .bind(nodeId, fromMs, toMs)
    .all();
  return rows.results || [];
}

export async function executeHourlyRollup(db: D1Database, targetHourStartMs: number): Promise<void> {
  const targetHourEndMs = targetHourStartMs + 3600000;

  await db
    .prepare(
      `INSERT INTO metrics_hourly (
        node_id, bucket_start_ms, cpu_avg_pct, cpu_max_pct,
        memory_avg_bytes, memory_max_bytes, rootfs_used_last_bytes,
        disk_read_avg_bps, disk_write_avg_bps, rx_bytes, tx_bytes,
        edge_rtt_avg_ms, edge_rtt_max_ms, probe_data_json
      )
      SELECT
        node_id,
        ? AS bucket_start_ms,
        AVG(cpu_usage_pct) AS cpu_avg_pct,
        MAX(cpu_usage_pct) AS cpu_max_pct,
        CAST(AVG(memory_used_bytes) AS INTEGER) AS memory_avg_bytes,
        MAX(memory_used_bytes) AS memory_max_bytes,
        MAX(rootfs_used_bytes) AS rootfs_used_last_bytes,
        CAST(AVG(disk_read_bps) AS INTEGER) AS disk_read_avg_bps,
        CAST(AVG(disk_write_bps) AS INTEGER) AS disk_write_avg_bps,
        SUM(COALESCE(rx_bytes_delta, 0)) AS rx_bytes,
        SUM(COALESCE(tx_bytes_delta, 0)) AS tx_bytes,
        AVG(edge_rtt_ms) AS edge_rtt_avg_ms,
        MAX(edge_rtt_ms) AS edge_rtt_max_ms,
        NULL AS probe_data_json
      FROM metrics_raw
      WHERE bucket_start_ms >= ? AND bucket_start_ms < ?
      GROUP BY node_id
      ON CONFLICT(node_id, bucket_start_ms) DO UPDATE SET
        cpu_avg_pct = excluded.cpu_avg_pct,
        cpu_max_pct = excluded.cpu_max_pct,
        memory_avg_bytes = excluded.memory_avg_bytes,
        memory_max_bytes = excluded.memory_max_bytes,
        rootfs_used_last_bytes = excluded.rootfs_used_last_bytes,
        disk_read_avg_bps = excluded.disk_read_avg_bps,
        disk_write_avg_bps = excluded.disk_write_avg_bps,
        rx_bytes = excluded.rx_bytes,
        tx_bytes = excluded.tx_bytes,
        edge_rtt_avg_ms = excluded.edge_rtt_avg_ms,
        edge_rtt_max_ms = excluded.edge_rtt_max_ms`
    )
    .bind(targetHourStartMs, targetHourStartMs, targetHourEndMs)
    .run();
}

export async function executeRetentionCleanup(
  db: D1Database,
  rawRetentionDays = 7,
  hourlyRetentionDays = 365,
  eventRetentionDays = 90
): Promise<void> {
  const now = Date.now();
  const rawCutoff = now - rawRetentionDays * 86400000;
  const hourlyCutoff = now - hourlyRetentionDays * 86400000;
  const eventCutoff = now - eventRetentionDays * 86400000;

  await db.batch([
    db.prepare('DELETE FROM metrics_raw WHERE bucket_start_ms < ?').bind(rawCutoff),
    db.prepare('DELETE FROM metrics_hourly WHERE bucket_start_ms < ?').bind(hourlyCutoff),
    db.prepare('DELETE FROM events WHERE ts_ms < ?').bind(eventCutoff),
  ]);
}
