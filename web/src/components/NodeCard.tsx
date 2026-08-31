import React from 'react';
import { Link } from 'react-router-dom';
import { NodeItem } from '../api/client';
import { useRealtimeStore } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';
import { OsIcon } from './OsIcon';
import { CountryFlag } from './CountryFlag';
import { formatUptime } from '../utils/time';
import { ProbeHeatmap } from './ProbeHeatmap';

interface NodeCardProps {
  node: NodeItem;
}

const CYCLE_SHORT: Record<string, string> = {
  monthly: 'MO',
  quarterly: 'QTR',
  semi_annually: '6MO',
  annually: 'YR',
  biennially: '2YR',
  triennially: '3YR',
  one_time: 'LIFETIME',
  free: 'FREE',
};

export const NodeCard: React.FC<NodeCardProps> = ({ node }) => {
  const overlay = useRealtimeStore((s) => s.overlays[node.id]);
  const { t } = useTranslation();

  const lastSeenAtMs = overlay?.last_seen_at_ms ?? node.state?.last_seen_at_ms;
  const isOnline = lastSeenAtMs ? Date.now() - lastSeenAtMs < 90 * 1000 : false;

  const cpuUsagePct = overlay?.cpu_usage_pct ?? node.state?.cpu_usage_pct;
  const memoryUsedBytes = overlay?.memory_used_bytes ?? node.state?.memory_used_bytes;
  const rootfsUsedBytes = overlay?.rootfs_used_bytes ?? node.state?.rootfs_used_bytes;
  const rxBps = overlay?.rx_bps ?? node.state?.rx_bps;
  const txBps = overlay?.tx_bps ?? node.state?.tx_bps;
  const edgeRttMs = overlay?.edge_rtt_ms ?? node.state?.edge_rtt_ms;
  const probes = overlay?.probes ?? node.state?.probes ?? [];
  const uptimeSec = overlay?.uptime_sec ?? node.state?.uptime_sec;
  const fin = node.finance;

  const cpuText = !isOnline || cpuUsagePct == null ? 'N/A' : `${cpuUsagePct}%`;
  const cpuBarWidth = !isOnline || cpuUsagePct == null ? 0 : Math.min(100, Math.max(0, cpuUsagePct));

  const limitBytes = node.resources?.memory_limit_bytes;
  const memoryPct = !isOnline || !memoryUsedBytes || !limitBytes || limitBytes === 0
    ? null
    : Number(((memoryUsedBytes / limitBytes) * 100).toFixed(1));

  const memoryText = !isOnline || !memoryUsedBytes
    ? 'N/A'
    : memoryPct !== null && limitBytes && limitBytes > 0
    ? `${memoryPct}% (${formatBytes(memoryUsedBytes)} / ${formatBytes(limitBytes)})`
    : `${formatBytes(memoryUsedBytes)}`;

  const memoryBarWidth = memoryPct !== null
    ? Math.min(100, Math.max(0, memoryPct))
    : 0;

  const mounts = overlay?.mounts ?? node.state?.mounts ?? [];
  let totalDiskLimit = node.resources?.rootfs_limit_bytes;
  let totalDiskUsed = rootfsUsedBytes;

  if (mounts.length > 1) {
    const sumLimit = mounts.reduce((acc, m) => acc + (m.total_bytes || 0), 0);
    const sumUsed = mounts.reduce((acc, m) => acc + (m.used_bytes || 0), 0);
    if (sumLimit > 0) {
      totalDiskLimit = sumLimit;
      totalDiskUsed = sumUsed;
    }
  }

  const diskLimit = totalDiskLimit;
  const diskUsed = totalDiskUsed;
  const diskPct = !isOnline || !diskUsed || !diskLimit || diskLimit === 0
    ? null
    : Number(((diskUsed / diskLimit) * 100).toFixed(1));

  const diskText = !isOnline || !diskUsed
    ? 'N/A'
    : diskPct !== null && diskLimit && diskLimit > 0
    ? `${diskPct}% (${formatBytes(diskUsed)} / ${formatBytes(diskLimit)})`
    : `${formatBytes(diskUsed)}`;

  const diskBarWidth = diskPct !== null
    ? Math.min(100, Math.max(0, diskPct))
    : 0;

  const traffic = node.traffic;
  const trafficUsed = traffic?.period_total_bytes || 0;
  const trafficQuota = traffic?.quota_bytes;
  const trafficBarWidth = trafficQuota && trafficQuota > 0
    ? Math.min(100, Math.round((trafficUsed / trafficQuota) * 100))
    : 0;

  const cpuTemp = overlay?.cpu_temp_celsius ?? node.state?.cpu_temp_celsius;
  const load1 = overlay?.load1 ?? node.state?.load1;
  const tcpEstab = overlay?.tcp_established_count ?? node.state?.tcp_established_count;

  return (
    <div className="node-card">
      <div>
        {/* Single Header */}
        <div className="node-card-header">
          <div className="node-title-group">
            <h3 className="node-name-text" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <CountryFlag countryCode={node.geo?.country} />
              <span>{node.name}</span>
              {fin && fin.price != null && fin.price > 0 && (
                <span className="spacex-chip" style={{ color: '#00e676', borderColor: 'rgba(0, 230, 118, 0.4)' }}>
                  {fin.currency || 'USD'} {fin.price}/{CYCLE_SHORT[fin.billing_cycle || 'monthly'] || fin.billing_cycle}
                </span>
              )}
              {fin && fin.billing_cycle === 'free' && (
                <span className="spacex-chip" style={{ color: 'var(--colors-muted)' }}>
                  FREE
                </span>
              )}
              {node.expires_at_ms && (() => {
                const daysLeft = Math.ceil((node.expires_at_ms - Date.now()) / (1000 * 60 * 60 * 24));
                if (daysLeft < 0) {
                  return <span className="spacex-chip" style={{ backgroundColor: 'rgba(226, 39, 24, 0.2)', color: '#e22718', border: '1px solid #e22718' }}>{t('exp_expired')}</span>;
                } else if (daysLeft <= 3) {
                  return <span className="spacex-chip" style={{ backgroundColor: 'rgba(226, 39, 24, 0.15)', color: '#e22718' }}>{daysLeft === 0 ? t('exp_today') : `${daysLeft}d`}</span>;
                } else if (daysLeft <= 7) {
                  return <span className="spacex-chip" style={{ backgroundColor: 'rgba(244, 180, 0, 0.15)', color: '#f4b400' }}>{daysLeft}d</span>;
                } else {
                  return <span className="spacex-chip">{daysLeft}d</span>;
                }
              })()}
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--colors-on-primary-mute)' }}>
              <OsIcon os={node.system?.os} osVersion={node.system?.os_version} size={13} />
              <span>{node.resources?.cpu_capacity_cores || 1}C</span>
            </span>
            <div className="status-indicator-beacon">
              <span className={`beacon-dot ${isOnline ? 'beacon-live' : 'beacon-idle'}`}></span>
              <span style={{ fontSize: '10px' }}>{isOnline ? t('node_online') : t('node_offline')}</span>
            </div>
          </div>
        </div>

        {/* Telemetry Stack */}
        <div className="telemetry-stack" style={{ marginTop: '16px' }}>
          {/* CPU */}
          <div className="telemetry-row">
            <div className="telemetry-header-row">
              <span style={{ color: 'var(--colors-on-primary-mute)' }}>{t('cpu_usage')}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{cpuText}</span>
                {isOnline && cpuTemp != null && (
                  <span style={{ fontSize: '10px', color: cpuTemp >= 80 ? '#e22718' : cpuTemp >= 60 ? '#f59e0b' : '#00e676' }}>
                    {cpuTemp}°C
                  </span>
                )}
              </span>
            </div>
            <div className="telemetry-bar-track">
              <div className="telemetry-bar-fill" style={{ width: `${cpuBarWidth}%` }}></div>
            </div>
          </div>

          {/* Memory */}
          <div className="telemetry-row">
            <div className="telemetry-header-row">
              <span style={{ color: 'var(--colors-on-primary-mute)' }}>{t('memory_allocation')}</span>
              <span>{memoryText}</span>
            </div>
            <div className="telemetry-bar-track">
              <div className="telemetry-bar-fill" style={{ width: `${memoryBarWidth}%` }}></div>
            </div>
          </div>

          {/* Storage */}
          <div className="telemetry-row">
            <div className="telemetry-header-row">
              <span style={{ color: 'var(--colors-on-primary-mute)' }}>{t('root_storage')}</span>
              <span>{diskText}</span>
            </div>
            <div className="telemetry-bar-track">
              <div className="telemetry-bar-fill" style={{ width: `${diskBarWidth}%` }}></div>
            </div>
          </div>

          {/* Traffic Billing Cycle */}
          {traffic && (
            <div className="telemetry-row">
              <div className="telemetry-header-row">
                <span style={{ color: 'var(--colors-on-primary-mute)' }}>{t('cycle_traffic')} (DAY {traffic.reset_day})</span>
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

          {/* Edge RTT & Probes & Sockets */}
          <div className="tag-chips-row">
            {isOnline && uptimeSec != null && (
              <span className="spacex-chip">
                UP: {formatUptime(uptimeSec)}
              </span>
            )}
            {edgeRttMs && (
              <span className="spacex-chip" style={{ color: '#ffffff', borderColor: '#ffffff' }}>
                CF EDGE · {edgeRttMs} MS
              </span>
            )}
            {isOnline && tcpEstab != null && (
              <span className="spacex-chip" style={{ color: '#38bdf8' }}>
                {tcpEstab} TCP
              </span>
            )}
            {isOnline && load1 != null && (
              <span className="spacex-chip">
                L: {load1}
              </span>
            )}
          </div>

          {/* Three-Net Ping Sparkline Heatmap */}
          {probes && probes.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <ProbeHeatmap nodeId={node.id} currentProbes={probes} compact={true} />
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="node-card-footer">
        <span className="eyebrow-cap" style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <CountryFlag countryCode={node.geo?.country} />
          <span>{node.geo?.city || node.geo?.country || 'COLO'} · {node.geo?.colo || 'EDGE'}</span>
        </span>
        <Link to={`/node/${node.id}`} className="button-ghost-on-dark button-ghost-sm">
          {t('inspect_node')}
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
