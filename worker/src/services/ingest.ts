import { MetricSample, ReportMetrics, ReportPayload, validateReportPayload } from '../protocol/types';
import { NormalizedGeo } from './geo';
import { persist60sCheckpoint, RawBucketMetric } from '../db/persistence';
import { trackTrafficDelta } from '../db/traffic';
import { getNodeState } from '../db/metrics';

export interface MinuteAccumulator {
  bucket_start_ms: number;
  first_sample_seq: number;
  last_sample_seq: number;
  first_rx_total_bytes: number;
  first_tx_total_bytes: number;
  last_rx_total_bytes: number;
  last_tx_total_bytes: number;
  cpu_sum: number;
  cpu_count: number;
  cpu_throttled_max: number | null;
  memory_sum: number;
  memory_count: number;
  read_bps_sum: number;
  read_bps_count: number;
  write_bps_sum: number;
  write_bps_count: number;
  rx_bps_sum: number;
  rx_bps_count: number;
  tx_bps_sum: number;
  tx_bps_count: number;
  last_metrics: ReportMetrics;
}

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
  current_minute: MinuteAccumulator | null;
}

export interface IngestResult {
  accepted: boolean;
  persisted: boolean;
  persisted_sample_seq?: number;
  error?: string;
  livePayload?: unknown;
  isHiddenNode?: boolean;
}

export function createMinuteAccumulator(bucketStartMs: number, sample: MetricSample): MinuteAccumulator {
  const m = sample.metrics;
  const cpuUsage = typeof m.cpu?.usage_pct === 'number' && Number.isFinite(m.cpu.usage_pct) ? m.cpu.usage_pct : null;
  const memUsed = typeof m.memory?.used_bytes === 'number' && Number.isFinite(m.memory.used_bytes) ? m.memory.used_bytes : null;
  const readBps = typeof m.io?.read_bps === 'number' && Number.isFinite(m.io.read_bps) ? m.io.read_bps : null;
  const writeBps = typeof m.io?.write_bps === 'number' && Number.isFinite(m.io.write_bps) ? m.io.write_bps : null;
  const rxBps = typeof m.network?.rx_bps === 'number' && Number.isFinite(m.network.rx_bps) ? m.network.rx_bps : null;
  const txBps = typeof m.network?.tx_bps === 'number' && Number.isFinite(m.network.tx_bps) ? m.network.tx_bps : null;

  return {
    bucket_start_ms: bucketStartMs,
    first_sample_seq: sample.sample_seq,
    last_sample_seq: sample.sample_seq,
    first_rx_total_bytes: m.network.rx_total_bytes,
    first_tx_total_bytes: m.network.tx_total_bytes,
    last_rx_total_bytes: m.network.rx_total_bytes,
    last_tx_total_bytes: m.network.tx_total_bytes,
    cpu_sum: cpuUsage ?? 0,
    cpu_count: cpuUsage !== null ? 1 : 0,
    cpu_throttled_max: typeof m.cpu?.throttled_pct === 'number' && Number.isFinite(m.cpu.throttled_pct) ? m.cpu.throttled_pct : null,
    memory_sum: memUsed ?? 0,
    memory_count: memUsed !== null ? 1 : 0,
    read_bps_sum: readBps ?? 0,
    read_bps_count: readBps !== null ? 1 : 0,
    write_bps_sum: writeBps ?? 0,
    write_bps_count: writeBps !== null ? 1 : 0,
    rx_bps_sum: rxBps ?? 0,
    rx_bps_count: rxBps !== null ? 1 : 0,
    tx_bps_sum: txBps ?? 0,
    tx_bps_count: txBps !== null ? 1 : 0,
    last_metrics: m,
  };
}

export function mergeIntoAccumulator(acc: MinuteAccumulator, sample: MetricSample): void {
  const m = sample.metrics;
  acc.last_sample_seq = sample.sample_seq;
  acc.last_rx_total_bytes = m.network.rx_total_bytes;
  acc.last_tx_total_bytes = m.network.tx_total_bytes;
  acc.last_metrics = m;

  if (typeof m.cpu?.usage_pct === 'number' && Number.isFinite(m.cpu.usage_pct)) {
    acc.cpu_sum += m.cpu.usage_pct;
    acc.cpu_count += 1;
  }
  if (typeof m.cpu?.throttled_pct === 'number' && Number.isFinite(m.cpu.throttled_pct)) {
    acc.cpu_throttled_max = Math.max(acc.cpu_throttled_max ?? 0, m.cpu.throttled_pct);
  }
  if (typeof m.memory?.used_bytes === 'number' && Number.isFinite(m.memory.used_bytes)) {
    acc.memory_sum += m.memory.used_bytes;
    acc.memory_count += 1;
  }
  if (typeof m.io?.read_bps === 'number' && Number.isFinite(m.io.read_bps)) {
    acc.read_bps_sum += m.io.read_bps;
    acc.read_bps_count += 1;
  }
  if (typeof m.io?.write_bps === 'number' && Number.isFinite(m.io.write_bps)) {
    acc.write_bps_sum += m.io.write_bps;
    acc.write_bps_count += 1;
  }
  if (typeof m.network?.rx_bps === 'number' && Number.isFinite(m.network.rx_bps)) {
    acc.rx_bps_sum += m.network.rx_bps;
    acc.rx_bps_count += 1;
  }
  if (typeof m.network?.tx_bps === 'number' && Number.isFinite(m.network.tx_bps)) {
    acc.tx_bps_sum += m.network.tx_bps;
    acc.tx_bps_count += 1;
  }
}

