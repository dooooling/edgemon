import { describe, it, expect } from 'vitest';
import { formatBeijingTimeOnly, formatBeijingAxis } from '../src/utils/time';

describe('Web Time Utilities (24-Hour Beijing Time UTC+8)', () => {
  it('formats timestamp strictly in 24-hour HH:MM:SS Beijing time without AM/PM', () => {
    // 2026-08-30 00:05:09 UTC -> 2026-08-30 08:05:09 Beijing Time (UTC+8)
    const ts1 = Date.UTC(2026, 7, 30, 0, 5, 9);
    expect(formatBeijingTimeOnly(ts1, true)).toBe('08:05:09');

    // 2026-08-30 15:45:30 UTC -> 2026-08-30 23:45:30 Beijing Time (UTC+8)
    const ts2 = Date.UTC(2026, 7, 30, 15, 45, 30);
    expect(formatBeijingTimeOnly(ts2, true)).toBe('23:45:30');

    // 2026-08-30 16:00:00 UTC -> 2026-08-31 00:00:00 Beijing Time (UTC+8)
    const ts3 = Date.UTC(2026, 7, 30, 16, 0, 0);
    expect(formatBeijingTimeOnly(ts3, true)).toBe('00:00:00');
  });

  it('formats chart X-axis ticks according to time range', () => {
    // Unix epoch seconds: 1787640000 -> 2026-08-30 12:00:00 UTC -> 20:00:00 Beijing
    const tsSec = 1787640000;

    // 10m range -> HH:MM:SS
    const axis10m = formatBeijingAxis(tsSec, '10m');
    expect(axis10m).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(axis10m).not.toContain('AM');
    expect(axis10m).not.toContain('PM');

    // 1h / 24h range -> HH:MM
    const axis1h = formatBeijingAxis(tsSec, '1h');
    expect(axis1h).toMatch(/^\d{2}:\d{2}$/);

    // 7d / 30d range -> MM-DD HH:MM
    const axis7d = formatBeijingAxis(tsSec, '7d');
    expect(axis7d).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
