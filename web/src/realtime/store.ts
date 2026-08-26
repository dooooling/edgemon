import { create } from 'zustand';

export interface RealtimeMetricsOverlay {
  last_seen_at_ms: number;
  cpu_usage_pct?: number | null;
  cpu_throttled_pct?: number | null;
  memory_used_bytes?: number | null;
  memory_working_set_bytes?: number | null;
  swap_used_bytes?: number | null;
  rootfs_used_bytes?: number | null;
  disk_read_bps?: number | null;
  disk_write_bps?: number | null;
  rx_bps?: number | null;
  tx_bps?: number | null;
  rx_total_bytes?: number;
  tx_total_bytes?: number;
  edge_rtt_ms?: number | null;
  edge_transport?: string | null;
  uptime_sec?: number | null;
  probes?: Array<{
    id: string;
    status: string;
    latency_ms?: number | null;
    loss_ratio: number;
  }>;
}

export interface RealtimePoint {
  ts_ms: number;
  cpu_usage_pct: number | null;
  memory_used_bytes: number | null;
  rx_bps: number | null;
  tx_bps: number | null;
  edge_rtt_ms: number | null;
}

interface RealtimeState {
  overlays: Record<string, RealtimeMetricsOverlay>;
  realtimeSeries: Record<string, RealtimePoint[]>;
  wsConnected: boolean;
  activeScope: string;
  activeNodeId: string | null;
  connectRealtime: (scope?: string, nodeId?: string) => void;
  disconnectRealtime: () => void;
  clearOverlay: (nodeId: string) => void;
}

let activeSocket: WebSocket | null = null;

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  overlays: {},
  realtimeSeries: {},
  wsConnected: false,
  activeScope: 'overview',
  activeNodeId: null,

  connectRealtime: (scope = 'overview', nodeId) => {
    const targetNodeId = nodeId || null;
    const currentState = get();

    if (
      activeSocket &&
      (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING) &&
      currentState.activeScope === scope &&
      currentState.activeNodeId === targetNodeId
    ) {
      return;
    }

    if (activeSocket) {
      activeSocket.close();
      activeSocket = null;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = scope === 'node' && targetNodeId ? `scope=node&id=${targetNodeId}` : 'scope=overview';
    const wsUrl = `${proto}//${window.location.host}/api/realtime?${query}`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        set({ wsConnected: true, activeScope: scope, activeNodeId: targetNodeId });
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.node_id && data.metrics) {
            const ts = data.ts_ms || Date.now();
            const overlay: RealtimeMetricsOverlay = {
              last_seen_at_ms: ts,
              cpu_usage_pct: data.metrics.cpu?.usage_pct,
              cpu_throttled_pct: data.metrics.cpu?.throttled_pct,
              memory_used_bytes: data.metrics.memory?.used_bytes,
              memory_working_set_bytes: data.metrics.memory?.working_set_bytes,
              swap_used_bytes: data.metrics.memory?.swap_used_bytes,
              rootfs_used_bytes: data.metrics.rootfs?.used_bytes,
              disk_read_bps: data.metrics.io?.read_bps,
              disk_write_bps: data.metrics.io?.write_bps,
              rx_bps: data.metrics.network?.rx_bps,
              tx_bps: data.metrics.network?.tx_bps,
              rx_total_bytes: data.metrics.network?.rx_total_bytes,
              tx_total_bytes: data.metrics.network?.tx_total_bytes,
              edge_rtt_ms: data.geo?.edge_rtt_ms,
              edge_transport: data.geo?.edge_transport,
              uptime_sec: data.metrics.uptime_sec,
              probes: data.metrics.probes || [],
            };

            const point: RealtimePoint = {
              ts_ms: ts,
              cpu_usage_pct: data.metrics.cpu?.usage_pct ?? null,
              memory_used_bytes: data.metrics.memory?.used_bytes ?? null,
              rx_bps: data.metrics.network?.rx_bps ?? null,
              tx_bps: data.metrics.network?.tx_bps ?? null,
              edge_rtt_ms: data.geo?.edge_rtt_ms ?? null,
            };

            set((state) => {
              const cutoff = Date.now() - 10 * 60_000;
              const existingSeries = state.realtimeSeries[data.node_id] || [];
              const nextSeries = [...existingSeries, point]
                .filter((p) => p.ts_ms >= cutoff)
                .slice(-300);

              return {
                overlays: {
                  ...state.overlays,
                  [data.node_id]: overlay,
                },
                realtimeSeries: {
                  ...state.realtimeSeries,
                  [data.node_id]: nextSeries,
                },
              };
            });
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        set({ wsConnected: false });
      };

      activeSocket = ws;
    } catch {
      set({ wsConnected: false });
    }
  },

  disconnectRealtime: () => {
    if (activeSocket) {
      activeSocket.close();
      activeSocket = null;
    }
    set({ wsConnected: false, activeScope: 'none', activeNodeId: null });
  },

  clearOverlay: (nodeId: string) => {
    set((state) => {
      const nextOverlays = { ...state.overlays };
      delete nextOverlays[nodeId];
      const nextSeries = { ...state.realtimeSeries };
      delete nextSeries[nodeId];
      return { overlays: nextOverlays, realtimeSeries: nextSeries };
    });
  },
}));
