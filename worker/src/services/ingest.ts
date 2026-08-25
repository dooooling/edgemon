import { ReportPayload, validateReportPayload } from '../protocol/types';
import { NormalizedGeo } from './geo';
import { persist60sCheckpoint } from '../db/persistence';
import { trackTrafficDelta } from '../db/traffic';

export interface AgentAttachment {
  kind: 'agent';
  node_id: string;
  instance_id: string;
  hello_ok: boolean;
  connected_at_ms: number;
  last_seq: number;
  last_report_received_at_ms: number;
  config_rev: number;
  last_persist_bucket_ms: number;
  last_counter_id: string | null;
  last_rx_total_bytes: number | null;
  last_tx_total_bytes: number | null;
  active_period_start_ms: number | null;
}

export interface IngestResult {
  accepted: boolean;
  persisted: boolean;
  error?: string;
  livePayload?: unknown;
}

export async function ingestReportCore(
  db: D1Database,
  nodeId: string,
  nodeName: string,
  instanceId: string,
  seq: number,
  report: ReportPayload,
  geo: NormalizedGeo,
  attachment: AgentAttachment | null,
  trafficResetDay = 1
): Promise<{ result: IngestResult; updatedAttachment: AgentAttachment }> {
  const serverTimeMs = Date.now();

  // 1. Metric Range Validation
  if (!validateReportPayload(report)) {
    return {
      result: { accepted: false, persisted: false, error: 'INVALID_METRIC_VALUE' },
      updatedAttachment: attachment || createDefaultAttachment(nodeId, instanceId, serverTimeMs),
    };
  }

  // 2. Monotonic Seq Check
  if (attachment && seq <= attachment.last_seq) {
    return {
      result: { accepted: false, persisted: false, error: 'STALE_OR_DUPLICATE_SEQ' },
      updatedAttachment: attachment,
    };
  }

  const currentAttachment: AgentAttachment =
    attachment || createDefaultAttachment(nodeId, instanceId, serverTimeMs);

  // 3. Construct Live Broadcast Payload
  const livePayload = {
    node_id: nodeId,
    name: nodeName,
    instance_id: instanceId,
    ts_ms: serverTimeMs,
    metrics: report,
    geo,
  };

  // 4. Traffic Step Delta Calculation
  const currentCounterId = report.network.counter_id || null;
  const currentRx = report.network.rx_total_bytes;
  const currentTx = report.network.tx_total_bytes;

  let stepRxDelta = 0;
  let stepTxDelta = 0;

  if (
    currentAttachment.last_counter_id === currentCounterId &&
    currentAttachment.last_rx_total_bytes !== null &&
    currentAttachment.last_tx_total_bytes !== null &&
    currentRx >= currentAttachment.last_rx_total_bytes &&
    currentTx >= currentAttachment.last_tx_total_bytes
  ) {
    stepRxDelta = currentRx - currentAttachment.last_rx_total_bytes;
    stepTxDelta = currentTx - currentAttachment.last_tx_total_bytes;
  }

  // 5. 60-Second Persistence Checkpoint Gate
  const bucketStartMs = Math.floor(serverTimeMs / 60000) * 60000;
  const shouldPersist = bucketStartMs > currentAttachment.last_persist_bucket_ms;

  if (shouldPersist) {
    try {
      await Promise.all([
        persist60sCheckpoint(db, {
          nodeId,
          instanceId,
          seq,
          report,
          geo,
          serverTimeMs,
          stepRxDelta,
          stepTxDelta,
          trafficResetDay,
        }),
        trackTrafficDelta(db, nodeId, currentRx, currentTx, currentCounterId, trafficResetDay),
      ]);
      currentAttachment.last_persist_bucket_ms = bucketStartMs;
    } catch (err: any) {
      // D1 persist failure logged
      console.error(`[Ingest] D1 Checkpoint failed for node ${nodeId}:`, err);
    }
  }

  // 6. Update Runtime Attachment State
  currentAttachment.last_seq = seq;
  currentAttachment.last_report_received_at_ms = serverTimeMs;
  currentAttachment.last_counter_id = currentCounterId;
  currentAttachment.last_rx_total_bytes = currentRx;
  currentAttachment.last_tx_total_bytes = currentTx;

  return {
    result: {
      accepted: true,
      persisted: shouldPersist,
      livePayload,
    },
    updatedAttachment: currentAttachment,
  };
}

export function createDefaultAttachment(
  nodeId: string,
  instanceId: string,
  nowMs: number
): AgentAttachment {
  return {
    kind: 'agent',
    node_id: nodeId,
    instance_id: instanceId,
    hello_ok: false,
    connected_at_ms: nowMs,
    last_seq: 0,
    last_report_received_at_ms: nowMs,
    config_rev: 1,
    last_persist_bucket_ms: 0,
    last_counter_id: null,
    last_rx_total_bytes: null,
    last_tx_total_bytes: null,
    active_period_start_ms: null,
  };
}
