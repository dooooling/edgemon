import { MetricSample, ReportMetrics, ReportPayload, validateReportPayload } from '../protocol/types';
import { NormalizedGeo } from './geo';
import { persist60sCheckpoint, RawBucketMetric } from '../db/persistence';
import {
  applySampleTrafficTransition,
  buildTrafficD1Statements,
  cloneTrafficRuntimeState,
  computeBillingPeriodStart,
  loadTrafficRuntimeState,
  TrafficRuntimeState,
} from '../db/traffic';
import { getNodeState } from '../db/metrics';

export interface MinuteAccumulator {
  bucket_start_ms: number;
  first_sample_seq: number;
  last_sample_seq: number;
  rx_delta_sum: number;
  tx_delta_sum: number;
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
  last_ping_ts_ms: number;
  current_minute: MinuteAccumulator | null;
  historical_minutes: Record<string, MinuteAccumulator>;
  traffic_state: TrafficRuntimeState;
  token_hash?: string | null;
  last_token_verified_at_ms?: number;
}

export interface IngestResult {
  accepted: boolean;
  persisted: boolean;
  persisted_sample_seq?: number;
  error?: string;
  livePayload?: unknown;
  isHiddenNode?: boolean;
}

interface DurableCut {
  sampleSeq: number;
  report: ReportMetrics;
  trafficState: TrafficRuntimeState;
}

