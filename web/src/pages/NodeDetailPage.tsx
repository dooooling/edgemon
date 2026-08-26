import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { usePublicNodesQuery } from '../queries/nodes';
import { useRealtimeStore } from '../realtime/store';
import { HistoryChart } from '../components/HistoryChart';
import { useTranslation } from '../i18n/I18nContext';
import { OsIcon } from '../components/OsIcon';
import { CountryFlag } from '../components/CountryFlag';

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

  const cpuUsagePct = overlay?.cpu_usage_pct ?? node.state?.cpu_usage_pct;
  const memoryUsedBytes = overlay?.memory_used_bytes ?? node.state?.memory_used_bytes;
  const rootfsUsedBytes = overlay?.rootfs_used_bytes ?? node.state?.rootfs_used_bytes;
  const rxBps = overlay?.rx_bps ?? node.state?.rx_bps;
  const txBps = overlay?.tx_bps ?? node.state?.tx_bps;
  const edgeRttMs = overlay?.edge_rtt_ms ?? node.state?.edge_rtt_ms;

  const cpuText = !isOnline || cpuUsagePct == null ? 'N/A' : `${cpuUsagePct}%`;
  const cpuBarWidth = !isOnline || cpuUsagePct == null ? 0 : Math.min(100, Math.max(0, cpuUsagePct));

  const limitBytes = node.resources?.memory_limit_bytes;
  const memoryPct = !memoryUsedBytes || !limitBytes || limitBytes === 0
    ? null
    : Number(((memoryUsedBytes / limitBytes) * 100).toFixed(1));

  const memoryText = !memoryUsedBytes
    ? (limitBytes ? formatBytes(limitBytes) : 'N/A')
    : memoryPct !== null && limitBytes && limitBytes > 0
    ? `${memoryPct}% (${formatBytes(memoryUsedBytes)} / ${formatBytes(limitBytes)})`
    : `${formatBytes(memoryUsedBytes)}`;

  const memoryBarWidth = isOnline && memoryPct !== null
    ? Math.min(100, Math.max(0, memoryPct))
    : 0;

  const rootfsLimitBytes = node.resources?.rootfs_limit_bytes;
  const diskText = !isOnline
    ? 'N/A'
    : !rootfsLimitBytes || rootfsLimitBytes === 0
    ? t('container_na')
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
      <div className="detail-chassis-band" style={{ padding: 0, overflow: 'hidden', marginBottom: '24px' }}>
        <div className="m-stripe-divider"></div>
        <div style={{ padding: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <span className="eyebrow-cap" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <OsIcon os={node.system?.os} osVersion={node.system?.os_version} size={14} />
                <span>{t('spec_title')} // {node.system?.os_version || (node.environment?.type || 'INSTANCE').toUpperCase()}</span>
              </span>
              <h1 className="display-xl" style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <CountryFlag countryCode={node.geo?.country} width={26} />
                <span>{node.name}</span>
              </h1>
              <span className="eyebrow-cap" style={{ fontSize: '11px', marginTop: '8px', display: 'block' }}>
                UUID: {node.id}
              </span>
            </div>
            <div className="status-indicator-beacon">
              <span className={`beacon-dot ${isOnline ? 'beacon-live' : 'beacon-idle'}`}></span>
              <span>{isOnline ? t('node_online') : t('node_offline')}</span>
            </div>
          </div>

          {/* Live Telemetry Stack on Detail Page */}
          <div className="telemetry-stack" style={{ marginTop: '24px', padding: '20px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid var(--colors-hairline-on-dark)' }}>
            {/* CPU */}
            <div className="telemetry-row">
              <div className="telemetry-header-row">
                <span style={{ color: 'var(--colors-on-primary-mute)' }}>{t('cpu_usage')}</span>
                <span style={{ fontWeight: 600 }}>{cpuText}</span>
              </div>
              <div className="telemetry-bar-track">
                <div className="telemetry-bar-fill" style={{ width: `${cpuBarWidth}%` }}></div>
              </div>
            </div>

            {/* Memory */}
            <div className="telemetry-row">
              <div className="telemetry-header-row">
                <span style={{ color: 'var(--colors-on-primary-mute)' }}>{t('memory_allocation')}</span>
                <span style={{ fontWeight: 600 }}>{memoryText}</span>
              </div>
              <div className="telemetry-bar-track">
                <div className="telemetry-bar-fill" style={{ width: `${memoryBarWidth}%` }}></div>
              </div>
            </div>

            {/* Storage */}
            <div className="telemetry-row">
              <div className="telemetry-header-row">
                <span style={{ color: 'var(--colors-on-primary-mute)' }}>{t('root_storage')}</span>
                <span style={{ fontWeight: 600 }}>{diskText}</span>
              </div>
            </div>

            {/* Traffic Billing Cycle */}
            {traffic && (
              <div className="telemetry-row">
                <div className="telemetry-header-row">
                  <span style={{ color: 'var(--colors-on-primary-mute)' }}>{t('cycle_traffic')} (DAY {traffic.reset_day})</span>
                  <span style={{ fontWeight: 600 }}>
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

            {/* Rates & Chips */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap', gap: '12px' }}>
              <div className="traffic-rates-block" style={{ marginTop: 0 }}>
                <span>↓ {formatBps(rxBps)}</span>
                <span>↑ {formatBps(txBps)}</span>
              </div>
              {edgeRttMs && (
                <span className="spacex-chip" style={{ color: '#ffffff', borderColor: '#ffffff' }}>
                  CF EDGE · {edgeRttMs} MS
                </span>
              )}
            </div>
          </div>

          {/* Specs Grid */}
          <div className="specs-data-grid" style={{ marginTop: '24px' }}>
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
              <span className="spec-entry-val">{memoryText}</span>
            </div>
            <div className="spec-entry">
              <span className="spec-entry-label">{t('disk_limit')}</span>
              <span className="spec-entry-val">
                {node.resources?.rootfs_limit_bytes ? formatBytes(node.resources.rootfs_limit_bytes) : t('container_na')}
              </span>
            </div>
            <div className="spec-entry">
              <span className="spec-entry-label">{t('system_kernel')}</span>
              <span className="spec-entry-val" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <OsIcon os={node.system?.os} osVersion={node.system?.os_version} size={15} />
                <span>
                  {(() => {
                    const osVer = node.system?.os_version;
                    const kernel = node.system?.kernel;
                    if (osVer && kernel && osVer !== kernel) {
                      return `${osVer} (${kernel})`;
                    }
                    return osVer || kernel || 'UNKNOWN';
                  })()}
                </span>
              </span>
            </div>
            <div className="spec-entry">
              <span className="spec-entry-label">{t('location_colo')}</span>
              <span className="spec-entry-val" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <CountryFlag countryCode={node.geo?.country} />
                <span>{node.geo?.city || node.geo?.country || 'COLO'} ({node.geo?.colo || 'EDGE'})</span>
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
                  <td>{p.latency_ms != null ? `${p.latency_ms} MS` : 'N/A'}</td>
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
          metricKey="memory_usage_pct"
          unit="%"
          limitBytes={node.resources?.memory_limit_bytes}
          strokeColor="#ffffff"
        />
        <HistoryChart nodeId={node.id} range={range} title={t('chart_rx_title')} metricKey="rx_bps" unit="B/S" strokeColor="#00e676" />
        <HistoryChart nodeId={node.id} range={range} title={t('chart_rtt_title')} metricKey="edge_rtt_ms" unit="MS" strokeColor="#ffffff" />
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
