import { describe, it, expect, beforeEach } from 'vitest';
import { useRealtimeStore, RealtimePoint } from '../src/realtime/store';

describe('Realtime Store (Zustand) Point Merging and Overlays', () => {
  beforeEach(() => {
    useRealtimeStore.setState({
      overlays: {},
      realtimeSeries: {},
      wsConnected: false,
      activeScope: 'overview',
      activeNodeId: null,
    });
  });

  it('initializes with clean empty state and disconnected status', () => {
    const state = useRealtimeStore.getState();
    expect(state.wsConnected).toBe(false);
    expect(state.overlays).toEqual({});
    expect(state.realtimeSeries).toEqual({});
  });

  it('merges deduplicated time series points within 10-minute sliding window', () => {
    const now = Date.now();
    const nodeId = 'test-node-1';

    // Simulate incoming WebSocket message parsing
    const p1: RealtimePoint = {
      ts_ms: now - 60_000,
      cpu_usage_pct: 25.5,
      cpu_temp_celsius: 45.0,
      memory_used_bytes: 1024 * 1024 * 512,
      rx_bps: 1000,
      tx_bps: 2000,
      edge_rtt_ms: 12.0,
    };

    const p2: RealtimePoint = {
      ts_ms: now - 30_000,
      cpu_usage_pct: 35.0,
      cpu_temp_celsius: 47.2,
      memory_used_bytes: 1024 * 1024 * 520,
      rx_bps: 1500,
      tx_bps: 2500,
      edge_rtt_ms: 11.5,
    };

    // Stale point beyond 10-minute cutoff
    const pStale: RealtimePoint = {
      ts_ms: now - 11 * 60_000,
      cpu_usage_pct: 99.0,
      cpu_temp_celsius: 80.0,
      memory_used_bytes: 1024 * 1024 * 900,
      rx_bps: 9999,
      tx_bps: 9999,
      edge_rtt_ms: 100.0,
    };

    const cutoff = now - 10 * 60_000;
    const maxFuture = now + 60_000;

    const rawPoints = [p1, pStale, p2, p1]; // includes duplicate p1 and stale point
    const pointMap = new Map<number, RealtimePoint>();
    for (const p of rawPoints) {
      if (p.ts_ms >= cutoff && p.ts_ms <= maxFuture) {
        pointMap.set(p.ts_ms, p);
      }
    }

    const merged = Array.from(pointMap.values()).sort((a, b) => a.ts_ms - b.ts_ms);

    expect(merged.length).toBe(2);
    expect(merged[0].ts_ms).toBe(p1.ts_ms);
    expect(merged[1].ts_ms).toBe(p2.ts_ms);
    expect(merged[0].cpu_usage_pct).toBe(25.5);
    expect(merged[1].cpu_temp_celsius).toBe(47.2);
  });

  it('clears overlay when node disconnects or clearOverlay is invoked', () => {
    const nodeId = 'node-to-clear';
    useRealtimeStore.setState({
      overlays: {
        [nodeId]: {
          last_seen_at_ms: Date.now(),
          cpu_usage_pct: 50.0,
        },
      },
      realtimeSeries: {
        [nodeId]: [
          {
            ts_ms: Date.now(),
            cpu_usage_pct: 50.0,
            memory_used_bytes: 1000,
            rx_bps: 100,
            tx_bps: 100,
            edge_rtt_ms: 10,
          },
        ],
      },
    });

    expect(useRealtimeStore.getState().overlays[nodeId]).toBeDefined();

    useRealtimeStore.getState().clearOverlay(nodeId);

    expect(useRealtimeStore.getState().overlays[nodeId]).toBeUndefined();
    expect(useRealtimeStore.getState().realtimeSeries[nodeId]).toBeUndefined();
  });
});
