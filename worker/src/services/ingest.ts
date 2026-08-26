import { MetricSample, ReportMetrics, ReportPayload, validateReportPayload } from '../protocol/types';
import { NormalizedGeo } from './geo';
import { persist60sCheckpoint, RawBucketMetric } from '../db/persistence';
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

  // 2. Monotonic Seq Check with Idempotent Retry on ACK Loss (P0-4)
  if (attachment) {
    if (seq < attachment.last_seq) {
      return {
        result: { accepted: false, persisted: false, error: 'STALE_OR_DUPLICATE_SEQ', isHiddenNode: isHidden },
        updatedAttachment: attachment,
      };
    }
    if (seq === attachment.last_seq) {
      // Idempotent retry of dropped ACK: acknowledge without re-inserting
      return {
        result: {
          accepted: true,
          persisted: false,
          persisted_sample_seq: attachment.persisted_sample_seq,
          isHiddenNode: attachment.is_hidden,
        },
        updatedAttachment: attachment,
      };
    }
  }

  const currentAttachment: AgentAttachment =
    attachment || createDefaultAttachment(nodeId, nodeName, instanceId, serverTimeMs, geo, trafficResetDay, isHidden);

  // 3. Extract MetricSamples (support both samples[] array and single-metric fallback)
  const rawSamples: MetricSample[] = Array.isArray(report.samples) && report.samples.length > 0
    ? report.samples
    : [
        {
          sample_seq: seq,
          sampled_at_ms: serverTimeMs,
          metrics: report as unknown as ReportMetrics,
        },
      ];

  const validSamples = rawSamples.filter((s) => s && s.metrics && s.sample_seq > 0);
  if (validSamples.length === 0) {
    return {
      result: { accepted: false, persisted: false, error: 'EMPTY_OR_INVALID_SAMPLES', isHiddenNode: isHidden },
      updatedAttachment: currentAttachment,
    };
  }

  // Sort samples by sample_seq ASC
  validSamples.sort((a, b) => a.sample_seq - b.sample_seq);

  const latestSample = validSamples[validSamples.length - 1];
  const latestMetrics = latestSample.metrics;

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

  // 5. Traffic Counter Domain & Boundary Tracking
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

    currentAttachment.bucket_start_rx_bytes = currentRx;
    currentAttachment.bucket_start_tx_bytes = currentTx;
  } else if (currentAttachment.bucket_start_rx_bytes === null) {
    currentAttachment.bucket_start_rx_bytes = currentRx;
    currentAttachment.bucket_start_tx_bytes = currentTx;
  }

  // 6. Group Samples by sampled_at_ms Minute Buckets & Batch Aggregate (P0-2)
  const bucketMap = new Map<number, MetricSample[]>();
  for (const s of validSamples) {
    const bucketStartMs = Math.floor(s.sampled_at_ms / 60000) * 60000;
    if (!bucketMap.has(bucketStartMs)) {
      bucketMap.set(bucketStartMs, []);
    }
    bucketMap.get(bucketStartMs)!.push(s);
  }

  const sortedBucketKeys = Array.from(bucketMap.keys()).sort((a, b) => a - b);
  const currentServerBucketStartMs = Math.floor(serverTimeMs / 60000) * 60000;

  // Hydrate D1 node_state on stateless HTTP fallback
  if (!attachment) {
    const lastDbState = await getNodeState(db, nodeId);
    if (lastDbState) {
      if (lastDbState.persisted_instance_id === instanceId && lastDbState.persisted_sample_seq) {
        currentAttachment.persisted_sample_seq = lastDbState.persisted_sample_seq;
      }
      currentAttachment.last_persist_bucket_ms = Math.floor((lastDbState.persisted_at_ms || 0) / 60000) * 60000;
    }
  }

  const bucketsToPersist: RawBucketMetric[] = [];
  let maxPersistCandidateSampleSeq = currentAttachment.persisted_sample_seq;

  for (const bStart of sortedBucketKeys) {
    const bSamples = bucketMap.get(bStart)!;
    const isHistoricalBucket = bStart < currentServerBucketStartMs;
    const isCurrentCheckpoint = bStart > currentAttachment.last_persist_bucket_ms;

    if (isHistoricalBucket || isCurrentCheckpoint || !attachment) {
      const firstSample = bSamples[0];
      const lastSample = bSamples[bSamples.length - 1];

      // Aggregations
      const cpuVals = bSamples.map((s) => s.metrics.cpu?.usage_pct).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const avgCpu = cpuVals.length > 0 ? Number((cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length).toFixed(2)) : lastSample.metrics.cpu?.usage_pct ?? null;

      const memVals = bSamples.map((s) => s.metrics.memory?.used_bytes).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const avgMem = memVals.length > 0 ? Math.round(memVals.reduce((a, b) => a + b, 0) / memVals.length) : lastSample.metrics.memory?.used_bytes ?? null;

      const readVals = bSamples.map((s) => s.metrics.io?.read_bps).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const avgRead = readVals.length > 0 ? Math.round(readVals.reduce((a, b) => a + b, 0) / readVals.length) : lastSample.metrics.io?.read_bps ?? null;

      const writeVals = bSamples.map((s) => s.metrics.io?.write_bps).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const avgWrite = writeVals.length > 0 ? Math.round(writeVals.reduce((a, b) => a + b, 0) / writeVals.length) : lastSample.metrics.io?.write_bps ?? null;

      const rxBpsVals = bSamples.map((s) => s.metrics.network?.rx_bps).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const avgRxBps = rxBpsVals.length > 0 ? Math.round(rxBpsVals.reduce((a, b) => a + b, 0) / rxBpsVals.length) : lastSample.metrics.network?.rx_bps ?? null;

      const txBpsVals = bSamples.map((s) => s.metrics.network?.tx_bps).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const avgTxBps = txBpsVals.length > 0 ? Math.round(txBpsVals.reduce((a, b) => a + b, 0) / txBpsVals.length) : lastSample.metrics.network?.tx_bps ?? null;

      const bucketRxDelta = Math.max(0, lastSample.metrics.network.rx_total_bytes - firstSample.metrics.network.rx_total_bytes);
      const bucketTxDelta = Math.max(0, lastSample.metrics.network.tx_total_bytes - firstSample.metrics.network.tx_total_bytes);

      const aggMetrics: ReportMetrics = {
        config_rev: lastSample.metrics.config_rev,
        boot_id: lastSample.metrics.boot_id,
        cpu: {
          usage_pct: avgCpu,
          throttled_pct: lastSample.metrics.cpu?.throttled_pct ?? null,
        },
        memory: {
          used_bytes: avgMem,
          working_set_bytes: lastSample.metrics.memory?.working_set_bytes ?? null,
          swap_used_bytes: lastSample.metrics.memory?.swap_used_bytes ?? null,
        },
        rootfs: {
          used_bytes: lastSample.metrics.rootfs?.used_bytes ?? null,
        },
        io: {
          read_bps: avgRead,
          write_bps: avgWrite,
        },
        network: {
          interface: lastSample.metrics.network.interface,
          counter_id: lastSample.metrics.network.counter_id,
          rx_bps: avgRxBps,
          tx_bps: avgTxBps,
          rx_total_bytes: lastSample.metrics.network.rx_total_bytes,
          tx_total_bytes: lastSample.metrics.network.tx_total_bytes,
        },
        uptime_sec: lastSample.metrics.uptime_sec,
        probes: lastSample.metrics.probes,
      };

      bucketsToPersist.push({
        bucketStartMs: bStart,
        report: aggMetrics,
        rxDelta: bucketRxDelta,
        txDelta: bucketTxDelta,
      });

      maxPersistCandidateSampleSeq = Math.max(maxPersistCandidateSampleSeq, lastSample.sample_seq);
    }
  }

  let actuallyPersisted = false;

  if (bucketsToPersist.length > 0) {
    try {
      await persist60sCheckpoint(db, {
        nodeId,
        instanceId,
        seq,
        latestReport: latestMetrics,
        geo,
        serverTimeMs,
        persistedSampleSeq: maxPersistCandidateSampleSeq,
        droppedSamples: report.dropped_samples || 0,
        buckets: bucketsToPersist,
      });

      actuallyPersisted = true;
      currentAttachment.persisted_sample_seq = Math.max(currentAttachment.persisted_sample_seq, maxPersistCandidateSampleSeq);
      currentAttachment.last_persist_bucket_ms = Math.max(currentAttachment.last_persist_bucket_ms, ...sortedBucketKeys);
      currentAttachment.bucket_start_rx_bytes = currentRx;
      currentAttachment.bucket_start_tx_bytes = currentTx;
    } catch (err: any) {
      console.error(`[Ingest] D1 Checkpoint failed for node ${nodeId}:`, err);
    }

    // Traffic delta tracking is separately safeguarded
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
    } catch (err: any) {
      console.error(`[Ingest] Traffic delta tracking error for node ${nodeId}:`, err);
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