export function createMinuteAccumulator(
  bucketStartMs: number,
  sample: MetricSample,
  rxDelta = 0,
  txDelta = 0
): MinuteAccumulator {
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
    rx_delta_sum: rxDelta,
    tx_delta_sum: txDelta,
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

export function mergeIntoAccumulator(
  acc: MinuteAccumulator,
  sample: MetricSample,
  rxDelta = 0,
  txDelta = 0
): void {
  const m = sample.metrics;
  acc.rx_delta_sum += rxDelta;
  acc.tx_delta_sum += txDelta;
  acc.last_sample_seq = sample.sample_seq;
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
  const last = acc.last_metrics || ({} as Partial<ReportMetrics>);
  const avgCpu = acc.cpu_count > 0 ? Number((acc.cpu_sum / acc.cpu_count).toFixed(2)) : last.cpu?.usage_pct ?? null;
  const avgMem = acc.memory_count > 0 ? Math.round(acc.memory_sum / acc.memory_count) : last.memory?.used_bytes ?? null;
  const avgRead = acc.read_bps_count > 0 ? Math.round(acc.read_bps_sum / acc.read_bps_count) : last.io?.read_bps ?? null;
  const avgWrite = acc.write_bps_count > 0 ? Math.round(acc.write_bps_sum / acc.write_bps_count) : last.io?.write_bps ?? null;
  const avgRxBps = acc.rx_bps_count > 0 ? Math.round(acc.rx_bps_sum / acc.rx_bps_count) : last.network?.rx_bps ?? null;
  const avgTxBps = acc.tx_bps_count > 0 ? Math.round(acc.tx_bps_sum / acc.tx_bps_count) : last.network?.tx_bps ?? null;

  const report: ReportMetrics = {
    config_rev: last.config_rev ?? 0,
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
      interface: last.network?.interface || 'eth0',
      counter_id: last.network?.counter_id ?? null,
      rx_bps: avgRxBps,
      tx_bps: avgTxBps,
      rx_total_bytes: last.network?.rx_total_bytes ?? 0,
      tx_total_bytes: last.network?.tx_total_bytes ?? 0,
    },
    uptime_sec: last.uptime_sec,
    probes: last.probes || [],
  };

  return {
    bucketStartMs: acc.bucket_start_ms,
    report,
    rxDelta: acc.rx_delta_sum,
    txDelta: acc.tx_delta_sum,
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

  // 2. Monotonic Seq Check with Idempotent Retry on ACK Loss
  if (attachment) {
    if (seq < attachment.last_seq) {
      return {
        result: { accepted: false, persisted: false, error: 'NON_MONOTONIC_SEQ', isHiddenNode: isHidden },
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

  // Resolve or initialize in-memory connection state
  const currentAttachment: AgentAttachment = attachment || createDefaultAttachment(
    nodeId,
    nodeName,
    instanceId,
    serverTimeMs,
    geo,
    trafficResetDay,
    isHidden
  );
  currentAttachment.last_seq = seq;

  // Hydrate D1 state on stateless HTTP fallback BEFORE filtering samples (P0-2)
  if (!attachment) {
    const lastDbState = await getNodeState(db, nodeId);
    if (lastDbState) {
      if (lastDbState.persisted_instance_id === instanceId && lastDbState.persisted_sample_seq) {
        currentAttachment.persisted_sample_seq = lastDbState.persisted_sample_seq;
      }
      // Load true last persisted bucket from metrics_raw (P0-1)
      const lastBucketRow = await db
        .prepare('SELECT MAX(bucket_start_ms) AS last_bucket FROM metrics_raw WHERE node_id = ?')
        .bind(nodeId)
        .first<{ last_bucket: number | null }>();
      currentAttachment.last_persist_bucket_ms = lastBucketRow?.last_bucket ?? 0;
      currentAttachment.last_rx_total_bytes = lastDbState.rx_total_bytes;
      currentAttachment.last_tx_total_bytes = lastDbState.tx_total_bytes;
      currentAttachment.last_counter_id = lastDbState.network_counter_id;
    }
    currentAttachment.traffic_state = await loadTrafficRuntimeState(db, nodeId, trafficResetDay);
  }

  // Periodic Token & Node Existence Re-validation (every 60s of wall-clock server time, independent of Agent sampled_at_ms)
  if (
    currentAttachment.token_hash &&
    serverTimeMs - (currentAttachment.last_token_verified_at_ms || currentAttachment.connected_at_ms) >= 60000
  ) {
    const nodeRow = await db
      .prepare('SELECT token_hash FROM nodes WHERE id = ?')
      .bind(nodeId)
      .first<{ token_hash: string }>();
    if (!nodeRow || nodeRow.token_hash !== currentAttachment.token_hash) {
      return {
        result: {
          accepted: false,
          persisted: false,
          error: 'AUTH_FAILED',
          isHiddenNode: currentAttachment.is_hidden,
        },
        updatedAttachment: currentAttachment,
      };
    }
    currentAttachment.last_token_verified_at_ms = serverTimeMs;
  }

  // 3. Extract and filter valid samples
  const rawSamples = report.samples || [{
    sample_seq: seq,
    sampled_at_ms: serverTimeMs,
    metrics: report as unknown as ReportMetrics,
  }];

  const validSamples = rawSamples.filter((s) => s.sample_seq > currentAttachment.persisted_sample_seq);

  if (validSamples.length === 0) {
    return {
      result: { accepted: false, persisted: false, error: 'EMPTY_OR_INVALID_SAMPLES', isHiddenNode: isHidden },
      updatedAttachment: currentAttachment,
    };
  }

  // Sort samples by sample_seq ASC
  validSamples.sort((a, b) => a.sample_seq - b.sample_seq);

  // Clock Sanity Check (P0-1): Clamp future timestamps strictly to serverTimeMs.
  // This guarantees that an agent cannot prematurely open a future minute bucket ahead of real edge time,
  // preventing false forward rollovers and duplicate bucket overwrites.
  const currentServerBucket = Math.floor(serverTimeMs / 60000) * 60000;

  for (const s of validSamples) {
    if (s.sampled_at_ms > serverTimeMs) {
      s.sampled_at_ms = serverTimeMs;
    }
  }

  // Guard against corrupted current_minute accumulator stuck in the future
  if (currentAttachment.current_minute && currentAttachment.current_minute.bucket_start_ms > currentServerBucket) {
    currentAttachment.current_minute = null;
  }

  const latestSample = validSamples[validSamples.length - 1];
  const latestMetrics = latestSample.metrics;

  // 4. Construct Live Broadcast Payload with true received_at_ms and sanitized samples array
  const livePayload = {
    node_id: nodeId,
    name: nodeName,
    instance_id: instanceId,
    received_at_ms: serverTimeMs,
    metrics: latestMetrics,
    samples: validSamples.map((s) => ({
      sample_seq: s.sample_seq,
      sampled_at_ms: s.sampled_at_ms,
      metrics: s.metrics,
    })),
    geo,
    is_hidden: currentAttachment.is_hidden,
  };

  // 5. Sample-by-Sample Traffic State Transition & Minute Accumulator (P0-1, P0-2, P0-3, P1-1, P1-2, P2)
  if (!currentAttachment.historical_minutes) {
    currentAttachment.historical_minutes = {};
  }
  const bucketsToPersist: RawBucketMetric[] = [];
  let durableCut: DurableCut | null = null;

  for (const s of validSamples) {
    const sampleBucket = Math.floor(s.sampled_at_ms / 60000) * 60000;
    const sampleCounterId = s.metrics.network?.counter_id || null;
    const sampleRx = s.metrics.network?.rx_total_bytes ?? null;
    const sampleTx = s.metrics.network?.tx_total_bytes ?? null;

    // 5.1 Global monotonic delta calculation across samples (P1-1: zero cross-minute boundary loss)
    const sameCounter = sampleCounterId !== null && sampleCounterId === currentAttachment.last_counter_id;
    const prevRx = currentAttachment.last_rx_total_bytes;
    const prevTx = currentAttachment.last_tx_total_bytes;

    const rxDelta = (sameCounter && prevRx !== null && sampleRx !== null && sampleRx >= prevRx)
      ? sampleRx - prevRx
      : 0;
    const txDelta = (sameCounter && prevTx !== null && sampleTx !== null && sampleTx >= prevTx)
      ? sampleTx - prevTx
      : 0;

    // 5.2 Minute Rollover & Accumulation Check BEFORE modifying live traffic_state
    if (currentAttachment.current_minute) {
      if (sampleBucket > currentAttachment.current_minute.bucket_start_ms) {
        // Forward Minute Rollover: previous minute is CLOSED and FINALIZED
        const finalizedHistorical = Object.values(currentAttachment.historical_minutes).filter(
          (h) => h.bucket_start_ms > currentAttachment.last_persist_bucket_ms
        );
        const maxFinalizedSeq = Math.max(
          currentAttachment.current_minute.last_sample_seq,
          ...finalizedHistorical.map((h) => h.last_sample_seq)
        );
        let latestFinalizedReport = currentAttachment.current_minute.last_metrics;
        for (const h of finalizedHistorical) {
          if (h.last_sample_seq === maxFinalizedSeq) {
            latestFinalizedReport = h.last_metrics;
          }
        }

        durableCut = {
          sampleSeq: maxFinalizedSeq,
          report: latestFinalizedReport,
          trafficState: cloneTrafficRuntimeState(currentAttachment.traffic_state),
        };

        for (const hist of finalizedHistorical) {
          bucketsToPersist.push(finalizeAccumulator(hist));
        }
        currentAttachment.historical_minutes = {};

        bucketsToPersist.push(finalizeAccumulator(currentAttachment.current_minute));
        currentAttachment.current_minute = createMinuteAccumulator(sampleBucket, s, rxDelta, txDelta);

        // Advance live in-memory traffic_state for this sample in the new minute
        currentAttachment.traffic_state = applySampleTrafficTransition(
          currentAttachment.traffic_state,
          s.sampled_at_ms,
          sampleRx ?? 0,
          sampleTx ?? 0,
          sampleCounterId,
          currentAttachment.traffic_reset_day,
          currentAttachment.last_rx_total_bytes,
          currentAttachment.last_tx_total_bytes
        );
      } else if (sampleBucket === currentAttachment.current_minute.bucket_start_ms) {
        // Same live minute: merge into live accumulator
        mergeIntoAccumulator(currentAttachment.current_minute, s, rxDelta, txDelta);

        // Advance live in-memory traffic_state for this sample in current minute
        currentAttachment.traffic_state = applySampleTrafficTransition(
          currentAttachment.traffic_state,
          s.sampled_at_ms,
          sampleRx ?? 0,
          sampleTx ?? 0,
          sampleCounterId,
          currentAttachment.traffic_reset_day,
          currentAttachment.last_rx_total_bytes,
          currentAttachment.last_tx_total_bytes
        );
      } else {
        // Historical sample earlier than live current_minute (sampleBucket < currentAttachment.current_minute.bucket_start_ms):
        // Active current_minute remains strictly intact and moving forward (P0: never evict or reopen active minute).
        if (sampleBucket > currentAttachment.last_persist_bucket_ms) {
          // Uncommitted historical minute (e.g. out-of-order replay or temporary clock rollback):
          const histKey = String(sampleBucket);
          let hist = currentAttachment.historical_minutes[histKey];
          if (hist) {
            mergeIntoAccumulator(hist, s, rxDelta, txDelta);
          } else {
            hist = createMinuteAccumulator(sampleBucket, s, rxDelta, txDelta);
            currentAttachment.historical_minutes[histKey] = hist;
          }
        } else {
          // Sample timestamp belongs to an already-sealed D1 bucket (sampleBucket <= last_persist_bucket_ms),
          // but s.sample_seq is a valid newer sample. Fold its metrics and sample_seq safely into active current_minute
          // to ensure contiguous durable cut without modifying the sealed past D1 bucket.
          mergeIntoAccumulator(currentAttachment.current_minute, s, rxDelta, txDelta);
        }

        // Advance traffic_state for sample s (to keep monotonic counter tracking active):
        currentAttachment.traffic_state = applySampleTrafficTransition(
          currentAttachment.traffic_state,
          s.sampled_at_ms,
          sampleRx ?? 0,
          sampleTx ?? 0,
          sampleCounterId,
          currentAttachment.traffic_reset_day,
          currentAttachment.last_rx_total_bytes,
          currentAttachment.last_tx_total_bytes
        );

        // Advance historical durable cut if this sample is earlier than live current_minute (P1: snapshot AFTER transition)
        if (
          sampleBucket > currentAttachment.last_persist_bucket_ms &&
          s.sample_seq < currentAttachment.current_minute.first_sample_seq
        ) {
          const prevCutSeq: number = durableCut ? (durableCut as DurableCut).sampleSeq : 0;
          durableCut = {
            sampleSeq: Math.max(prevCutSeq, s.sample_seq),
            report: s.metrics,
            trafficState: cloneTrafficRuntimeState(currentAttachment.traffic_state),
          };
        }
      }
    } else {
      if (sampleBucket > currentAttachment.last_persist_bucket_ms) {
        currentAttachment.current_minute = createMinuteAccumulator(sampleBucket, s, rxDelta, txDelta);
      } else {
        // Initial sample with rolled-back timestamp: create accumulator for currentServerBucket
        currentAttachment.current_minute = createMinuteAccumulator(currentServerBucket, s, rxDelta, txDelta);
      }

      // Advance live in-memory traffic_state for this initial sample
      currentAttachment.traffic_state = applySampleTrafficTransition(
        currentAttachment.traffic_state,
        s.sampled_at_ms,
        sampleRx ?? 0,
        sampleTx ?? 0,
        sampleCounterId,
        currentAttachment.traffic_reset_day,
        currentAttachment.last_rx_total_bytes,
        currentAttachment.last_tx_total_bytes
      );
    }

    if (sampleCounterId !== null) {
      currentAttachment.last_counter_id = sampleCounterId;
    }
    if (sampleRx !== null && sampleCounterId !== null) currentAttachment.last_rx_total_bytes = sampleRx;
    if (sampleTx !== null && sampleCounterId !== null) currentAttachment.last_tx_total_bytes = sampleTx;
  }

  // If durableCut was established, push any eligible uncommitted historical buckets to bucketsToPersist
  if (durableCut !== null && currentAttachment.historical_minutes) {
    for (const [bStartStr, hist] of Object.entries(currentAttachment.historical_minutes)) {
      const bStart = Number(bStartStr);
      if (bStart > currentAttachment.last_persist_bucket_ms) {
        bucketsToPersist.push(finalizeAccumulator(hist));
      }
    }
    currentAttachment.historical_minutes = {};
  }

  // On stateless HTTP fallback, if this is a standalone report with completed past minute bucket,
  // finalize any past minute bucket
  const currentServerBucketStartMs = Math.floor(serverTimeMs / 60000) * 60000;
  if (!attachment && currentAttachment.current_minute && currentAttachment.current_minute.bucket_start_ms < currentServerBucketStartMs) {
    durableCut = {
      sampleSeq: currentAttachment.current_minute.last_sample_seq,
      report: currentAttachment.current_minute.last_metrics,
      trafficState: cloneTrafficRuntimeState(currentAttachment.traffic_state),
    };
    bucketsToPersist.push(finalizeAccumulator(currentAttachment.current_minute));
  }

  let actuallyPersisted = false;

  // 6. Atomic Persistence Checkpoint (P0-1: single durable cut alignment)
  // Checkpoint is written to D1 ONLY when a durable cut is established (closed minute or finalized historical prefix).
  // Live samples for the unclosed active minute remain strictly in DO RAM and Agent buffer.
  if (bucketsToPersist.length > 0 && durableCut !== null) {
    const cutReport = durableCut.report;
    const cutTrafficState = durableCut.trafficState;
    const cutSampleSeq = durableCut.sampleSeq;

    const trafficStatements = buildTrafficD1Statements(db, nodeId, cutTrafficState, serverTimeMs);

    try {
      await persist60sCheckpoint(db, {
        nodeId,
        instanceId,
        seq,
        latestReport: cutReport,
        geo,
        serverTimeMs,
        persistedSampleSeq: cutSampleSeq,
        droppedSamples: report.dropped_samples || 0,
        buckets: bucketsToPersist,
        trafficStatements,
        expectedTokenHash: currentAttachment.token_hash,
      });

      actuallyPersisted = true;
      const committedSettlement = cutTrafficState.prev_period_settlement;
      if (
        committedSettlement &&
        currentAttachment.traffic_state.prev_period_settlement?.period_start_ms === committedSettlement.period_start_ms
      ) {
        currentAttachment.traffic_state.prev_period_settlement = null;
      }
      // Strict equality check: clear dirty ONLY if no new traffic mutations occurred during async persistence
      if (
        currentAttachment.traffic_state.period_start_ms === cutTrafficState.period_start_ms &&
        currentAttachment.traffic_state.active_counter_id === cutTrafficState.active_counter_id &&
        currentAttachment.traffic_state.active_rx_base_bytes === cutTrafficState.active_rx_base_bytes &&
        currentAttachment.traffic_state.active_tx_base_bytes === cutTrafficState.active_tx_base_bytes &&
        currentAttachment.traffic_state.finalized_rx_bytes === cutTrafficState.finalized_rx_bytes &&
        currentAttachment.traffic_state.finalized_tx_bytes === cutTrafficState.finalized_tx_bytes
      ) {
        currentAttachment.traffic_state.dirty = false;
      }
      currentAttachment.persisted_sample_seq = Math.max(currentAttachment.persisted_sample_seq, cutSampleSeq);
      currentAttachment.last_persist_bucket_ms = Math.max(
        currentAttachment.last_persist_bucket_ms,
        ...bucketsToPersist.map((b) => b.bucketStartMs)
      );
    } catch (err: any) {
      console.error(`[Ingest] D1 Checkpoint failed for node ${nodeId}:`, err);
      // P0-1: D1 persistence failed! Return error so RealtimeHub closes WSS to trigger Agent replay!
      return {
        result: {
          accepted: false,
          persisted: false,
          error: 'PERSISTENCE_FAILED',
          isHiddenNode: currentAttachment.is_hidden,
        },
        updatedAttachment: currentAttachment,
      };
    }
  }

  // 7. Update Runtime Attachment State
  currentAttachment.last_seq = seq;
  currentAttachment.last_report_received_at_ms = serverTimeMs;

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
  isHidden = false,
  tokenHash: string | null = null
): AgentAttachment {
  const periodStartMs = computeBillingPeriodStart(nowMs, trafficResetDay);
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
    last_ping_ts_ms: nowMs,
    current_minute: null,
    historical_minutes: {},
    traffic_state: {
      period_start_ms: periodStartMs,
      finalized_rx_bytes: 0,
      finalized_tx_bytes: 0,
      active_counter_id: null,
      active_rx_base_bytes: null,
      active_tx_base_bytes: null,
      dirty: false,
    },
    token_hash: tokenHash,
    last_token_verified_at_ms: nowMs,
  };
}
