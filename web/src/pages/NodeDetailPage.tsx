import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { usePublicNodesQuery } from '../queries/nodes';
import { useRealtimeStore } from '../realtime/store';
import { HistoryChart } from '../components/HistoryChart';
import { useTranslation } from '../i18n/I18nContext';

export const NodeDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = React.useState('24h');
  const { data, isLoading } = usePublicNodesQuery();
  const connectRealtime = useRealtimeStore((s) => s.connectRealtime);
  const clearOverlay = useRealtimeStore((s) => s.clearOverlay);
  const overlay = useRealtimeStore((s) => (id ? s.overlays[id] : undefined));
  const { t } = useTranslation();

  useEffect(() => {
    if (id) {
      connectRealtime('node', id);
    }
    return () => {
      if (id) {
        clearOverlay(id);
      }
    };
  }, [id, connectRealtime, clearOverlay]);

  const node = (data?.nodes || []).find((n) => n.id === id);

  if (isLoading && !node) {
    return (
      <div className="page-container">
        <div className="detail-chassis-band" style={{ textAlign: 'center', padding: '60px' }}>
          <span className="eyebrow-cap">{t('chart_loading')}</span>
        </div>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="page-container">
        <div className="detail-chassis-band" style={{ textAlign: 'center', padding: '60px', gap: '16px' }}>
          <h2 className="display-lg">NODE IDENTIFIER NOT FOUND</h2>
          <p className="caption" style={{ margin: '12px 0 24px' }}>
            The specified node UUID does not exist or has been decommissioned.
          </p>
          <div>
            <Link to="/" className="button-ghost-on-dark">
              {t('back_to_fleet')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const lastSeen = overlay?.last_seen_at_ms ?? node.state?.last_seen_at_ms;
  const isOnline = lastSeen ? Date.now() - lastSeen < 90 * 1000 : false;
  const probes = overlay?.probes ?? node.state?.probes ?? [];

  return (
    <div className="page-container">
      {/* Top Navigation Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Link to="/" className="button-ghost-on-dark button-ghost-sm">
          {t('back_to_fleet')}
        </Link>
        <div className="status-indicator-beacon" style={{ border: '1px solid var(--colors-hairline-on-dark)', padding: '6px 14px', borderRadius: '32px' }}>
          <span className="beacon-dot beacon-live"></span>
          <span>{t('live_stream_badge')}</span>
        </div>
      </div>

      {/* Instance Chassis Band */}
      <div className="detail-chassis-band" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="m-stripe-divider"></div>
        <div style={{ padding: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span className="eyebrow-cap">{t('spec_title')}</span>
            <h1 className="display-xl" style={{ marginTop: '6px' }}>{node.name}</h1>
            <span className="eyebrow-cap" style={{ fontSize: '11px', marginTop: '8px', display: 'block' }}>
              UUID: {node.id}
            </span>
          </div>
          <div className="status-indicator-beacon">
            <span className={`beacon-dot ${isOnline ? 'beacon-live' : 'beacon-idle'}`}></span>
            <span>{isOnline ? t('node_online') : t('node_offline')}</span>
          </div>
        </div>

        {/* Specs Grid */}
        <div className="specs-data-grid">
          <div className="spec-entry">
            <span className="spec-entry-label">{t('env_type')}</span>
            <span className="spec-entry-val">
              {(node.environment?.type || 'MACHINE').toUpperCase()} // {(node.environment?.runtime || 'NATIVE').toUpperCase()}
            </span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">{t('resource_boundary')}</span>
            <span className="spec-entry-val">{(node.environment?.resource_scope || 'MACHINE').toUpperCase()}</span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">{t('cpu_capacity')}</span>
            <span className="spec-entry-val">
              {node.resources?.cpu_capacity_cores || 1} {t('node_cores')}
              {node.resources?.cpu_model_visible ? ` (${node.resources.cpu_model_visible})` : ''}
            </span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">{t('memory_limit')}</span>
            <span className="spec-entry-val">
              {(() => {
                const limit = node.resources?.memory_limit_bytes;
                const used = overlay?.memory_used_bytes ?? node.state?.memory_used_bytes;
                if (isOnline && used && limit && limit > 0) {
                  const pct = ((used / limit) * 100).toFixed(1);
                  return `${pct}% (${formatBytes(used)} / ${formatBytes(limit)})`;
                }
                return formatBytes(limit);
              })()}
            </span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">{t('disk_limit')}</span>
            <span className="spec-entry-val">
              {node.resources?.rootfs_limit_bytes ? formatBytes(node.resources.rootfs_limit_bytes) : t('container_na')}
            </span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">{t('system_kernel')}</span>
            <span className="spec-entry-val">
              {(() => {
                const osVer = node.system?.os_version;
                const kernel = node.system?.kernel;
                if (osVer && kernel && osVer !== kernel) {
                  return `${osVer} (${kernel})`;
                }
                return osVer || kernel || 'UNKNOWN';
              })()}
            </span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">{t('location_colo')}</span>
            <span className="spec-entry-val">
              {node.geo?.city || node.geo?.country || 'COLO'} ({node.geo?.colo || 'EDGE'})
            </span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">{t('asn_info')}</span>
            <span className="spec-entry-val">
              {node.geo?.asn ? `AS${node.geo.asn} ${node.geo.as_org || ''}` : 'UNKNOWN'}
            </span>
          </div>
        </div>
      </div>
    </div>

      {/* Probes Results Table */}
      {probes.length > 0 && (
        <div className="detail-chassis-band" style={{ marginBottom: '24px' }}>
          <span className="eyebrow-cap">{t('probes_title')}</span>
          <table className="spacex-table" style={{ marginTop: '16px' }}>
            <thead>
              <tr>
                <th>{t('probe_target')}</th>
                <th>{t('probe_status')}</th>
                <th>{t('probe_rtt')}</th>
                <th>{t('probe_loss')}</th>
              </tr>
            </thead>
            <tbody>
              {probes.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.id.toUpperCase()}</strong></td>
                  <td>
                    <span className="status-indicator-beacon">
                      <span className={`beacon-dot ${p.status === 'ok' ? 'beacon-live' : 'beacon-idle'}`}></span>
                      <span>{p.status.toUpperCase()}</span>
                    </span>
                  </td>
                  <td>{p.latency_ms != null ? `${p.latency_ms.toFixed(1)} MS` : 'N/A'}</td>
                  <td>{Math.round(p.loss_ratio * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* History Telemetry Charts */}
      <div className="detail-chassis-band">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span className="eyebrow-cap">{t('charts_title')}</span>
            <h3 className="section-title" style={{ marginTop: '4px' }}>{t('chart_live_badge')}</h3>
          </div>
          <div className="range-selector-capsule">
            {(['10m', '1h', '24h', '7d', '30d'] as const).map((r) => (
              <button
                key={r}
                className={`range-capsule-btn ${range === r ? 'active' : ''}`}
                onClick={() => setRange(r)}
              >
                {r === '10m' ? '10M LIVE' : r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <HistoryChart nodeId={node.id} range={range} title={t('chart_cpu_title')} metricKey="cpu_usage_pct" unit="%" strokeColor="#ffffff" />
        <HistoryChart
          nodeId={node.id}
          range={range}
          title={`${t('chart_memory_title')}${node.resources?.memory_limit_bytes ? ` // ${t('memory_limit')}: ${formatBytes(node.resources.memory_limit_bytes)}` : ''}`}
          metricKey="memory_used_bytes"
          unit="B"
          strokeColor="#ffffff"
        />
        <HistoryChart nodeId={node.id} range={range} title={t('chart_rx_title')} metricKey="rx_bps" unit="B/S" strokeColor="#00e676" />
        <HistoryChart nodeId={node.id} range={range} title={t('chart_rtt_title')} metricKey="edge_rtt_ms" unit="MS" strokeColor="#ffffff" />
      </div>
    </div>
  );
};

function formatBytes(bytes?: number | null): string {
  if (!bytes) return 'N/A';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  return Math.round(bytes / (1024 * 1024)) + ' MB';
}
