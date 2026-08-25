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
});
