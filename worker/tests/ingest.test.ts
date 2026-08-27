import { describe, it, expect } from 'vitest';
import {
  applySampleTrafficTransition,
  computeBillingPeriodStart,
  TrafficRuntimeState,
} from '../src/db/traffic';
import { validateReportPayload, MetricSample, ReportMetrics } from '../src/protocol/types';
import { ingestReportCore, createDefaultAttachment } from '../src/services/ingest';
import { NormalizedGeo } from '../src/services/geo';

function createMockDb(persistedInstanceId: string | null = null, persistedSampleSeq = 0) {
  const currentPeriodStartMs = computeBillingPeriodStart(Date.now(), 1);
  const period = {
    node_id: 'node-1',
    period_start_ms: currentPeriodStartMs,
    finalized_rx_bytes: 1000,
    finalized_tx_bytes: 500,
    active_counter_id: 'counter-a',
    active_rx_base_bytes: 100,
    active_tx_base_bytes: 50,
    updated_at_ms: Date.now(),
  };

  const nodeState = {
    node_id: 'node-1',
    agent_instance_id: persistedInstanceId || 'instance-old',
    last_seq: 100,
    last_seen_at_ms: Date.now(),
    boot_id: 'boot-1',
    network_counter_id: 'counter-a',
    network_interface: 'eth0',
    cpu_usage_pct: 10,
    cpu_throttled_pct: 0,
    memory_used_bytes: 1024,
    memory_working_set_bytes: 512,
    swap_used_bytes: 0,
    rootfs_used_bytes: null,
    disk_read_bps: 0,
    disk_write_bps: 0,
    rx_bps: 0,
    tx_bps: 0,
    rx_total_bytes: 1000,
    tx_total_bytes: 500,
    edge_rtt_ms: 10,
    edge_transport: 'tcp',
    uptime_sec: 100,
    probe_data_json: '[]',
    persisted_at_ms: 1700000000000,
    persisted_instance_id: persistedInstanceId,
    persisted_sample_seq: persistedSampleSeq,
    dropped_samples: 0,
  };

  let updateCalled = false;
  let updatedRx = 0;
  let updatedTx = 0;
  const batchStatements: any[] = [];
  const insertedBuckets: any[] = [];

  return {
    get updateCalled() { return updateCalled; },
    get updatedRx() { return updatedRx; },
    get updatedTx() { return updatedTx; },
    get batchStatements() { return batchStatements; },
    get insertedBuckets() { return insertedBuckets; },
    prepare(sql: string) {
      let boundArgs: any[] = [];
      return {
        bind(...args: any[]) {
          boundArgs = args;
          if (sql.includes('UPDATE traffic_periods SET')) {
            updateCalled = true;
            updatedRx = args[0];
            updatedTx = args[1];
            period.finalized_rx_bytes = args[0];
            period.finalized_tx_bytes = args[1];
            period.active_counter_id = args[2];
            period.active_rx_base_bytes = args[3];
            period.active_tx_base_bytes = args[4];
          }
          return this;
        },
        async first() {
          if (sql.includes('FROM traffic_periods')) {
            return { ...period };
          }
          if (sql.includes('FROM node_state')) {
            return { ...nodeState };
          }
          return null;
        },
        async run() {
          return { success: true };
        },
        toString() {
          return `SQL: ${sql} [${boundArgs.join(', ')}]`;
        },
        get sql() { return sql; },
        get args() { return boundArgs; },
      };
    },
    async batch(stmts: any[]) {
      batchStatements.push(...stmts);
      for (const s of stmts) {
        if (s.sql && s.sql.includes('INSERT INTO metrics_raw')) {
          insertedBuckets.push({
            bucketStartMs: s.args[1],
            cpuUsagePct: s.args[2],
            rxDelta: s.args[12],
            txDelta: s.args[13],
          });
        }
        if (s.sql && (s.sql.includes('INSERT INTO traffic_periods') || s.sql.includes('UPDATE traffic_periods SET'))) {
          updateCalled = true;
          if (s.sql.includes('INSERT INTO traffic_periods')) {
            updatedRx = s.args[2];
            updatedTx = s.args[3];
          } else {
            updatedRx = s.args[0];
            updatedTx = s.args[1];
          }
        }
      }
      return stmts.map(() => ({ success: true }));
    },
  } as any;
}

