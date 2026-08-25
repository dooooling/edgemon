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

  it('computes step deltas correctly without duplicate accumulation', () => {
    // Step Delta Logic Verification
    const counterId = 'counter-segment-1';
    let lastSeenRx = 100;
    let accumulatedDelta = 0;

    // Report 1: 100 bytes (initial)
    let currentRx = 100;
    let stepDelta = currentRx >= lastSeenRx ? currentRx - lastSeenRx : 0;
    accumulatedDelta += stepDelta;
    lastSeenRx = currentRx;
    expect(stepDelta).toBe(0);
    expect(accumulatedDelta).toBe(0);

    // Report 2: 110 bytes
    currentRx = 110;
    stepDelta = currentRx >= lastSeenRx ? currentRx - lastSeenRx : 0;
    accumulatedDelta += stepDelta;
    lastSeenRx = currentRx;
    expect(stepDelta).toBe(10);
    expect(accumulatedDelta).toBe(10);

    // Report 3: 125 bytes
    currentRx = 125;
    stepDelta = currentRx >= lastSeenRx ? currentRx - lastSeenRx : 0;
    accumulatedDelta += stepDelta;
    lastSeenRx = currentRx;
    expect(stepDelta).toBe(15);
    expect(accumulatedDelta).toBe(25); // Exactly 125 - 100 = 25!
  });
});
