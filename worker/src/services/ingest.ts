import { MetricSample, ReportMetrics, ReportPayload, validateReportPayload } from '../protocol/types';
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
  persisted_sample_seq: number;
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
  persisted_sample_seq?: number;
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

  // 1. Metric Range & Envelope Payload Validation
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

  // 3. Extract MetricSamples (support both new samples[] array and single-metric fallback)
  const rawSamples: MetricSample[] = Array.isArray(report.samples) && report.samples.length > 0
    ? report.samples
    : [
        {
          sample_seq: seq,
          sampled_at_ms: serverTimeMs,
          metrics: report as unknown as ReportMetrics,
        },
      ];

  // Filter out any invalid or duplicate samples already persisted
  const validSamples = rawSamples.filter((s) => s && s.metrics && s.sample_seq > 0);
  if (validSamples.length === 0) {
    return {
      result: { accepted: false, persisted: false, error: 'EMPTY_OR_INVALID_SAMPLES', isHiddenNode: isHidden },
      updatedAttachment: currentAttachment,
    };
  }

  // Sort by sample_seq ASC
  validSamples.sort((a, b) => a.sample_seq - b.sample_seq);

  // Take the latest sample for live broadcast & current snapshot metrics
  const latestSample = validSamples[validSamples.length - 1];
  const latestMetrics = latestSample.metrics;
  const maxSampleSeq = Math.max(...validSamples.map((s) => s.sample_seq));

  // 4. Construct Live Broadcast Payload
  const livePayload = {
    node_id: nodeId,
    name: nodeName,
    instance_id: instanceId,
    ts_ms: serverTimeMs,
    metrics: latestMetrics,
    geo,
    is_hidden: currentAttachment.is_hidden,
  };

  // 5. Traffic 60-Second Bucket Delta & Counter Domain Tracking
  const currentCounterId = latestMetrics.network.counter_id || null;
  const currentRx = latestMetrics.network.rx_total_bytes;
  const currentTx = latestMetrics.network.tx_total_bytes;

  const isCounterChanged = currentAttachment.last_counter_id !== currentCounterId;
  const isCounterReset =
    currentAttachment.last_rx_total_bytes !== null &&
    (currentRx < currentAttachment.last_rx_total_bytes || currentTx < (currentAttachment.last_tx_total_bytes ?? 0));

  if (isCounterChanged || isCounterReset) {
    try {
      await trackTrafficDelta(
        db,
        nodeId,
        currentRx,
        currentTx,
        currentCounterId,
        currentAttachment.traffic_reset_day,
        currentAttachment.last_rx_total_bytes,
        currentAttachment.last_tx_total_bytes
      );
    } catch (err) {
      console.error(`[Ingest] Immediate traffic reset settlement failed for node ${nodeId}:`, err);
    }

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

  // 6. 60-Second Persistence Checkpoint Gate
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
    if (lastDbState?.persisted_sample_seq) {
      currentAttachment.persisted_sample_seq = Math.max(
        currentAttachment.persisted_sample_seq,
        lastDbState.persisted_sample_seq
      );
    }
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
          report: latestMetrics,
          geo,
          serverTimeMs,
          stepRxDelta: totalBucketRxDelta,
          stepTxDelta: totalBucketTxDelta,
          trafficResetDay: currentAttachment.traffic_reset_day,
          persistedSampleSeq: maxSampleSeq,
          droppedSamples: report.dropped_samples || 0,
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
      currentAttachment.persisted_sample_seq = Math.max(currentAttachment.persisted_sample_seq, maxSampleSeq);
      currentAttachment.bucket_start_rx_bytes = currentRx;
      currentAttachment.bucket_start_tx_bytes = currentTx;
      currentAttachment.bucket_accumulated_rx_delta = 0;
      currentAttachment.bucket_accumulated_tx_delta = 0;
    } catch (err: any) {
      console.error(`[Ingest] D1 Checkpoint failed for node ${nodeId}:`, err);
    }
  }

  // 7. Update Runtime Attachment State
  currentAttachment.last_seq = seq;
  currentAttachment.last_report_received_at_ms = serverTimeMs;
  currentAttachment.last_counter_id = currentCounterId;
  currentAttachment.last_rx_total_bytes = currentRx;
  currentAttachment.last_tx_total_bytes = currentTx;

  return {
    result: {
      accepted: true,
      persisted: actuallyPersisted,
      persisted_sample_seq: currentAttachment.persisted_sample_seq,
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
    persisted_sample_seq: 0,
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