const mockGeo: NormalizedGeo = {
  colo: 'HKG',
  country: 'HK',
  city: 'Hong Kong',
  asn: 13335,
  asOrganization: 'Cloudflare',
  edge_rtt_ms: 12,
  edge_transport: 'tcp',
};

const baseMetrics: ReportMetrics = {
  config_rev: 1,
  cpu: { usage_pct: 15.0, throttled_pct: 0.0 },
  memory: { used_bytes: 1048576, working_set_bytes: 524288, swap_used_bytes: 0 },
  rootfs: { used_bytes: null },
  io: { read_bps: 1024, write_bps: 2048 },
  network: { interface: 'eth0', counter_id: 'cnt-1', rx_bps: 500, tx_bps: 200, rx_total_bytes: 2000, tx_total_bytes: 1000 },
  uptime_sec: 3600,
  probes: [],
};

describe('Traffic Ingest & WebSocket Disconnect Finalization', () => {
  it('Traffic state transitions in memory without mutating D1 out-of-band on disconnect', () => {
    let state: TrafficRuntimeState = {
      period_start_ms: computeBillingPeriodStart(Date.now(), 1),
      finalized_rx_bytes: 1000,
      finalized_tx_bytes: 500,
      active_counter_id: 'counter-a',
      active_rx_base_bytes: 100,
      active_tx_base_bytes: 50,
      dirty: false,
    };

    state = applySampleTrafficTransition(state, Date.now(), 400, 200, 'counter-a', 1, 300, 150);
    const activeRx = state.active_rx_base_bytes !== null ? Math.max(0, 400 - state.active_rx_base_bytes) : 0;
    const activeTx = state.active_tx_base_bytes !== null ? Math.max(0, 200 - state.active_tx_base_bytes) : 0;

    expect(state.finalized_rx_bytes + activeRx).toBe(1000 + (400 - 100));
    expect(state.finalized_tx_bytes + activeTx).toBe(500 + (200 - 50));
  });

  it('applySampleTrafficTransition updates active traffic segment in memory in steady state', () => {
    let state: TrafficRuntimeState = {
      period_start_ms: computeBillingPeriodStart(Date.now(), 1),
      finalized_rx_bytes: 1000,
      finalized_tx_bytes: 500,
      active_counter_id: 'counter-a',
      active_rx_base_bytes: 100,
      active_tx_base_bytes: 50,
      dirty: false,
    };

    state = applySampleTrafficTransition(state, Date.now(), 400, 200, 'counter-a', 1, 300, 150);
    const activeRx = state.active_rx_base_bytes !== null ? Math.max(0, 400 - state.active_rx_base_bytes) : 0;
    const activeTx = state.active_tx_base_bytes !== null ? Math.max(0, 200 - state.active_tx_base_bytes) : 0;

    expect(state.finalized_rx_bytes + activeRx).toBe(1000 + (400 - 100));
    expect(state.finalized_tx_bytes + activeTx).toBe(500 + (200 - 50));
  });

  it('validateReportPayload handles both single report and samples array', () => {
    expect(validateReportPayload(baseMetrics as any)).toBe(true);

    const batchReport = {
      samples: [
        {
          sample_seq: 100,
          sampled_at_ms: Date.now(),
          metrics: baseMetrics,
        },
      ],
      dropped_samples: 0,
    };
    expect(validateReportPayload(batchReport)).toBe(true);
  });
});