export function finalizeAccumulator(acc: MinuteAccumulator): RawBucketMetric {
  const last = acc.last_metrics;
  const avgCpu = acc.cpu_count > 0 ? Number((acc.cpu_sum / acc.cpu_count).toFixed(2)) : last.cpu?.usage_pct ?? null;
  const avgMem = acc.memory_count > 0 ? Math.round(acc.memory_sum / acc.memory_count) : last.memory?.used_bytes ?? null;
  const avgRead = acc.read_bps_count > 0 ? Math.round(acc.read_bps_sum / acc.read_bps_count) : last.io?.read_bps ?? null;
  const avgWrite = acc.write_bps_count > 0 ? Math.round(acc.write_bps_sum / acc.write_bps_count) : last.io?.write_bps ?? null;
  const avgRxBps = acc.rx_bps_count > 0 ? Math.round(acc.rx_bps_sum / acc.rx_bps_count) : last.network?.rx_bps ?? null;
  const avgTxBps = acc.tx_bps_count > 0 ? Math.round(acc.tx_bps_sum / acc.tx_bps_count) : last.network?.tx_bps ?? null;

  const rxDelta = Math.max(0, acc.last_rx_total_bytes - acc.first_rx_total_bytes);
  const txDelta = Math.max(0, acc.last_tx_total_bytes - acc.first_tx_total_bytes);

  const report: ReportMetrics = {
    config_rev: last.config_rev,
    boot_id: last.boot_id,
    cpu: {
      usage_pct: avgCpu,
      throttled_pct: acc.cpu_throttled_max ?? last.cpu?.throttled_pct ?? null,
    },
    memory: {
      used_bytes: avgMem,
      working_set_bytes: last.memory?.working_set_bytes ?? null,
      swap_used_bytes: last.memory?.swap_used_bytes ?? null,
    },
    rootfs: {
      used_bytes: last.rootfs?.used_bytes ?? null,
    },
    io: {
      read_bps: avgRead,
      write_bps: avgWrite,
    },
    network: {
      interface: last.network.interface,
      counter_id: last.network.counter_id,
      rx_bps: avgRxBps,
      tx_bps: avgTxBps,
      rx_total_bytes: acc.last_rx_total_bytes,
      tx_total_bytes: acc.last_tx_total_bytes,
    },
    uptime_sec: last.uptime_sec,
    probes: last.probes,
  };

  return {
    bucketStartMs: acc.bucket_start_ms,
    report,
    rxDelta,
    txDelta,
  };
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

  // 4. Construct Live Broadcast Payload with true sampled_at_ms and full samples array (P1-1)
  const livePayload = {
    node_id: nodeId,
    name: nodeName,
    instance_id: instanceId,
    ts_ms: latestSample.sampled_at_ms,
    metrics: latestMetrics,
    samples: validSamples.map((s) => ({
      sample_seq: s.sample_seq,
      sampled_at_ms: s.sampled_at_ms,
      metrics: s.metrics,
    })),
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

  // 6. Minute Accumulator & Minute Rollover Finalization (P0-1 & P0-2)
  const bucketsToPersist: RawBucketMetric[] = [];
  let maxDurableCandidateSeq = currentAttachment.persisted_sample_seq;

  for (const s of validSamples) {
    const sampleBucket = Math.floor(s.sampled_at_ms / 60000) * 60000;

    if (!currentAttachment.current_minute) {
      currentAttachment.current_minute = createMinuteAccumulator(sampleBucket, s);
    } else if (sampleBucket === currentAttachment.current_minute.bucket_start_ms) {
      // Same minute: merge sample into accumulator (no D1 write, watermark not advanced)
      mergeIntoAccumulator(currentAttachment.current_minute, s);
    } else if (sampleBucket > currentAttachment.current_minute.bucket_start_ms) {
      // Minute Rollover! Previous minute bucket is now COMPLETED!
      const finalized = finalizeAccumulator(currentAttachment.current_minute);
      bucketsToPersist.push(finalized);
      maxDurableCandidateSeq = Math.max(maxDurableCandidateSeq, currentAttachment.current_minute.last_sample_seq);

      // Start new accumulator for the newer minute
      currentAttachment.current_minute = createMinuteAccumulator(sampleBucket, s);
    } else {
      // Historical sample prior to current accumulator (e.g. from buffer replay)
      const histAcc = createMinuteAccumulator(sampleBucket, s);
      bucketsToPersist.push(finalizeAccumulator(histAcc));
      maxDurableCandidateSeq = Math.max(maxDurableCandidateSeq, s.sample_seq);
    }
  }

  // On stateless HTTP fallback, if this is a standalone report without continuous connection,
  // we can also finalize the current accumulator if bucket_start_ms > last_persist_bucket_ms
  if (!attachment && currentAttachment.current_minute) {
    const finalized = finalizeAccumulator(currentAttachment.current_minute);
    bucketsToPersist.push(finalized);
    maxDurableCandidateSeq = Math.max(maxDurableCandidateSeq, currentAttachment.current_minute.last_sample_seq);
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
        persistedSampleSeq: maxDurableCandidateSeq,
        droppedSamples: report.dropped_samples || 0,
        buckets: bucketsToPersist,
      });

      actuallyPersisted = true;
      currentAttachment.persisted_sample_seq = Math.max(currentAttachment.persisted_sample_seq, maxDurableCandidateSeq);
      currentAttachment.last_persist_bucket_ms = Math.max(
        currentAttachment.last_persist_bucket_ms,
        ...bucketsToPersist.map((b) => b.bucketStartMs)
      );
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
    current_minute: null,
  };
}
