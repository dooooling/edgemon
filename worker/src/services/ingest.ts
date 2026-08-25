import { ReportPayload, validateReportPayload } from '../protocol/types';
import { NormalizedGeo } from './geo';
import { persist60sCheckpoint } from '../db/persistence';
import { trackTrafficDelta } from '../db/traffic';
import { getNodeState } from '../db/metrics';

export interface AgentAttachment {
  kind: 'agent';
  node_id: string;
  node_name: string;
  instance_id: string;
  traffic_reset_day: number;
  is_hidden: boolean;
  geo: NormalizedGeo;
  hello_ok: boolean;
  connected_at_ms: number;
  last_seq: number;
  last_report_received_at_ms: number;
  config_rev: number;
  last_persist_bucket_ms: number;
  last_counter_id: string | null;
  last_rx_total_bytes: number | null;
  last_tx_total_bytes: number | null;
  bucket_start_rx_bytes: number | null;
  bucket_start_tx_bytes: number | null;
  bucket_accumulated_rx_delta: number;
  bucket_accumulated_tx_delta: number;
  last_ping_ts_ms: number;
}

export interface IngestResult {
  accepted: boolean;
  persisted: boolean;
  error?: string;
  livePayload?: unknown;
  isHiddenNode?: boolean;
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
  trafficResetDay = 1,
  isHidden = false
): Promise<{ result: IngestResult; updatedAttachment: AgentAttachment }> {
  const serverTimeMs = Date.now();

  // 1. Metric Range Validation
  if (!validateReportPayload(report)) {
    return {
      result: { accepted: false, persisted: false, error: 'INVALID_METRIC_VALUE', isHiddenNode: isHidden },
      updatedAttachment: attachment || createDefaultAttachment(nodeId, nodeName, instanceId, serverTimeMs, geo, trafficResetDay, isHidden),
    };
  }

  // 2. Monotonic Seq Check
  if (attachment && seq <= attachment.last_seq) {
    return {
      result: { accepted: false, persisted: false, error: 'STALE_OR_DUPLICATE_SEQ', isHiddenNode: isHidden },
      updatedAttachment: attachment,
    };
  }

  const currentAttachment: AgentAttachment =
    attachment || createDefaultAttachment(nodeId, nodeName, instanceId, serverTimeMs, geo, trafficResetDay, isHidden);

  // 3. Construct Live Broadcast Payload
  const livePayload = {
    node_id: nodeId,
    name: nodeName,
    instance_id: instanceId,
    ts_ms: serverTimeMs,
    metrics: report,
    geo,
    is_hidden: currentAttachment.is_hidden,
  };

  // 4. Traffic 60-Second Bucket Delta & Counter Domain Tracking
  const currentCounterId = report.network.counter_id || null;
  const currentRx = report.network.rx_total_bytes;
  const currentTx = report.network.tx_total_bytes;

  const isCounterChanged = currentAttachment.last_counter_id !== currentCounterId;
  const isCounterReset =
    currentAttachment.last_rx_total_bytes !== null &&
    (currentRx < currentAttachment.last_rx_total_bytes || currentTx < (currentAttachment.last_tx_total_bytes ?? 0));

  if (isCounterChanged || isCounterReset) {
    // Settle accumulated delta on the previous counter segment before reset
    if (
      currentAttachment.bucket_start_rx_bytes !== null &&
      currentAttachment.last_rx_total_bytes !== null
    ) {
      const prevSegmentRx = Math.max(0, currentAttachment.last_rx_total_bytes - currentAttachment.bucket_start_rx_bytes);
      const prevSegmentTx = Math.max(0, (currentAttachment.last_tx_total_bytes ?? 0) - (currentAttachment.bucket_start_tx_bytes ?? 0));
      currentAttachment.bucket_accumulated_rx_delta += prevSegmentRx;
      currentAttachment.bucket_accumulated_tx_delta += prevSegmentTx;
    }
    currentAttachment.bucket_start_rx_bytes = currentRx;
    currentAttachment.bucket_start_tx_bytes = currentTx;
  } else if (currentAttachment.bucket_start_rx_bytes === null) {
    currentAttachment.bucket_start_rx_bytes = currentRx;
    currentAttachment.bucket_start_tx_bytes = currentTx;
  }

  // 5. 60-Second Persistence Checkpoint Gate
  const bucketStartMs = Math.floor(serverTimeMs / 60000) * 60000;
  let shouldPersist = false;

  if (attachment) {
    shouldPersist = bucketStartMs > currentAttachment.last_persist_bucket_ms;
  } else {
    // For stateless HTTP fallback: query last persisted state from D1
    const lastDbState = await getNodeState(db, nodeId);
    const lastPersistedMs = lastDbState?.persisted_at_ms || 0;
    const lastBucketStartMs = Math.floor(lastPersistedMs / 60000) * 60000;
    shouldPersist = !lastDbState || bucketStartMs > lastBucketStartMs;
  }

  let actuallyPersisted = false;

  if (shouldPersist) {
    const currentSegmentRx = Math.max(0, currentRx - (currentAttachment.bucket_start_rx_bytes ?? currentRx));
    const currentSegmentTx = Math.max(0, currentTx - (currentAttachment.bucket_start_tx_bytes ?? currentTx));
    const totalBucketRxDelta = currentAttachment.bucket_accumulated_rx_delta + currentSegmentRx;
    const totalBucketTxDelta = currentAttachment.bucket_accumulated_tx_delta + currentSegmentTx;

    try {
      await Promise.all([
        persist60sCheckpoint(db, {
          nodeId,
          instanceId,
          seq,
          report,
          geo,
          serverTimeMs,
          stepRxDelta: totalBucketRxDelta,
          stepTxDelta: totalBucketTxDelta,
          trafficResetDay: currentAttachment.traffic_reset_day,
        }),
        trackTrafficDelta(
          db,
          nodeId,
          currentRx,
          currentTx,
          currentCounterId,
          currentAttachment.traffic_reset_day,
          currentAttachment.last_rx_total_bytes,
          currentAttachment.last_tx_total_bytes
        ),
      ]);

      actuallyPersisted = true;
      currentAttachment.last_persist_bucket_ms = bucketStartMs;
      currentAttachment.bucket_start_rx_bytes = currentRx;
      currentAttachment.bucket_start_tx_bytes = currentTx;
      currentAttachment.bucket_accumulated_rx_delta = 0;
      currentAttachment.bucket_accumulated_tx_delta = 0;
    } catch (err: any) {
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
      persisted: actuallyPersisted,
      livePayload,
      isHiddenNode: currentAttachment.is_hidden,
    },
    updatedAttachment: currentAttachment,
  };
}

export function createDefaultAttachment(
  nodeId: string,
  nodeName: string,
  instanceId: string,
  nowMs: number,
  geo: NormalizedGeo,
  trafficResetDay = 1,
  isHidden = false
): AgentAttachment {
  return {
    kind: 'agent',
    node_id: nodeId,
    node_name: nodeName,
    instance_id: instanceId,
    traffic_reset_day: trafficResetDay,
    is_hidden: isHidden,
    geo,
    hello_ok: false,
    connected_at_ms: nowMs,
    last_seq: 0,
    last_report_received_at_ms: nowMs,
    config_rev: 1,
    last_persist_bucket_ms: 0,
    last_counter_id: null,
    last_rx_total_bytes: null,
    last_tx_total_bytes: null,
    bucket_start_rx_bytes: null,
    bucket_start_tx_bytes: null,
    bucket_accumulated_rx_delta: 0,
    bucket_accumulated_tx_delta: 0,
    last_ping_ts_ms: nowMs,
  };
}