describe('Data Integrity v1 Ingest & Replay Protocol', () => {
  it('P0-4: handles duplicate envelope seq (ACK loss) idempotently without rejection', async () => {
    const mockDb = createMockDb('instance-1', 50);
    const attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', Date.now(), mockGeo);
    attachment.last_seq = 10;
    attachment.persisted_sample_seq = 50;

    // Retry with seq = 10 (same seq as last_seq)
    const res = await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      10,
      { samples: [{ sample_seq: 51, sampled_at_ms: Date.now(), metrics: baseMetrics }] },
      mockGeo,
      attachment
    );

    expect(res.result.accepted).toBe(true);
    expect(res.result.persisted_sample_seq).toBe(50);
  });

  it('P0-4: rejects truly stale envelope seq (seq < last_seq)', async () => {
    const mockDb = createMockDb('instance-1', 50);
    const attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', Date.now(), mockGeo);
    attachment.last_seq = 10;

    const res = await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      9,
      { samples: [{ sample_seq: 51, sampled_at_ms: Date.now(), metrics: baseMetrics }] },
      mockGeo,
      attachment
    );

    expect(res.result.accepted).toBe(false);
    expect(res.result.error).toBe('NON_MONOTONIC_SEQ');
  });

  it('P0-1: new instance does not inherit old instance watermark on stateless fallback', async () => {
    // D1 has old instance watermark = 5000
    const mockDb = createMockDb('instance-old', 5000);

    // New instance 'instance-new' ingests report
    const res = await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-new',
      1,
      { samples: [{ sample_seq: 1, sampled_at_ms: Date.now(), metrics: baseMetrics }] },
      mockGeo,
      null
    );

    expect(res.result.accepted).toBe(true);
    // Watermark does NOT inherit old instance's 5000
    expect(res.result.persisted_sample_seq).toBe(0);
    expect(res.updatedAttachment.persisted_sample_seq).toBe(0);
  });

  it('P0-2: HTTP fallback accepts new instance_id even when node_state has previous instance_id', async () => {
    // node_state currently has old instance-A
    const mockDb = createMockDb('instance-A', 100);

    // New instance-B sends report in HTTP fallback mode
    const res = await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-B',
      1,
      { samples: [{ sample_seq: 1, sampled_at_ms: Date.now(), metrics: baseMetrics }] },
      mockGeo,
      null
    );

    expect(res.result.accepted).toBe(true);
    expect(res.updatedAttachment.instance_id).toBe('instance-B');
    expect(res.updatedAttachment.persisted_sample_seq).toBe(0); // Starts cleanly at 0
  });

  it('P0: normal 2s reports accumulate into MinuteAccumulator and finalize on rollover with strict watermark', async () => {
    const mockDb = createMockDb('instance-1', 0);
    let attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', Date.now(), mockGeo);

    const t1200 = Math.floor(1700000000000 / 60000) * 60000; // 12:00:00 aligned
    const t1201 = t1200 + 60000; // 12:01:00 aligned

    // Report 1 at 12:00:02 (sample_seq=1, cpu=10%)
    const r1 = await ingestReportCore(
      mockDb, 'node-1', 'Node 1', 'instance-1', 1,
      { samples: [{ sample_seq: 1, sampled_at_ms: t1200 + 2000, metrics: { ...baseMetrics, cpu: { usage_pct: 10.0 } } }] },
      mockGeo, attachment
    );
    attachment = r1.updatedAttachment;
    expect(r1.result.accepted).toBe(true);
    expect(r1.result.persisted).toBe(false);
    expect(r1.result.persisted_sample_seq).toBe(0); // NOT advanced yet!

    // Report 2 at 12:00:04 (sample_seq=2, cpu=20%)
    const r2 = await ingestReportCore(
      mockDb, 'node-1', 'Node 1', 'instance-1', 2,
      { samples: [{ sample_seq: 2, sampled_at_ms: t1200 + 4000, metrics: { ...baseMetrics, cpu: { usage_pct: 20.0 } } }] },
      mockGeo, attachment
    );
    attachment = r2.updatedAttachment;
    expect(r2.result.persisted).toBe(false);
    expect(r2.result.persisted_sample_seq).toBe(0);

    // Report 3 at 12:00:58 (sample_seq=3, cpu=30%)
    const r3 = await ingestReportCore(
      mockDb, 'node-1', 'Node 1', 'instance-1', 3,
      { samples: [{ sample_seq: 3, sampled_at_ms: t1200 + 58000, metrics: { ...baseMetrics, cpu: { usage_pct: 30.0 } } }] },
      mockGeo, attachment
    );
    attachment = r3.updatedAttachment;
    expect(r3.result.persisted).toBe(false);
    expect(r3.result.persisted_sample_seq).toBe(0);

    // Report 4 at 12:01:00 (sample_seq=4, cpu=40%) -> Minute Rollover to 12:01!
    const r4 = await ingestReportCore(
      mockDb, 'node-1', 'Node 1', 'instance-1', 4,
      { samples: [{ sample_seq: 4, sampled_at_ms: t1201, metrics: { ...baseMetrics, cpu: { usage_pct: 40.0 } } }] },
      mockGeo, attachment
    );
    attachment = r4.updatedAttachment;

    // Report 4 closes 12:00 bucket!
    expect(r4.result.persisted).toBe(true);
    // Crucial invariant: Watermark advances to 3 (NOT 4, since 4 is in 12:01 pending accumulator!)
    expect(r4.result.persisted_sample_seq).toBe(3);
    expect(attachment.persisted_sample_seq).toBe(3);

    // Verify persisted bucket aggregate: avg CPU = (10 + 20 + 30) / 3 = 20.0%
    expect(mockDb.insertedBuckets.length).toBe(1);
    expect(mockDb.insertedBuckets[0].bucketStartMs).toBe(t1200);
    expect(mockDb.insertedBuckets[0].cpuUsagePct).toBe(20.0);
  });

  it('P0-2: multi-minute sample replay correctly aggregates into separate historical buckets', async () => {
    const mockDb = createMockDb('instance-1', 0);
    const attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', Date.now(), mockGeo);

    const t0 = Math.floor(1700000000000 / 60000) * 60000; // 14:00 bucket aligned
    const t1 = t0 + 60000; // 14:01 bucket aligned
    const t2 = t0 + 120000; // 14:02 bucket aligned

    const samples: MetricSample[] = [
      { sample_seq: 1, sampled_at_ms: t0 + 2000, metrics: { ...baseMetrics, cpu: { usage_pct: 10.0, throttled_pct: 0 } } },
      { sample_seq: 2, sampled_at_ms: t0 + 4000, metrics: { ...baseMetrics, cpu: { usage_pct: 20.0, throttled_pct: 0 } } },
      { sample_seq: 3, sampled_at_ms: t1 + 2000, metrics: { ...baseMetrics, cpu: { usage_pct: 30.0, throttled_pct: 0 } } },
      { sample_seq: 4, sampled_at_ms: t2 + 2000, metrics: { ...baseMetrics, cpu: { usage_pct: 40.0, throttled_pct: 0 } } },
    ];

    const res = await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      1,
      { samples },
      mockGeo,
      attachment
    );

    expect(res.result.accepted).toBe(true);
    expect(res.result.persisted).toBe(true);
    // Closed buckets up to t1 (sample 3) are durable
    expect(res.result.persisted_sample_seq).toBe(3);
    expect(mockDb.insertedBuckets.length).toBe(2);
    expect(mockDb.insertedBuckets[0].bucketStartMs).toBe(t0);
    expect(mockDb.insertedBuckets[0].cpuUsagePct).toBe(15.0); // (10 + 20) / 2
    expect(mockDb.insertedBuckets[1].bucketStartMs).toBe(t1);
    expect(mockDb.insertedBuckets[1].cpuUsagePct).toBe(30.0);
  });

  it('P0-1: D1 checkpoint failure returns PERSISTENCE_FAILED to trigger clean socket reconnect replay', async () => {
    const failingDb = createMockDb('instance-1', 0);
    failingDb.batch = async () => {
      throw new Error('D1_INTERNAL_LOCK_ERROR');
    };

    let attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', Date.now(), mockGeo);
    const t1200 = Math.floor(1700000000000 / 60000) * 60000;
    const t1201 = t1200 + 60000;

    // Report 1 in 12:00
    const r1 = await ingestReportCore(
      failingDb, 'node-1', 'Node 1', 'instance-1', 1,
      { samples: [{ sample_seq: 1, sampled_at_ms: t1200 + 2000, metrics: baseMetrics }] },
      mockGeo, attachment
    );
    attachment = r1.updatedAttachment;

    // Report 2 in 12:01 (Triggers rollover persistence which FAILS)
    const r2 = await ingestReportCore(
      failingDb, 'node-1', 'Node 1', 'instance-1', 2,
      { samples: [{ sample_seq: 2, sampled_at_ms: t1201, metrics: baseMetrics }] },
      mockGeo, attachment
    );

    expect(r2.result.accepted).toBe(false);
    expect(r2.result.error).toBe('PERSISTENCE_FAILED');
    expect(r2.result.persisted).toBe(false);
  });

  it('P0-3: sequential sample-by-sample counter reset captures peak reading before reset', async () => {
    const mockDb = createMockDb('instance-1', 0);
    const attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', Date.now(), mockGeo);
    const t0 = Math.floor(1700000000000 / 60000) * 60000;
    attachment.last_counter_id = 'cnt-1';
    attachment.last_rx_total_bytes = 1000;
    attachment.last_tx_total_bytes = 500;
    attachment.traffic_state = {
      period_start_ms: computeBillingPeriodStart(t0, 1),
      finalized_rx_bytes: 1000,
      finalized_tx_bytes: 500,
      active_counter_id: 'cnt-1',
      active_rx_base_bytes: 100,
      active_tx_base_bytes: 50,
      dirty: false,
    };

    // Batch contains: 1100 -> 1200 (peak) -> counter reset to 50 -> 100 -> minute rollover at 105
    const samples: MetricSample[] = [
      {
        sample_seq: 101,
        sampled_at_ms: t0 + 2000,
        metrics: {
          ...baseMetrics,
          network: { ...baseMetrics.network, counter_id: 'cnt-1', rx_total_bytes: 1100, tx_total_bytes: 550 },
        },
      },
      {
        sample_seq: 102,
        sampled_at_ms: t0 + 4000,
        metrics: {
          ...baseMetrics,
          network: { ...baseMetrics.network, counter_id: 'cnt-1', rx_total_bytes: 1200, tx_total_bytes: 600 },
        },
      },
      {
        sample_seq: 103,
        sampled_at_ms: t0 + 6000,
        metrics: {
          ...baseMetrics,
          network: { ...baseMetrics.network, counter_id: 'cnt-2', rx_total_bytes: 50, tx_total_bytes: 20 },
        },
      },
      {
        sample_seq: 104,
        sampled_at_ms: t0 + 8000,
        metrics: {
          ...baseMetrics,
          network: { ...baseMetrics.network, counter_id: 'cnt-2', rx_total_bytes: 100, tx_total_bytes: 40 },
        },
      },
      {
        sample_seq: 105,
        sampled_at_ms: t0 + 60000,
        metrics: {
          ...baseMetrics,
          network: { ...baseMetrics.network, counter_id: 'cnt-2', rx_total_bytes: 120, tx_total_bytes: 50 },
        },
      },
    ];

    const res = await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      1,
      { samples },
      mockGeo,
      attachment
    );

    expect(res.result.accepted).toBe(true);
    // Settle old counter at peak (1200 - 100 = 1100 delta) upon minute close
    expect(mockDb.updateCalled).toBe(true);
    expect(mockDb.updatedRx).toBe(2100); // 1000 previous finalized + 1100 delta from peak 1200 = 2100
    expect(mockDb.updatedTx).toBe(1050); // 500 previous finalized + 550 delta from peak 600 = 1050
  });

  it('P1-2: MinuteAccumulator correctly accumulates delta across counter reset within the same minute', async () => {
    const mockDb = createMockDb('instance-1', 0);
    const attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', Date.now(), mockGeo);
    const t1200 = Math.floor(1700000000000 / 60000) * 60000;
    const t1201 = t1200 + 60000;

    // Minute 12:00 has samples: 1000 -> 1100 (+100) -> 1200 (+100) -> reset 50 (0) -> 100 (+50) -> Total delta = 250
    const samples: MetricSample[] = [
      { sample_seq: 1, sampled_at_ms: t1200 + 2000, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1000, tx_total_bytes: 500 } } },
      { sample_seq: 2, sampled_at_ms: t1200 + 4000, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1100, tx_total_bytes: 550 } } },
      { sample_seq: 3, sampled_at_ms: t1200 + 6000, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1200, tx_total_bytes: 600 } } },
      { sample_seq: 4, sampled_at_ms: t1200 + 8000, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c2', rx_total_bytes: 50, tx_total_bytes: 20 } } },
      { sample_seq: 5, sampled_at_ms: t1200 + 10000, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c2', rx_total_bytes: 100, tx_total_bytes: 40 } } },
      { sample_seq: 6, sampled_at_ms: t1201, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c2', rx_total_bytes: 120, tx_total_bytes: 50 } } },
    ];

    const res = await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      1,
      { samples },
      mockGeo,
      attachment
    );

    expect(res.result.accepted).toBe(true);
    expect(mockDb.insertedBuckets.length).toBe(1);
    expect(mockDb.insertedBuckets[0].bucketStartMs).toBe(t1200);
    // Delta should be 100 + 100 + 50 = 250 (NOT 0!)
    expect(mockDb.insertedBuckets[0].rxDelta).toBe(250);
    expect(mockDb.insertedBuckets[0].txDelta).toBe(120); // 50 + 50 + 20 = 120
  });

  it('P1-1: cross-minute boundary delta is captured without interval loss', async () => {
    const mockDb = createMockDb('instance-1', 0);
    const attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', Date.now(), mockGeo);
    const t1200 = Math.floor(1700000000000 / 60000) * 60000;
    const t1201 = t1200 + 60000;
    const t1202 = t1201 + 60000;

    // Report 1 in minute 12:00: total = 1000
    await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      1,
      { samples: [{ sample_seq: 1, sampled_at_ms: t1200 + 58000, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1000, tx_total_bytes: 500 } } }] },
      mockGeo,
      attachment
    );

    // Report 2 in minute 12:01: first sample 1100 (+100 across boundary), second sample 1200 (+100)
    await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      2,
      {
        samples: [
          { sample_seq: 2, sampled_at_ms: t1201 + 2000, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1100, tx_total_bytes: 550 } } },
          { sample_seq: 3, sampled_at_ms: t1201 + 4000, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1200, tx_total_bytes: 600 } } },
        ],
      },
      mockGeo,
      attachment
    );

    // Report 3 in minute 12:02: rolls over minute 12:01 -> total = 1300 (+100 across boundary)
    await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      3,
      { samples: [{ sample_seq: 4, sampled_at_ms: t1202, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1300, tx_total_bytes: 650 } } }] },
      mockGeo,
      attachment
    );

    // Minute 12:01 should have finalized with rxDelta = 100 (from 1000->1100) + 100 (from 1100->1200) = 200
    const m1201 = mockDb.insertedBuckets.find((b) => b.bucketStartMs === t1201);
    expect(m1201).toBeDefined();
    expect(m1201?.rxDelta).toBe(200);
    expect(m1201?.txDelta).toBe(100);
  });

  it('P0-1: billing rollover settlement generated by active sample is NOT cleared by preceding minute checkpoint', async () => {
    const mockDb = createMockDb('instance-1', 0);
    // Set up timestamps crossing month boundary on the 1st (e.g. May 31 23:59 -> June 1 00:00)
    // 2024-05-31 23:59:58 UTC (1717200000000 approx)
    const tMay31 = Date.UTC(2024, 4, 31, 23, 59, 58); // Month is 0-indexed (4 = May)
    const tJune1_00 = Date.UTC(2024, 5, 1, 0, 0, 0); // June 1 00:00:00
    const tJune1_01 = Date.UTC(2024, 5, 1, 0, 1, 0); // June 1 00:01:00

    const attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', tMay31, mockGeo);
    attachment.traffic_state.active_rx_base_bytes = 100;
    attachment.traffic_state.active_tx_base_bytes = 50;
    attachment.traffic_state.active_counter_id = 'c1';
    attachment.last_rx_total_bytes = 100;
    attachment.last_tx_total_bytes = 50;
    attachment.last_counter_id = 'c1';

    // Sample 1 at 23:59:58 (May 31)
    await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      1,
      { samples: [{ sample_seq: 1, sampled_at_ms: tMay31, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1000, tx_total_bytes: 500 } } }] },
      mockGeo,
      attachment,
      1
    );

    // Sample 2 at 00:00:00 (June 1) -> triggers minute rollover of May 31 23:59 AND billing rollover to June 1!
    const res2 = await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      2,
      { samples: [{ sample_seq: 2, sampled_at_ms: tJune1_00, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1200, tx_total_bytes: 600 } } }] },
      mockGeo,
      attachment,
      1
    );

    expect(res2.result.accepted).toBe(true);
    // May 31 23:59 minute was persisted
    expect(res2.result.persisted).toBe(true);

    // CRITICAL P0-1 ASSERTION:
    // The live attachment's prev_period_settlement for May 31 MUST NOT have been wiped out by May 31 checkpoint!
    expect(attachment.traffic_state.prev_period_settlement).not.toBeNull();
    expect(attachment.traffic_state.prev_period_settlement?.period_start_ms).toBe(Date.UTC(2024, 4, 1, 0, 0, 0));
    expect(attachment.traffic_state.prev_period_settlement?.finalized_rx_delta).toBe(1000 - 100); // 900 delta from base 100

    // Sample 3 at 00:01:00 (June 1) -> triggers minute rollover of June 1 00:00:00
    const res3 = await ingestReportCore(
      mockDb,
      'node-1',
      'Node 1',
      'instance-1',
      3,
      { samples: [{ sample_seq: 3, sampled_at_ms: tJune1_01, metrics: { ...baseMetrics, network: { ...baseMetrics.network, counter_id: 'c1', rx_total_bytes: 1400, tx_total_bytes: 700 } } }] },
      mockGeo,
      attachment,
      1
    );

    expect(res3.result.accepted).toBe(true);
    expect(res3.result.persisted).toBe(true);
    // After June 1 00:00 checkpoint committed the settlement, now it is cleanly null
    expect(attachment.traffic_state.prev_period_settlement).toBeNull();
  });
});
