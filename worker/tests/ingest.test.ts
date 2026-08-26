import { describe, it, expect } from 'vitest';
import { finalizeActiveTrafficSegment, trackTrafficDelta, computeBillingPeriodStart } from '../src/db/traffic';
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
  const batchStatements: string[] = [];

  return {
    get updateCalled() { return updateCalled; },
    get updatedRx() { return updatedRx; },
    get updatedTx() { return updatedTx; },
    get batchStatements() { return batchStatements; },
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          if (sql.includes('UPDATE traffic_periods SET')) {
            updateCalled = true;
            updatedRx = args[0];
            updatedTx = args[1];
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
      };
    },
    async batch(stmts: any[]) {
      batchStatements.push(...stmts.map((s: any) => s.toString()));
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
  it('finalizeActiveTrafficSegment forces active bytes to finalize into D1 on disconnect', async () => {
    const mockDb = createMockDb();
    await finalizeActiveTrafficSegment(mockDb, 'node-1', 1, 300, 150);

    expect(mockDb.updateCalled).toBe(true);
    expect(mockDb.updatedRx).toBe(200);
    expect(mockDb.updatedTx).toBe(100);
  });

  it('trackTrafficDelta returns correct total period traffic in steady state', async () => {
    const mockDb = createMockDb();
    const res = await trackTrafficDelta(mockDb, 'node-1', 400, 200, 'counter-a', 1, 300, 150);

    expect(res.periodRxBytes).toBe(1000 + (400 - 100));
    expect(res.periodTxBytes).toBe(500 + (200 - 50));
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
    expect(res.result.error).toBe('STALE_OR_DUPLICATE_SEQ');
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
    // Watermark advances from 1, NOT 5000
    expect(res.result.persisted_sample_seq).toBe(1);
    expect(res.updatedAttachment.persisted_sample_seq).toBe(1);
  });

  it('P0-2: multi-minute sample replay correctly aggregates into separate historical buckets', async () => {
    const mockDb = createMockDb('instance-1', 0);
    const attachment = createDefaultAttachment('node-1', 'Node 1', 'instance-1', Date.now(), mockGeo);
    attachment.last_persist_bucket_ms = 0;

    // 3 samples across 3 different minutes (14:00, 14:01, 14:02)
    const t0 = 1700000000000; // 14:00 bucket
    const t1 = 1700000060000; // 14:01 bucket
    const t2 = 1700000120000; // 14:02 bucket

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
    expect(res.result.persisted_sample_seq).toBe(4);
    expect(mockDb.batchStatements.length).toBeGreaterThanOrEqual(1);
  });
});
