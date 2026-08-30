import { create } from 'zustand';

export interface MountOverlay {
  mount_point: string;
  total_bytes?: number | null;
  used_bytes?: number | null;
  fs_type?: string | null;
}

export interface RealtimeMetricsOverlay {
  last_seen_at_ms: number;
  cpu_usage_pct?: number | null;
  cpu_throttled_pct?: number | null;
  cpu_temp_celsius?: number | null;
  load1?: number | null;
  load5?: number | null;
  load15?: number | null;
  process_total_count?: number | null;
  process_running_count?: number | null;
  memory_used_bytes?: number | null;
  memory_working_set_bytes?: number | null;
  swap_used_bytes?: number | null;
  oom_kill_count?: number | null;
  rootfs_used_bytes?: number | null;
  mounts?: MountOverlay[];
  disk_read_bps?: number | null;
  disk_write_bps?: number | null;
  read_iops?: number | null;
  write_iops?: number | null;
  io_util_pct?: number | null;
  rx_bps?: number | null;
  tx_bps?: number | null;
  rx_total_bytes?: number;
  tx_total_bytes?: number;
  tcp_established_count?: number | null;
  tcp_tw_count?: number | null;
  tcp_total_count?: number | null;
  udp_in_use?: number | null;
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
  cpu_temp_celsius?: number | null;
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
            const receivedAt = data.received_at_ms || data.ts_ms || Date.now();
            const overlay: RealtimeMetricsOverlay = {
              last_seen_at_ms: receivedAt,
              cpu_usage_pct: data.metrics.cpu?.usage_pct,
              cpu_throttled_pct: data.metrics.cpu?.throttled_pct,
              cpu_temp_celsius: data.metrics.cpu?.temp_celsius,
              load1: data.metrics.cpu?.load1,
              load5: data.metrics.cpu?.load5,
              load15: data.metrics.cpu?.load15,
              process_total_count: data.metrics.cpu?.process_total_count,
              process_running_count: data.metrics.cpu?.process_running_count,
              memory_used_bytes: data.metrics.memory?.used_bytes,
              memory_working_set_bytes: data.metrics.memory?.working_set_bytes,
              swap_used_bytes: data.metrics.memory?.swap_used_bytes,
              oom_kill_count: data.metrics.memory?.oom_kill_count,
              rootfs_used_bytes: data.metrics.rootfs?.used_bytes,
              mounts: data.metrics.rootfs?.mounts,
              disk_read_bps: data.metrics.io?.read_bps,
              disk_write_bps: data.metrics.io?.write_bps,
              read_iops: data.metrics.io?.read_iops,
              write_iops: data.metrics.io?.write_iops,
              io_util_pct: data.metrics.io?.io_util_pct,
              rx_bps: data.metrics.network?.rx_bps,
              tx_bps: data.metrics.network?.tx_bps,
              rx_total_bytes: data.metrics.network?.rx_total_bytes,
              tx_total_bytes: data.metrics.network?.tx_total_bytes,
              tcp_established_count: data.metrics.network?.tcp_established_count,
              tcp_tw_count: data.metrics.network?.tcp_tw_count,
              tcp_total_count: data.metrics.network?.tcp_total_count,
              udp_in_use: data.metrics.network?.udp_in_use,
              edge_rtt_ms: data.geo?.edge_rtt_ms,
              edge_transport: data.geo?.edge_transport,
              uptime_sec: data.metrics.uptime_sec,
              probes: data.metrics.probes || [],
            };

            const pointsToInsert: RealtimePoint[] = Array.isArray(data.samples) && data.samples.length > 0
              ? data.samples.map((s: any) => ({
                  ts_ms: s.sampled_at_ms,
                  cpu_usage_pct: s.metrics?.cpu?.usage_pct ?? null,
                  cpu_temp_celsius: s.metrics?.cpu?.temp_celsius ?? null,
                  memory_used_bytes: s.metrics?.memory?.used_bytes ?? null,
                  rx_bps: s.metrics?.network?.rx_bps ?? null,
                  tx_bps: s.metrics?.network?.tx_bps ?? null,
                  edge_rtt_ms: data.geo?.edge_rtt_ms ?? null,
                }))
              : [
                  {
                    ts_ms: receivedAt,
                    cpu_usage_pct: data.metrics.cpu?.usage_pct ?? null,
                    cpu_temp_celsius: data.metrics.cpu?.temp_celsius ?? null,
                    memory_used_bytes: data.metrics.memory?.used_bytes ?? null,
                    rx_bps: data.metrics.network?.rx_bps ?? null,
                    tx_bps: data.metrics.network?.tx_bps ?? null,
                    edge_rtt_ms: data.geo?.edge_rtt_ms ?? null,
                  },
                ];

            set((state) => {
              const now = Date.now();
              const cutoff = now - 10 * 60_000;
              const maxFuture = now + 60_000;
              const existingSeries = state.realtimeSeries[data.node_id] || [];
              const pointMap = new Map<number, RealtimePoint>();
              for (const p of existingSeries) {
                if (p.ts_ms >= cutoff && p.ts_ms <= maxFuture) pointMap.set(p.ts_ms, p);
              }
              for (const p of pointsToInsert) {
                if (p.ts_ms >= cutoff && p.ts_ms <= maxFuture) pointMap.set(p.ts_ms, p);
              }
              const nextSeries = Array.from(pointMap.values())
                .sort((a, b) => a.ts_ms - b.ts_ms)
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
