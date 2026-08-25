import { ReportPayload } from '../protocol/types';
import { NormalizedGeo } from '../services/geo';

export interface CheckpointParams {
  nodeId: string;
  instanceId: string;
  seq: number;
  report: ReportPayload;
  geo: NormalizedGeo;
  serverTimeMs: number;
  stepRxDelta: number;
  stepTxDelta: number;
  trafficResetDay?: number;
}

export async function persist60sCheckpoint(
  db: D1Database,
  params: CheckpointParams
): Promise<void> {
  const {
    nodeId,
    instanceId,
    seq,
    report,
    geo,
    serverTimeMs,
    stepRxDelta,
    stepTxDelta,
  } = params;

  const bucketStartMs = Math.floor(serverTimeMs / 60000) * 60000;
  const probesJson = JSON.stringify(report.probes || []);

  const statements: D1PreparedStatement[] = [];

  // 1. Upsert node_state
  statements.push(
    db
      .prepare(
        `INSERT INTO node_state (
          node_id, agent_instance_id, last_seq, last_seen_at_ms, boot_id,
          network_counter_id, network_interface, cpu_usage_pct, cpu_throttled_pct,
          memory_used_bytes, memory_working_set_bytes, swap_used_bytes, rootfs_used_bytes,
          disk_read_bps, disk_write_bps, rx_bps, tx_bps, rx_total_bytes, tx_total_bytes,
          edge_rtt_ms, edge_transport, uptime_sec, probe_data_json, persisted_at_ms
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
          persisted_at_ms = excluded.persisted_at_ms`
      )
      .bind(
        nodeId,
        instanceId,
        seq,
        serverTimeMs,
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
        serverTimeMs
      )
  );

  // 2. Upsert metrics_raw (60s resolution bucket)
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
          rx_bytes_delta = rx_bytes_delta + excluded.rx_bytes_delta,
          tx_bytes_delta = tx_bytes_delta + excluded.tx_bytes_delta,
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
        stepRxDelta,
        stepTxDelta,
        geo.edge_rtt_ms,
        probesJson
      )
  );

  // Execute batch as a single SQL transaction
  await db.batch(statements);
}
