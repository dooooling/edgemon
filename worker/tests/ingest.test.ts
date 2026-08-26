import { describe, it, expect } from 'vitest';
import { finalizeActiveTrafficSegment, trackTrafficDelta, computeBillingPeriodStart } from '../src/db/traffic';
import { validateReportPayload } from '../src/protocol/types';

function createMockDb() {
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

  let updateCalled = false;
  let updatedRx = 0;
  let updatedTx = 0;

  return {
    get updateCalled() { return updateCalled; },
    get updatedRx() { return updatedRx; },
    get updatedTx() { return updatedTx; },
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
          return null;
        },
        async run() {
          return { success: true };
        },
      };
    },
  } as any;
}

describe('Traffic Ingest & WebSocket Disconnect Finalization', () => {
  it('finalizeActiveTrafficSegment forces active bytes to finalize into D1 on disconnect', async () => {
    const mockDb = createMockDb();

    // Last known reading before disconnect: rx = 300 (base = 100 -> delta = 200), tx = 150 (base = 50 -> delta = 100)
    await finalizeActiveTrafficSegment(mockDb, 'node-1', 1, 300, 150);

    expect(mockDb.updateCalled).toBe(true);
    expect(mockDb.updatedRx).toBe(200); // 300 - 100 = 200
    expect(mockDb.updatedTx).toBe(100); // 150 - 50 = 100
  });

  it('trackTrafficDelta returns correct total period traffic in steady state', async () => {
    const mockDb = createMockDb();

    // Steady state: current rx = 400 (base = 100), tx = 200 (base = 50)
    const res = await trackTrafficDelta(mockDb, 'node-1', 400, 200, 'counter-a', 1, 300, 150);

    expect(res.periodRxBytes).toBe(1000 + (400 - 100)); // finalized(1000) + active(300) = 1300
    expect(res.periodTxBytes).toBe(500 + (200 - 50));   // finalized(500) + active(150) = 650
  });

  it('validateReportPayload handles both single report and samples array', () => {
    const singleReport = {
      cpu: { usage_pct: 12.5 },
      memory: { used_bytes: 1024 },
      rootfs: { used_bytes: null },
      io: { read_bps: 100 },
      network: { interface: 'eth0', rx_total_bytes: 1000, tx_total_bytes: 500 },
      probes: [],
    };
    expect(validateReportPayload(singleReport)).toBe(true);

    const batchReport = {
      samples: [
        {
          sample_seq: 100,
          sampled_at_ms: Date.now(),
          metrics: singleReport,
        },
      ],
      dropped_samples: 0,
    };
    expect(validateReportPayload(batchReport)).toBe(true);
  });
});
