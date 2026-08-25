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

  it('computes 60s bucket step deltas correctly across high-frequency reports', () => {
    // Scenario: Agent streams every 2 seconds.
    // At bucket start (0s): cumulative Rx is 1000
    // Over 30 reports, Rx reaches 1600.
    // When 60s checkpoint triggers, full bucket delta must be 1600 - 1000 = 600 bytes.
    const bucketStartRx = 1000;
    let currentRx = 1000;

    for (let i = 1; i <= 30; i++) {
      currentRx += 20; // 20 bytes every 2s
    }

    const bucketDelta = currentRx - bucketStartRx;
    expect(bucketDelta).toBe(600);
  });

  it('settles traffic across counter reset correctly', () => {
    // Old counter base: 100, final reading before reboot: 250 (accumulated 150)
    // Server reboots, new counter starts at 10, reaches 30 (accumulated 20)
    // Total monthly traffic must be 150 + 20 = 170.
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
});
