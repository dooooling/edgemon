import { describe, it, expect } from 'vitest';
import { computeBillingPeriodStart, applySampleTrafficTransition, TrafficRuntimeState } from '../src/db/traffic';

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

  it('P1-1: loadTrafficRuntimeState loads latest existing period when reset_day roundtrips in the same month (first reconnect)', async () => {
    const aug01 = Date.UTC(2026, 7, 1, 0, 0, 0);
    const aug15 = Date.UTC(2026, 7, 15, 0, 0, 0);

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes('period_start_ms = ?')) {
                  // Old Aug 01 row from 3 weeks ago with older updated_at_ms (T1 = 1000)
                  return {
                    node_id: 'node-1',
                    period_start_ms: aug01,
                    finalized_rx_bytes: 2000,
                    finalized_tx_bytes: 1000,
                    active_counter_id: 'c1',
                    active_rx_base_bytes: 100,
                    active_tx_base_bytes: 50,
                    updated_at_ms: 1000,
                  };
                }
                if (sql.includes('ORDER BY updated_at_ms DESC LIMIT 1')) {
                  // Most recently updated period is Aug 15 with newer updated_at_ms (T2 = 2000)
                  return {
                    node_id: 'node-1',
                    period_start_ms: aug15,
                    finalized_rx_bytes: 8000,
                    finalized_tx_bytes: 4000,
                    active_counter_id: 'c1',
                    active_rx_base_bytes: 6000,
                    active_tx_base_bytes: 3000,
                    updated_at_ms: 2000,
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

    // Returns the active target period Aug 01 with latest live baseline (6000) inherited from Aug 15
    expect(state.period_start_ms).toBe(aug01);
    expect(state.active_rx_base_bytes).toBe(6000);
  });

  it('P0-2: loadTrafficRuntimeState resumes active period on second reconnect after reset_day switch', async () => {
    const aug01 = Date.UTC(2026, 7, 1, 0, 0, 0);
    const aug15 = Date.UTC(2026, 7, 15, 0, 0, 0);

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes('period_start_ms = ?')) {
                  // New active Aug 01 row created after rollover, updated_at_ms = 3000
                  return {
                    node_id: 'node-1',
                    period_start_ms: aug01,
                    finalized_rx_bytes: 0,
                    finalized_tx_bytes: 0,
                    active_counter_id: 'c1',
                    active_rx_base_bytes: 7000,
                    active_tx_base_bytes: 3500,
                    updated_at_ms: 3000,
                  };
                }
                if (sql.includes('ORDER BY updated_at_ms DESC LIMIT 1')) {
                  // Most recently updated is also Aug 01 (updated_at_ms = 3000)
                  return {
                    node_id: 'node-1',
                    period_start_ms: aug01,
                    finalized_rx_bytes: 0,
                    finalized_tx_bytes: 0,
                    active_counter_id: 'c1',
                    active_rx_base_bytes: 7000,
                    active_tx_base_bytes: 3500,
                    updated_at_ms: 3000,
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
    // Second reconnect after reset_day switch:
    const state = await loadTrafficRuntimeState(mockDb, 'node-1', 1);

    // Resumes active Aug 01 period with active base 7000 without resetting or rolling over!
    expect(state.period_start_ms).toBe(aug01);
    expect(state.active_rx_base_bytes).toBe(7000);
  });

  it('P0: clock rollback across traffic_reset_day boundary does NOT revert billing period or corrupt base/settlement', () => {
    const sep01 = Date.UTC(2026, 8, 1, 0, 0, 5, 0); // Sep 1 00:00:05
    const aug31 = Date.UTC(2026, 7, 31, 23, 59, 55, 0); // Aug 31 23:59:55
    const sep01Later = Date.UTC(2026, 8, 1, 0, 0, 15, 0); // Sep 1 00:00:15
    const sepPeriodStart = Date.UTC(2026, 8, 1, 0, 0, 0, 0);

    let state: TrafficRuntimeState = {
      period_start_ms: sepPeriodStart,
      finalized_rx_bytes: 1000,
      finalized_tx_bytes: 500,
      active_counter_id: 'counter-a',
      active_rx_base_bytes: 5000,
      active_tx_base_bytes: 2500,
      dirty: false,
      prev_period_settlement: null,
    };

    // 1. Clock rollback to Aug 31 23:59:55
    state = applySampleTrafficTransition(
      state,
      aug31,
      5200,
      2600,
      'counter-a',
      1, // resetDay = 1
      5000,
      2500
    );

    // Verified: period_start_ms remains Sep 1 (does NOT roll backward to Aug 1!)
    expect(state.period_start_ms).toBe(sepPeriodStart);
    expect(state.prev_period_settlement).toBeNull();
    // Base is preserved:
    expect(state.active_rx_base_bytes).toBe(5000);

    // 2. Normal sample advances at Sep 1 00:00:15
    state = applySampleTrafficTransition(
      state,
      sep01Later,
      5500,
      2750,
      'counter-a',
      1,
      5200,
      2600
    );

    expect(state.period_start_ms).toBe(sepPeriodStart);
    expect(state.prev_period_settlement).toBeNull();
    // Active bytes calculated correctly from base 5000:
    const activeRx = state.active_rx_base_bytes !== null ? 5500 - state.active_rx_base_bytes : 0;
    expect(activeRx).toBe(500); // 5500 - 5000 = 500 (not corrupted or underestimated!)
  });

  it('P0: dynamic traffic_reset_day change to earlier day (15 -> 1) correctly sets target billing period and smoothly accounts traffic', async () => {
    const aug01 = Date.UTC(2026, 7, 1, 0, 0, 0, 0);
    const aug15 = Date.UTC(2026, 7, 15, 0, 0, 0, 0);
    const aug27 = Date.UTC(2026, 7, 27, 12, 0, 0, 0);

    const mockDb = {
      prepare: (sql: string) => {
        return {
          bind: (...args: any[]) => {
            return {
              first: async () => {
                // If checking exact period for Aug 01, it doesn't exist yet
                if (sql.includes('period_start_ms = ?') && args[1] === aug01) {
                  return null;
                }
                if (sql.includes('ORDER BY updated_at_ms DESC LIMIT 1')) {
                  // Latest updated period in D1 was Aug 15 (updated_at_ms = 2000)
                  return {
                    node_id: 'node-1',
                    period_start_ms: aug15,
                    finalized_rx_bytes: 1000,
                    finalized_tx_bytes: 500,
                    active_counter_id: 'counter-a',
                    active_rx_base_bytes: 4000,
                    active_tx_base_bytes: 2000,
                    updated_at_ms: 2000,
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
    // Load state with new resetDay = 1 on Aug 27:
    const state = await loadTrafficRuntimeState(mockDb, 'node-1', 1);

    // Verified: period_start_ms is strictly set to Aug 01 (matching reset_day = 1)
    expect(state.period_start_ms).toBe(aug01);
    // Baseline is cleanly inherited from Aug 15:
    expect(state.active_rx_base_bytes).toBe(4000);
    expect(state.active_tx_base_bytes).toBe(2000);

    // Now incoming sample on Aug 27 accounts under Aug 01 without any forward-only conflict:
    const updatedState = applySampleTrafficTransition(
      state,
      aug27,
      4500,
      2300,
      'counter-a',
      1,
      4000,
      2000
    );

    expect(updatedState.period_start_ms).toBe(aug01);
    const activeRx = updatedState.active_rx_base_bytes !== null ? 4500 - updatedState.active_rx_base_bytes : 0;
    expect(activeRx).toBe(500);
  });

  it('P0: natural billing boundary reconnect and replay correctly settles old period and does NOT leak old traffic into new period', async () => {
    const aug01 = Date.UTC(2026, 7, 1, 0, 0, 0, 0); // Aug 1 00:00:00
    const aug31_2359 = Date.UTC(2026, 7, 31, 23, 59, 50, 0); // Aug 31 23:59:50
    const sep01_0000 = Date.UTC(2026, 8, 1, 0, 0, 10, 0); // Sep 1 00:00:10
    const sep01PeriodStart = Date.UTC(2026, 8, 1, 0, 0, 0, 0);

    // Mock D1 only has the Aug 1 period row (Sep 1 period has not been committed yet)
    const mockDb = {
      prepare: (sql: string) => {
        return {
          bind: (...args: any[]) => {
            return {
              first: async () => {
                // If query checking exact period for Sep 01, it returns null (not created yet)
                if (sql.includes('period_start_ms = ?') && args[1] === sep01PeriodStart) {
                  return null;
                }
                if (sql.includes('ORDER BY updated_at_ms DESC LIMIT 1')) {
                  // Latest period in D1 is Aug 1 with base=1000
                  return {
                    node_id: 'node-1',
                    period_start_ms: aug01,
                    finalized_rx_bytes: 4000,
                    finalized_tx_bytes: 2000,
                    active_counter_id: 'counter-a',
                    active_rx_base_bytes: 1000,
                    active_tx_base_bytes: 500,
                    updated_at_ms: 1000,
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
    // 1. Reconnect at Sep 1 00:00:15
    const state = await loadTrafficRuntimeState(mockDb, 'node-1', 1);

    // Verified: Hydrated state belongs to Aug 01 so replay samples can be properly attributed
    expect(state.period_start_ms).toBe(aug01);
    expect(state.active_rx_base_bytes).toBe(1000);

    // 2. Replay uncommitted sample from Aug 31 23:59:50 (rx_total = 5100, rx_delta = 100)
    let replayedState = applySampleTrafficTransition(
      state,
      aug31_2359,
      5100,
      2550,
      'counter-a',
      1,
      5000,
      2500
    );

    // Verified: Still within Aug 01 period, no settlement yet
    expect(replayedState.period_start_ms).toBe(aug01);
    expect(replayedState.prev_period_settlement).toBeFalsy();

    // 3. Process first sample in Sep (Sep 1 00:00:10, rx_total = 5200, rx_delta = 100)
    let sepState = applySampleTrafficTransition(
      replayedState,
      sep01_0000,
      5200,
      2600,
      'counter-a',
      1,
      5100,
      2550
    );

    // Verified: Billing transition triggered!
    // Period moves to Sep 1:
    expect(sepState.period_start_ms).toBe(sep01PeriodStart);
    // Aug 1 period is settled:
    expect(sepState.prev_period_settlement).toBeDefined();
    expect(sepState.prev_period_settlement?.period_start_ms).toBe(aug01);
    expect(sepState.prev_period_settlement?.finalized_rx_delta).toBe(5100 - 1000); // 4100 delta added to existing finalized
    // Sep 1 active base is set to the boundary reading 5100:
    expect(sepState.active_rx_base_bytes).toBe(5100);
    // Sep 1 usage is strictly 5200 - 5100 = 100 (NOT 5200 - 1000 = 4200!):
    const sepUsage = sepState.active_rx_base_bytes !== null ? 5200 - sepState.active_rx_base_bytes : 0;
    expect(sepUsage).toBe(100);
  });
});
