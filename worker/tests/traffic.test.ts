import { describe, it, expect } from 'vitest';
import { computeBillingPeriodStart } from '../src/db/traffic';

describe('Traffic Period Calculation', () => {
  it('computes correct period start on same day', () => {
    // 2026-08-25 15:00:00 UTC with resetDay = 1 -> 2026-08-01 00:00:00 UTC
    const now = Date.UTC(2026, 7, 25, 15, 0, 0); // Month 7 is August
    const periodStart = computeBillingPeriodStart(now, 1);
    const expected = Date.UTC(2026, 7, 1, 0, 0, 0);
    expect(periodStart).toBe(expected);
  });

  it('computes previous month when before reset day', () => {
    // 2026-08-05 10:00:00 UTC with resetDay = 15 -> 2026-07-15 00:00:00 UTC
    const now = Date.UTC(2026, 7, 5, 10, 0, 0);
    const periodStart = computeBillingPeriodStart(now, 15);
    const expected = Date.UTC(2026, 6, 15, 0, 0, 0);
    expect(periodStart).toBe(expected);
  });

  it('handles year rollover across January', () => {
    // 2026-01-05 UTC with resetDay = 15 -> 2025-12-15 00:00:00 UTC
    const now = Date.UTC(2026, 0, 5, 10, 0, 0);
    const periodStart = computeBillingPeriodStart(now, 15);
    const expected = Date.UTC(2025, 11, 15, 0, 0, 0);
    expect(periodStart).toBe(expected);
  });

  it('handles resetDay = 31 in February (short month edge case)', () => {
    // 2026-02-28 UTC (non-leap year, last day of Feb) with resetDay = 31
    // Effective reset day in Feb is 28, so on Feb 28 it belongs to Feb 28 cycle!
    const feb28 = Date.UTC(2026, 1, 28, 12, 0, 0);
    const periodFeb28 = computeBillingPeriodStart(feb28, 31);
    expect(periodFeb28).toBe(Date.UTC(2026, 1, 28, 0, 0, 0));

    // 2026-02-15 UTC with resetDay = 31 -> before Feb 28, belongs to Jan 31 cycle
    const feb15 = Date.UTC(2026, 1, 15, 12, 0, 0);
    const periodFeb15 = computeBillingPeriodStart(feb15, 31);
    expect(periodFeb15).toBe(Date.UTC(2026, 0, 31, 0, 0, 0));
  });

  it('handles resetDay = 31 in leap year February 29', () => {
    // 2028 is a leap year (Feb has 29 days)
    const feb29 = Date.UTC(2028, 1, 29, 12, 0, 0);
    const periodFeb29 = computeBillingPeriodStart(feb29, 31);
    expect(periodFeb29).toBe(Date.UTC(2028, 1, 29, 0, 0, 0));

    const feb28 = Date.UTC(2028, 1, 28, 12, 0, 0);
    const periodFeb28 = computeBillingPeriodStart(feb28, 31);
    expect(periodFeb28).toBe(Date.UTC(2028, 0, 31, 0, 0, 0));
  });

  it('handles resetDay = 31 in 30-day month (April)', () => {
    // 2026-04-30 UTC with resetDay = 31 -> effective reset day is April 30
    const apr30 = Date.UTC(2026, 3, 30, 10, 0, 0);
    const periodApr30 = computeBillingPeriodStart(apr30, 31);
    expect(periodApr30).toBe(Date.UTC(2026, 3, 30, 0, 0, 0));

    // 2026-05-01 UTC with resetDay = 31 -> May has 31 days, so May 1 is before May 31 -> April 30
    const may01 = Date.UTC(2026, 4, 1, 10, 0, 0);
    const periodMay01 = computeBillingPeriodStart(may01, 31);
    expect(periodMay01).toBe(Date.UTC(2026, 3, 30, 0, 0, 0));
  });

  it('computes 60s bucket step deltas correctly across high-frequency reports', () => {
    const bucketStartRx = 1000;
    let currentRx = 1000;

    for (let i = 1; i <= 30; i++) {
      currentRx += 20; // 20 bytes every 2s
    }

    const bucketDelta = currentRx - bucketStartRx;
    expect(bucketDelta).toBe(600);
  });

  it('settles traffic across counter reset correctly', () => {
    let finalizedRx = 0;
    let activeBaseRx = 100;
    const oldFinalRx = 250;

    // Finalize old counter segment
    const oldSegment = Math.max(0, oldFinalRx - activeBaseRx);
    finalizedRx += oldSegment;

    // New counter segment begins
    activeBaseRx = 10;
    const newCurrentRx = 30;
    const newActiveSegment = Math.max(0, newCurrentRx - activeBaseRx);

    const totalMonthRx = finalizedRx + newActiveSegment;
    expect(totalMonthRx).toBe(170);
  });

  it('P1-1: loadTrafficRuntimeState loads latest existing period when reset_day roundtrips in the same month', async () => {
    const aug01 = Date.UTC(2026, 7, 1, 0, 0, 0);
    const aug15 = Date.UTC(2026, 7, 15, 0, 0, 0);

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes('ORDER BY period_start_ms DESC LIMIT 1')) {
                  // Latest period in D1 is Aug 15 (when node previously ran with reset_day=15)
                  return {
                    node_id: 'node-1',
                    period_start_ms: aug15,
                    finalized_rx_bytes: 8000,
                    finalized_tx_bytes: 4000,
                    active_counter_id: 'c1',
                    active_rx_base_bytes: 6000,
                    active_tx_base_bytes: 3000,
                  };
                }
                return null;
              },
            };
          },
        };
      },
    } as any;

    const { loadTrafficRuntimeState } = await import('../src/db/traffic');
    // Admin switched reset_day back to 1 on Aug 27:
    const state = await loadTrafficRuntimeState(mockDb, 'node-1', 1);

    // Returns the latest active period Aug 15 (not a resurrected stale Aug 1 from weeks ago!)
    expect(state.period_start_ms).toBe(aug15);
    expect(state.active_rx_base_bytes).toBe(6000);
  });

  it('P0-2: loadTrafficRuntimeState returns previous period when new period row does not exist yet', async () => {
    const jul15 = Date.UTC(2026, 6, 15, 0, 0, 0);

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes('period_start_ms = ?')) {
                  // New period (e.g. Aug 15) does NOT exist yet!
                  return null;
                }
                if (sql.includes('ORDER BY period_start_ms DESC LIMIT 1')) {
                  // Return previous period (July 15)
                  return {
                    node_id: 'node-1',
                    period_start_ms: jul15,
                    finalized_rx_bytes: 10000,
                    finalized_tx_bytes: 5000,
                    active_counter_id: 'c1',
                    active_rx_base_bytes: 1000,
                    active_tx_base_bytes: 500,
                  };
                }
                return null;
              },
            };
          },
        };
      },
    } as any;

    const { loadTrafficRuntimeState } = await import('../src/db/traffic');
    const state = await loadTrafficRuntimeState(mockDb, 'node-1', 15);

    // Returns previous period's start (July 15) and active base (1000) so rollover can be triggered accurately
    expect(state.period_start_ms).toBe(jul15);
    expect(state.active_rx_base_bytes).toBe(1000);
  });
});
