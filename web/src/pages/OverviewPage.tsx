import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePublicNodesQuery } from '../queries/nodes';
import { useRealtimeStore } from '../realtime/store';
import { WorldMap } from '../components/WorldMap';
import { NodeCard } from '../components/NodeCard';
import { NodeTable } from '../components/NodeTable';
import { useTranslation } from '../i18n/I18nContext';

export const OverviewPage: React.FC = () => {
  const { data, isLoading, isFetching, refetch } = usePublicNodesQuery();
  const connectRealtime = useRealtimeStore((s) => s.connectRealtime);
  const overlays = useRealtimeStore((s) => s.overlays);
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'grid' | 'table' | 'map'>('grid');

  useEffect(() => {
    connectRealtime('overview');
  }, [connectRealtime]);

  const nodes = data?.nodes || [];
  const now = Date.now();
  const onlineCutoffMs = 90 * 1000;

  const onlineNodes = nodes.filter((n) => {
    const lastSeen = overlays[n.id]?.last_seen_at_ms ?? n.state?.last_seen_at_ms;
    return lastSeen ? now - lastSeen < onlineCutoffMs : false;
  });

  const offlineCount = nodes.length - onlineNodes.length;

  const totalRxBps = onlineNodes.reduce((acc, n) => {
    return acc + (overlays[n.id]?.rx_bps ?? n.state?.rx_bps ?? 0);
  }, 0);

  const totalTxBps = onlineNodes.reduce((acc, n) => {
    return acc + (overlays[n.id]?.tx_bps ?? n.state?.tx_bps ?? 0);
  }, 0);

  return (
    <div className="page-container">
      {/* 1. Mission Statistics Grid */}
      <div className="mission-stats-grid">
        <div className="stat-tile">
          <span className="eyebrow-cap">{t('stat_total_nodes')}</span>
          <div className="stat-val-large">{nodes.length}</div>
        </div>
        <div className="stat-tile">
          <span className="eyebrow-cap">{t('stat_active_beacons')}</span>
          <div className="stat-val-large stat-val-live">{onlineNodes.length}</div>
        </div>
        <div className="stat-tile">
          <span className="eyebrow-cap">{t('stat_offline')}</span>
          <div className={`stat-val-large ${offlineCount > 0 ? 'stat-val-alert' : ''}`}>
            {offlineCount}
          </div>
        </div>
        <div className="stat-tile">
          <span className="eyebrow-cap">{t('stat_rx_rate')} / {t('stat_tx_rate')}</span>
          <div className="stat-val-large" style={{ fontSize: '22px' }}>
            ↓ {formatBps(totalRxBps)} · ↑ {formatBps(totalTxBps)}
          </div>
        </div>
      </div>

      {/* 2. Fleet Nodes Section with 3-Mode Selector (Grid / Table / 3D Map) */}
      <div className="section-title-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 className="display-lg" style={{ fontSize: '20px' }}>
            {t('registered_instances')}
          </h2>
          <span className="spacex-chip" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
            {nodes.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* 3-Tab View Mode Toggle: 卡片矩阵 / 紧凑表格 / 3D 视图 */}
          <div className="range-capsules">
            <button
              className={`range-capsule-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              {t('view_grid')}
            </button>
            <button
              className={`range-capsule-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              {t('view_table')}
            </button>
            <button
              className={`range-capsule-btn ${viewMode === 'map' ? 'active' : ''}`}
              onClick={() => setViewMode('map')}
            >
              {t('view_map')}
            </button>
          </div>

          {/* Pure Icon Refresh Button with Spin Animation */}
          <button
            className="button-ghost-on-dark button-ghost-sm"
            onClick={() => refetch()}
            title={t('refresh_fleet')}
            aria-label={t('refresh_fleet')}
            style={{
              width: '32px',
              height: '32px',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: isFetching ? 'rotate(360deg)' : 'none',
              }}
            >
              <path d="M21.5 2v6h-6M2.5 22v-6h6" />
              <path d="M21.5 15.5A9 9 0 0 1 6 18.5L2.5 16M2.5 8.5A9 9 0 0 1 18 5.5L21.5 8" />
            </svg>
          </button>
        </div>
      </div>

      {isLoading && nodes.length === 0 ? (
        <div className="node-card-tile" style={{ textAlign: 'center', padding: '60px' }}>
          <span className="eyebrow-cap">{t('connecting_pipeline')}</span>
        </div>
      ) : nodes.length === 0 ? (
        <div className="node-card-tile" style={{ textAlign: 'center', padding: '60px', gap: '20px' }}>
          <h3 className="display-lg" style={{ fontSize: '24px' }}>{t('no_instances')}</h3>
          <p className="caption">{t('deploy_notice')}</p>
          <div>
            <Link to="/admin" className="button-ghost-on-dark">
              {t('open_console')}
            </Link>
          </div>
        </div>
      ) : viewMode === 'map' ? (
        <WorldMap nodes={nodes} />
      ) : viewMode === 'table' ? (
        <NodeTable nodes={nodes} />
      ) : (
        <div className="nodes-grid">
          {nodes.map((node) => (
            <NodeCard key={node.id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
};

function formatBps(bps: number): string {
  if (!bps || bps === 0) return '0 B/S';
  if (bps >= 1024 * 1024 * 1024) return (bps / (1024 * 1024 * 1024)).toFixed(2) + ' GB/S';
  if (bps >= 1024 * 1024) return (bps / (1024 * 1024)).toFixed(1) + ' MB/S';
  if (bps >= 1024) return (bps / 1024).toFixed(0) + ' KB/S';
  return bps + ' B/S';
}
