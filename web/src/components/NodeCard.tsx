import React from 'react';
import { Link } from 'react-router-dom';
import { NodeItem } from '../api/client';
import { useRealtimeStore } from '../realtime/store';

interface NodeCardProps {
  node: NodeItem;
}

export const NodeCard: React.FC<NodeCardProps> = ({ node }) => {
  const overlay = useRealtimeStore((s) => s.overlays[node.id]);

  const lastSeenAtMs = overlay?.last_seen_at_ms ?? node.state?.last_seen_at_ms;
  const isOnline = lastSeenAtMs ? Date.now() - lastSeenAtMs < 90 * 1000 : false;

  const cpuUsagePct = overlay?.cpu_usage_pct ?? node.state?.cpu_usage_pct;
  const memoryUsedBytes = overlay?.memory_used_bytes ?? node.state?.memory_used_bytes;
  const rootfsUsedBytes = overlay?.rootfs_used_bytes ?? node.state?.rootfs_used_bytes;
  const rxBps = overlay?.rx_bps ?? node.state?.rx_bps;
  const txBps = overlay?.tx_bps ?? node.state?.tx_bps;
  const edgeRttMs = overlay?.edge_rtt_ms ?? node.state?.edge_rtt_ms;
  const probes = overlay?.probes ?? node.state?.probes ?? [];

  const cpuText = !isOnline || cpuUsagePct == null ? 'N/A' : `${cpuUsagePct}%`;
  const cpuBarWidth = !isOnline || cpuUsagePct == null ? 0 : Math.min(100, Math.max(0, cpuUsagePct));

  const limitBytes = node.resources?.memory_limit_bytes;
  const memoryText = !isOnline || !memoryUsedBytes
    ? 'N/A'
    : limitBytes && limitBytes > 0
    ? `${Math.round(memoryUsedBytes / (1024 * 1024))} / ${Math.round(limitBytes / (1024 * 1024))} MB`
    : `${Math.round(memoryUsedBytes / (1024 * 1024))} MB`;

  const memoryBarWidth = !isOnline || !memoryUsedBytes || !limitBytes || limitBytes === 0
    ? 0
    : Math.min(100, Math.round((memoryUsedBytes / limitBytes) * 100));

  const rootfsLimitBytes = node.resources?.rootfs_limit_bytes;
  const diskText = !isOnline
    ? 'N/A'
    : !rootfsLimitBytes || rootfsLimitBytes === 0
    ? 'N/A (CONTAINER)'
    : rootfsUsedBytes
    ? `${(rootfsUsedBytes / (1024 * 1024 * 1024)).toFixed(1)} / ${(rootfsLimitBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${(rootfsLimitBytes / (1024 * 1024 * 1024)).toFixed(1)} GB TOTAL`;

  const traffic = node.traffic;
  const trafficUsed = traffic?.period_total_bytes || 0;
  const trafficQuota = traffic?.quota_bytes;
  const trafficBarWidth = trafficQuota && trafficQuota > 0
    ? Math.min(100, Math.round((trafficUsed / trafficQuota) * 100))
    : 0;

  return (
    <div className="node-card-tile">
      <div>
        {/* Header */}
        <div className="node-card-header">
          <div className="node-title-group">
            <span className="eyebrow-cap">
              {(node.environment?.type || 'INSTANCE').toUpperCase()} // {node.resources?.cpu_capacity_cores || 1} CORES
            </span>
            <h3 className="node-name-text">{node.name}</h3>
          </div>

          <div className="status-indicator-beacon">
            <span className={`beacon-dot ${isOnline ? 'beacon-live' : 'beacon-idle'}`}></span>
            <span style={{ fontSize: '10px' }}>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
        </div>

        {/* Telemetry Stack */}
        <div className="telemetry-stack" style={{ marginTop: '16px' }}>
          {/* CPU */}
          <div className="telemetry-row">
            <div className="telemetry-header-row">
              <span style={{ color: 'var(--colors-on-primary-mute)' }}>CPU CORE USAGE</span>
              <span>{cpuText}</span>
            </div>
            <div className="telemetry-bar-track">
              <div className="telemetry-bar-fill" style={{ width: `${cpuBarWidth}%` }}></div>
            </div>
          </div>

          {/* Memory */}
          <div className="telemetry-row">
            <div className="telemetry-header-row">
              <span style={{ color: 'var(--colors-on-primary-mute)' }}>MEMORY ALLOCATION</span>
              <span>{memoryText}</span>
            </div>
            <div className="telemetry-bar-track">
              <div className="telemetry-bar-fill" style={{ width: `${memoryBarWidth}%` }}></div>
            </div>
          </div>

          {/* Storage */}
          <div className="telemetry-row">
            <div className="telemetry-header-row">
              <span style={{ color: 'var(--colors-on-primary-mute)' }}>ROOT STORAGE</span>
              <span>{diskText}</span>
            </div>
          </div>

          {/* Traffic Billing Cycle */}
          {traffic && (
            <div className="telemetry-row">
              <div className="telemetry-header-row">
                <span style={{ color: 'var(--colors-on-primary-mute)' }}>CYCLE TRAFFIC (DAY {traffic.reset_day})</span>
                <span>
                  {formatBytes(trafficUsed)}
                  {trafficQuota ? ` / ${formatBytes(trafficQuota)}` : ''}
                </span>
              </div>
              {trafficQuota ? (
                <div className="telemetry-bar-track">
                  <div className="telemetry-bar-fill" style={{ width: `${trafficBarWidth}%` }}></div>
                </div>
              ) : null}
            </div>
          )}

          {/* Network Throughput */}
          <div className="traffic-rates-block">
            <span>↓ {formatBps(rxBps)}</span>
            <span>↑ {formatBps(txBps)}</span>
          </div>

          {/* Edge RTT & Probes */}
          {(edgeRttMs || probes.length > 0) && (
            <div className="tag-chips-row">
              {edgeRttMs && (
                <span className="spacex-chip" style={{ color: '#ffffff', borderColor: '#ffffff' }}>
                  CF EDGE · {edgeRttMs} MS
                </span>
              )}
              {probes.slice(0, 2).map((p) => (
                <span key={p.id} className="spacex-chip">
                  {p.id}: {p.latency_ms != null ? `${p.latency_ms}MS` : 'ERR'}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="node-card-footer">
        <span className="eyebrow-cap" style={{ fontSize: '11px' }}>
          {node.geo?.city || node.geo?.country || 'COLO'} · {node.geo?.colo || 'EDGE'}
        </span>
        <Link to={`/node/${node.id}`} className="button-ghost-on-dark button-ghost-sm">
          INSPECT NODE ➔
        </Link>
      </div>
    </div>
  );
};

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2) + ' TB';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function formatBps(bps?: number | null): string {
  if (!bps || bps === 0) return '0 B/S';
  if (bps >= 1024 * 1024) return (bps / (1024 * 1024)).toFixed(1) + ' MB/S';
  if (bps >= 1024) return (bps / 1024).toFixed(0) + ' KB/S';
  return bps + ' B/S';
}
