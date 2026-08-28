import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { NodeItem } from '../api/client';
import { useRealtimeStore } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';
import { CountryFlag } from './CountryFlag';
import { OsIcon } from './OsIcon';

interface NodeTableProps {
  nodes: NodeItem[];
}

type SortField = 'status' | 'name' | 'cpu' | 'ram' | 'disk' | 'net' | 'traffic' | 'rtt' | 'expire';
type SortOrder = 'asc' | 'desc';

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2) + ' TB';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function formatBps(bps?: number | null): string {
  if (!bps || bps <= 0) return '0 B/s';
  if (bps >= 1024 * 1024) return (bps / (1024 * 1024)).toFixed(1) + ' MB/s';
  if (bps >= 1024) return (bps / 1024).toFixed(0) + ' KB/s';
  return bps.toFixed(0) + ' B/s';
}

export const NodeTable: React.FC<NodeTableProps> = ({ nodes }) => {
  const navigate = useNavigate();
  const overlays = useRealtimeStore((s) => s.overlays);
  const { t } = useTranslation();

  const [sortField, setSortField] = useState<SortField>('status');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const now = Date.now();
  const onlineCutoffMs = 90 * 1000;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => {
      const aOverlay = overlays[a.id];
      const bOverlay = overlays[b.id];

      const aLastSeen = aOverlay?.last_seen_at_ms ?? a.state?.last_seen_at_ms;
      const bLastSeen = bOverlay?.last_seen_at_ms ?? b.state?.last_seen_at_ms;
      const aOnline = aLastSeen ? now - aLastSeen < onlineCutoffMs : false;
      const bOnline = bLastSeen ? now - bLastSeen < onlineCutoffMs : false;

      let aVal: number | string = 0;
      let bVal: number | string = 0;

      switch (sortField) {
        case 'status':
          aVal = aOnline ? 1 : 0;
          bVal = bOnline ? 1 : 0;
          break;
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'cpu':
          aVal = aOnline ? (aOverlay?.cpu_usage_pct ?? a.state?.cpu_usage_pct ?? 0) : -1;
          bVal = bOnline ? (bOverlay?.cpu_usage_pct ?? b.state?.cpu_usage_pct ?? 0) : -1;
          break;
        case 'ram': {
          const aLimit = a.resources?.memory_limit_bytes || 1;
          const bLimit = b.resources?.memory_limit_bytes || 1;
          const aUsed = aOverlay?.memory_used_bytes ?? a.state?.memory_used_bytes ?? 0;
          const bUsed = bOverlay?.memory_used_bytes ?? b.state?.memory_used_bytes ?? 0;
          aVal = aOnline ? aUsed / aLimit : -1;
          bVal = bOnline ? bUsed / bLimit : -1;
          break;
        }
        case 'disk': {
          const aLimit = a.resources?.rootfs_limit_bytes || 1;
          const bLimit = b.resources?.rootfs_limit_bytes || 1;
          const aUsed = aOverlay?.rootfs_used_bytes ?? a.state?.rootfs_used_bytes ?? 0;
          const bUsed = bOverlay?.rootfs_used_bytes ?? b.state?.rootfs_used_bytes ?? 0;
          aVal = aOnline && a.resources?.rootfs_limit_bytes ? aUsed / aLimit : -1;
          bVal = bOnline && b.resources?.rootfs_limit_bytes ? bUsed / bLimit : -1;
          break;
        }
        case 'net': {
          const aSpeed = (aOverlay?.rx_bps ?? a.state?.rx_bps ?? 0) + (aOverlay?.tx_bps ?? a.state?.tx_bps ?? 0);
          const bSpeed = (bOverlay?.rx_bps ?? b.state?.rx_bps ?? 0) + (bOverlay?.tx_bps ?? b.state?.tx_bps ?? 0);
          aVal = aOnline ? aSpeed : -1;
          bVal = bOnline ? bSpeed : -1;
          break;
        }
        case 'traffic':
          aVal = a.traffic?.period_total_bytes || 0;
          bVal = b.traffic?.period_total_bytes || 0;
          break;
        case 'rtt':
          aVal = aOnline ? (aOverlay?.edge_rtt_ms ?? a.state?.edge_rtt_ms ?? 9999) : 99999;
          bVal = bOnline ? (bOverlay?.edge_rtt_ms ?? b.state?.edge_rtt_ms ?? 9999) : 99999;
          break;
        case 'expire':
          aVal = a.expires_at_ms || 9999999999999;
          bVal = b.expires_at_ms || 9999999999999;
          break;
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [nodes, overlays, sortField, sortOrder, now]);

  return (
    <div style={{ width: '100%', overflowX: 'auto', backgroundColor: 'var(--colors-surface-card)', border: '1px solid var(--colors-hairline)' }}>
      <table className="spacex-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
            <th onClick={() => handleSort('status')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t('th_status')} {sortField === 'status' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th onClick={() => handleSort('name')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t('th_node')} {sortField === 'name' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th onClick={() => handleSort('cpu')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t('th_cpu')} {sortField === 'cpu' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th onClick={() => handleSort('ram')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t('th_ram')} {sortField === 'ram' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th onClick={() => handleSort('disk')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t('th_disk')} {sortField === 'disk' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th onClick={() => handleSort('net')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t('th_net')} {sortField === 'net' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th onClick={() => handleSort('traffic')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t('th_traffic')} {sortField === 'traffic' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th onClick={() => handleSort('rtt')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {t('th_rtt')} {sortField === 'rtt' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {t('th_actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedNodes.map((node) => {
            const overlay = overlays[node.id];
            const lastSeen = overlay?.last_seen_at_ms ?? node.state?.last_seen_at_ms;
            const isOnline = lastSeen ? now - lastSeen < onlineCutoffMs : false;

            const cpuPct = overlay?.cpu_usage_pct ?? node.state?.cpu_usage_pct;
            const cpuCores = node.resources?.cpu_capacity_cores || 1;
            const cpuBarWidth = isOnline && cpuPct != null ? Math.min(100, Math.max(0, cpuPct)) : 0;

            const memUsed = overlay?.memory_used_bytes ?? node.state?.memory_used_bytes;
            const memLimit = node.resources?.memory_limit_bytes;
            const memPct = isOnline && memUsed && memLimit && memLimit > 0 ? (memUsed / memLimit) * 100 : null;
            const memBarWidth = memPct != null ? Math.min(100, Math.max(0, memPct)) : 0;

            const rootfsUsed = overlay?.rootfs_used_bytes ?? node.state?.rootfs_used_bytes;
            const rootfsLimit = node.resources?.rootfs_limit_bytes;

            const rxBps = overlay?.rx_bps ?? node.state?.rx_bps;
            const txBps = overlay?.tx_bps ?? node.state?.tx_bps;

            const traffic = node.traffic;
            const trafficUsed = traffic?.period_total_bytes || 0;
            const trafficQuota = traffic?.quota_bytes;
            const trafficBarWidth = trafficQuota && trafficQuota > 0 ? Math.min(100, Math.round((trafficUsed / trafficQuota) * 100)) : 0;

            const rttMs = overlay?.edge_rtt_ms ?? node.state?.edge_rtt_ms;

            // Expiration calculation
            let expBadge: React.ReactNode = null;
            if (node.expires_at_ms) {
              const daysLeft = Math.ceil((node.expires_at_ms - now) / (1000 * 60 * 60 * 24));
              if (daysLeft < 0) {
                expBadge = <span className="spacex-chip" style={{ backgroundColor: 'rgba(226, 39, 24, 0.2)', color: '#e22718', border: '1px solid #e22718' }}>{t('exp_expired')}</span>;
              } else if (daysLeft <= 3) {
                expBadge = <span className="spacex-chip" style={{ backgroundColor: 'rgba(226, 39, 24, 0.15)', color: '#e22718' }}>{daysLeft === 0 ? t('exp_today') : `${daysLeft}d`}</span>;
              } else if (daysLeft <= 7) {
                expBadge = <span className="spacex-chip" style={{ backgroundColor: 'rgba(244, 180, 0, 0.15)', color: '#f4b400' }}>{daysLeft}d</span>;
              } else {
                expBadge = <span className="spacex-chip">{daysLeft}d</span>;
              }
            }

            return (
              <tr
                key={node.id}
                style={{
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
                onDoubleClick={() => navigate(`/node/${node.id}`)}
                className="table-row-hover"
              >
                {/* Status */}
                <td>
                  <div className="status-indicator-beacon">
                    <span className={`beacon-dot ${isOnline ? 'beacon-live' : 'beacon-idle'}`}></span>
                    <span style={{ fontSize: '11px' }}>{isOnline ? t('node_online') : t('node_offline')}</span>
                  </div>
                </td>

                {/* Node & System */}
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CountryFlag countryCode={node.geo?.country} />
                    <div>
                      <div style={{ fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{node.name}</span>
                        {expBadge}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--colors-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <OsIcon os={node.system?.os} osVersion={node.system?.os_version} size={11} />
                        <span>{node.system?.os_version || node.environment?.type || 'LINUX'} · {cpuCores}C</span>
                      </div>
                    </div>
                  </div>
                </td>

                {/* CPU */}
                <td style={{ minWidth: '120px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600 }}>
                    <span>{isOnline && cpuPct != null ? `${cpuPct}%` : 'N/A'}</span>
                  </div>
                  <div className="telemetry-bar-track" style={{ height: '3px', marginTop: '4px' }}>
                    <div className="telemetry-bar-fill" style={{ width: `${cpuBarWidth}%` }}></div>
                  </div>
                </td>

                {/* RAM */}
                <td style={{ minWidth: '140px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600 }}>
                    <span>{isOnline && memPct != null ? `${memPct.toFixed(0)}%` : 'N/A'}</span>
                    <span style={{ fontSize: '10px', color: 'var(--colors-muted)', fontWeight: 400 }}>
                      {isOnline && memUsed ? formatBytes(memUsed) : ''}
                    </span>
                  </div>
                  <div className="telemetry-bar-track" style={{ height: '3px', marginTop: '4px' }}>
                    <div className="telemetry-bar-fill" style={{ width: `${memBarWidth}%` }}></div>
                  </div>
                </td>

                {/* Disk */}
                <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                  {isOnline ? (
                    rootfsLimit && rootfsLimit > 0 ? (
                      <div>
                        <span>{rootfsUsed ? formatBytes(rootfsUsed) : '0 B'}</span>
                        <span style={{ color: 'var(--colors-muted)', fontSize: '11px' }}> / {formatBytes(rootfsLimit)}</span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--colors-muted)', fontSize: '11px' }}>{t('container_na')}</span>
                    )
                  ) : (
                    'N/A'
                  )}
                </td>

                {/* Net Speed */}
                <td style={{ whiteSpace: 'nowrap', fontSize: '11px', fontWeight: 600 }}>
                  {isOnline && (rxBps != null || txBps != null) ? (
                    <div>
                      <span style={{ color: 'var(--colors-status-live)' }}>↓ {formatBps(rxBps)}</span>
                      <br />
                      <span style={{ color: 'var(--colors-body-strong)' }}>↑ {formatBps(txBps)}</span>
                    </div>
                  ) : (
                    '0 B/s'
                  )}
                </td>

                {/* Traffic */}
                <td style={{ minWidth: '130px' }}>
                  <div style={{ fontSize: '11px' }}>
                    <span style={{ fontWeight: 600 }}>{formatBytes(trafficUsed)}</span>
                    {trafficQuota && trafficQuota > 0 ? (
                      <span style={{ color: 'var(--colors-muted)' }}> / {formatBytes(trafficQuota)}</span>
                    ) : null}
                  </div>
                  {trafficQuota && trafficQuota > 0 ? (
                    <div className="telemetry-bar-track" style={{ height: '3px', marginTop: '4px' }}>
                      <div className="telemetry-bar-fill" style={{ width: `${trafficBarWidth}%` }}></div>
                    </div>
                  ) : null}
                </td>

                {/* RTT & Colo */}
                <td style={{ whiteSpace: 'nowrap', fontSize: '11px' }}>
                  {isOnline ? (
                    <div>
                      <span style={{ fontWeight: 700, color: rttMs ? 'var(--colors-status-live)' : 'inherit' }}>
                        {rttMs ? `${rttMs} ms` : 'N/A'}
                      </span>
                      <span style={{ color: 'var(--colors-muted)', marginLeft: '4px' }}>
                        ({node.geo?.colo || 'CF'})
                      </span>
                    </div>
                  ) : (
                    'N/A'
                  )}
                </td>

                {/* Actions */}
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="button-ghost-on-dark button-ghost-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/node/${node.id}`);
                    }}
                    style={{ padding: '4px 10px', fontSize: '11px' }}
                  >
                    {t('inspect_node')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
