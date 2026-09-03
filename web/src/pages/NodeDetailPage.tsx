import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { usePublicNodesQuery } from '../queries/nodes';
import { useRealtimeStore } from '../realtime/store';
import { HistoryChart } from '../components/HistoryChart';
import { useTranslation } from '../i18n/I18nContext';
import { formatBeijingDate, formatUptime } from '../utils/time';
import { OsIcon } from '../components/OsIcon';
import { CountryFlag } from '../components/CountryFlag';
import { ProbeSparklineBar, getLatencyColor } from '../components/ProbeHeatmap';

export const NodeDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = React.useState('10m');
  const { data, isLoading } = usePublicNodesQuery();
  const connectRealtime = useRealtimeStore((s) => s.connectRealtime);
  const clearOverlay = useRealtimeStore((s) => s.clearOverlay);
  const overlay = useRealtimeStore((s) => (id ? s.overlays[id] : undefined));
  const hasRealtimeTemp = useRealtimeStore((s) => {
    if (!id) return false;
    if (s.overlays[id]?.cpu_temp_celsius != null) return true;
    const series = s.realtimeSeries[id];
    return series ? series.some((p) => p.cpu_temp_celsius != null) : false;
  });
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

  const rxBps = overlay?.rx_bps ?? node.state?.rx_bps;
  const txBps = overlay?.tx_bps ?? node.state?.tx_bps;
  const edgeRttMs = overlay?.edge_rtt_ms ?? node.state?.edge_rtt_ms;
  const traffic = node.traffic;
  const trafficUsed = traffic?.period_total_bytes || 0;
  const trafficQuota = traffic?.quota_bytes;

  const cpuTemp = overlay?.cpu_temp_celsius ?? node.state?.cpu_temp_celsius;
  const hasTemp = cpuTemp != null || hasRealtimeTemp;
  const load1 = overlay?.load1 ?? node.state?.load1;
  const load5 = overlay?.load5 ?? node.state?.load5;
  const load15 = overlay?.load15 ?? node.state?.load15;
  const procRunning = overlay?.process_running_count ?? node.state?.process_running_count;
  const procTotal = overlay?.process_total_count ?? node.state?.process_total_count;
  const oomKills = overlay?.oom_kill_count ?? node.state?.oom_kill_count;
  const readIops = overlay?.read_iops ?? node.state?.read_iops;
  const writeIops = overlay?.write_iops ?? node.state?.write_iops;
  const ioUtilPct = overlay?.io_util_pct ?? node.state?.io_util_pct;
  const tcpEstab = overlay?.tcp_established_count ?? node.state?.tcp_established_count;
  const tcpTw = overlay?.tcp_tw_count ?? node.state?.tcp_tw_count;
  const udpInUse = overlay?.udp_in_use ?? node.state?.udp_in_use;
  const uptimeSec = overlay?.uptime_sec ?? node.state?.uptime_sec;

  const mounts = overlay?.mounts ?? node.state?.mounts ?? [];
  const rootfsUsedBytes = overlay?.rootfs_used_bytes ?? node.state?.rootfs_used_bytes;
  const rootfsLimitBytes = node.resources?.rootfs_limit_bytes;

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
              <h1 className="display-xl" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <CountryFlag countryCode={node.geo?.country} width={26} />
                <span>{node.name}</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--colors-body)', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <OsIcon os={node.system?.os} osVersion={node.system?.os_version} size={18} />
                  <span>{node.system?.os_version || (node.environment?.type || 'INSTANCE').toUpperCase()} · {node.resources?.cpu_capacity_cores || 1}C</span>
                </span>
              </h1>
              <span className="eyebrow-cap" style={{ fontSize: '11px', marginTop: '6px', display: 'block', color: 'var(--colors-muted)' }}>
                UUID: {node.id}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {oomKills != null && oomKills > 0 && (
                <span className="spacex-chip" style={{ backgroundColor: 'rgba(226, 39, 24, 0.2)', color: '#e22718', border: '1px solid #e22718' }}>
                  ⚠️ {oomKills} {t('oom_kill_badge')}
                </span>
              )}
              {cpuTemp != null && (
                <span
                  className="spacex-chip"
                  style={{
                    color: cpuTemp >= 80 ? '#e22718' : cpuTemp >= 60 ? '#f59e0b' : '#00e676',
                    borderColor: cpuTemp >= 80 ? '#e22718' : cpuTemp >= 60 ? '#f59e0b' : '#00e676',
                  }}
                >
                  {cpuTemp >= 80 ? '🔥' : '🌡️'} {cpuTemp}°C
                </span>
              )}
              <div className="status-indicator-beacon">
                <span className={`beacon-dot ${isOnline ? 'beacon-live' : 'beacon-idle'}`}></span>
                <span>{isOnline ? t('node_online') : t('node_offline')}</span>
              </div>
            </div>
          </div>

          {/* Realtime Telemetry Status Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', padding: '14px 20px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid var(--colors-hairline-on-dark)', flexWrap: 'wrap', gap: '12px' }}>
            <div className="traffic-rates-block" style={{ marginTop: 0 }}>
              <span>↓ {formatBps(rxBps)}</span>
              <span>↑ {formatBps(txBps)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {load1 != null && (
                <span className="spacex-chip">
                  LOAD: {load1} / {load5 ?? '-'} / {load15 ?? '-'}
                </span>
              )}
              {procTotal != null && (
                <span className="spacex-chip">
                  {procRunning ?? 1}/{procTotal} PROC
                </span>
              )}
              {(readIops != null || writeIops != null) && (
                <span className="spacex-chip">
                  IOPS: ↓{readIops || 0} ↑{writeIops || 0} {ioUtilPct != null ? `· ${ioUtilPct}% IO-BUS` : ''}
                </span>
              )}
              {tcpEstab != null && (
                <span className="spacex-chip" style={{ color: '#38bdf8', borderColor: '#38bdf8' }}>
                  {tcpEstab} TCP ESTAB {tcpTw != null ? `· ${tcpTw} TW` : ''}
                </span>
              )}
              {udpInUse != null && (
                <span className="spacex-chip">
                  {udpInUse} UDP
                </span>
              )}
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
              <span className="spec-entry-val">{formatEnvironment(node.environment)}</span>
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
                {node.resources?.memory_limit_bytes ? formatBytes(node.resources.memory_limit_bytes) : t('container_na')}
              </span>
            </div>
            <div className="spec-entry">
              <span className="spec-entry-label">{t('system_kernel')}</span>
              <span className="spec-entry-val" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <OsIcon os={node.system?.os} osVersion={node.system?.os_version} size={20} />
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
              <span className="spec-entry-label">{t('uptime')}</span>
              <span className="spec-entry-val">{isOnline && uptimeSec ? formatUptime(uptimeSec) : 'N/A'}</span>
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
            {traffic && (
              <div className="spec-entry">
                <span className="spec-entry-label">{t('cycle_traffic')} (DAY {traffic.reset_day})</span>
                <span className="spec-entry-val">
                  {formatBytes(trafficUsed)}
                  {trafficQuota ? ` / ${formatBytes(trafficQuota)}` : ''}
                </span>
              </div>
            )}
            {node.expires_at_ms && (
              <div className="spec-entry">
                <span className="spec-entry-label">{t('th_expire')}</span>
                <span className="spec-entry-val" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{formatBeijingDate(node.expires_at_ms)}</span>
                  {(() => {
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
                </span>
              </div>
            )}
            {node.finance && node.finance.price != null && node.finance.price > 0 && (
              <div className="spec-entry">
                <span className="spec-entry-label">COST / 财务费用</span>
                <span className="spec-entry-val" style={{ color: '#00e676', fontWeight: 700 }}>
                  {node.finance.currency || 'USD'} {node.finance.price.toFixed(2)}
                  <span style={{ fontSize: '11px', color: 'var(--colors-muted)', marginLeft: '4px', fontWeight: 500 }}>
                    / {node.finance.billing_cycle === 'monthly' ? '月付' : node.finance.billing_cycle === 'annually' ? '年付' : node.finance.billing_cycle === 'quarterly' ? '季付' : node.finance.billing_cycle}
                  </span>
                </span>
              </div>
            )}
            {node.note && (
              <div className="spec-entry">
                <span className="spec-entry-label">NOTE / 备注</span>
                <span className="spec-entry-val">{node.note}</span>
              </div>
            )}
          </div>

          {/* Disk Mounts Section */}
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--colors-hairline-on-dark)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span className="spec-entry-label" style={{ fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--colors-muted)' }}>
                {t('mounts_title')}
              </span>
              {mounts.length > 0 && (
                <span className="spacex-chip" style={{ fontSize: '10px' }}>
                  {mounts.length} {mounts.length > 1 ? 'MOUNTS' : 'MOUNT'}
                </span>
              )}
            </div>

            {mounts.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
                {mounts.map((m) => {
                  const mTotal = m.total_bytes || 1;
                  const mUsed = m.used_bytes || 0;
                  const mPct = Math.min(100, Math.round((mUsed / mTotal) * 100));
                  const isFull = mPct >= 90;
                  const isWarn = mPct >= 80;
                  return (
                    <div
                      key={m.mount_point}
                      style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        padding: '10px 14px',
                        borderRadius: '6px',
                        border: '1px solid var(--colors-hairline-on-dark)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 700, fontSize: '12px', color: '#ffffff' }}>
                          {m.mount_point}
                          <span style={{ fontSize: '10px', color: 'var(--colors-muted)', marginLeft: '6px', fontWeight: 500 }}>
                            {m.fs_type || 'FS'}
                          </span>
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: isFull ? '#e22718' : isWarn ? '#f59e0b' : '#ffffff' }}>
                          {mPct}%
                        </span>
                      </div>
                      <div className="telemetry-bar-track" style={{ height: '4px', margin: '6px 0' }}>
                        <div
                          className="telemetry-bar-fill"
                          style={{
                            width: `${mPct}%`,
                            backgroundColor: isFull ? '#e22718' : isWarn ? '#f59e0b' : '#ffffff',
                          }}
                        ></div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--colors-muted)' }}>
                        <span>{formatBytes(mUsed)} / {formatBytes(mTotal)}</span>
                        <span>{mTotal > mUsed ? `${formatBytes(mTotal - mUsed)} 可用` : '0 B'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--colors-hairline-on-dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                <span style={{ fontWeight: 700, color: '#ffffff' }}>
                  {node.system?.os?.toLowerCase() === 'windows' ? 'C:\\ (SYSTEM)' : '/ (ROOTFS)'}
                </span>
                <span style={{ color: 'var(--colors-muted)' }}>
                  {rootfsUsedBytes != null ? formatBytes(rootfsUsedBytes) : 'N/A'}
                  {rootfsLimitBytes ? ` / ${formatBytes(rootfsLimitBytes)}` : ` / ${t('container_na')}`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Probes Results Table with Embedded Heatmap Sparklines */}
      {probes.length > 0 && (
        <div className="detail-chassis-band" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 className="section-title" style={{ fontSize: '16px', fontWeight: 700 }}>
              {t('probes_title')}
            </h3>
            <span className="spacex-chip" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
              {probes.length} TARGETS · LIVE 60S
            </span>
          </div>

          <table className="spacex-table">
            <thead>
              <tr>
                <th>{t('probe_target')}</th>
                <th>{t('probe_status')}</th>
                <th>{t('probe_rtt')}</th>
                <th>{t('probe_loss')}</th>
                <th style={{ minWidth: '160px' }}>时序延迟热力条 (60S BUCKETS)</th>
              </tr>
            </thead>
            <tbody>
              {probes.map((p) => {
                const info = getProbeLabel(p.id);
                const rtt = p.latency_ms;
                const loss = Math.round((p.loss_ratio || 0) * 100);
                const isDown = loss >= 100 || rtt === null || rtt === undefined;

                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {info.tag && (
                          <span
                            className="spacex-chip"
                            style={{
                              borderColor: info.color || '#ffffff',
                              color: info.color || '#ffffff',
                              fontWeight: 700,
                              fontSize: '10px',
                            }}
                          >
                            {info.tag}
                          </span>
                        )}
                        <strong>{info.label}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="status-indicator-beacon">
                        <span className={`beacon-dot ${p.status === 'ok' ? 'beacon-live' : 'beacon-idle'}`}></span>
                        <span>{p.status.toUpperCase()}</span>
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, fontFamily: 'monospace', color: getLatencyColor(rtt, loss) }}>
                      {isDown ? (loss >= 100 ? '100% 丢包' : 'TIMEOUT') : `${rtt != null ? rtt.toFixed(1) : '0.0'} MS`}
                    </td>
                    <td style={{ fontFamily: 'monospace', color: loss > 0 ? '#f85149' : 'var(--colors-body)' }}>
                      {loss}%
                    </td>
                    <td>
                      <ProbeSparklineBar
                        nodeId={node.id}
                        probeId={p.id}
                        rtt={rtt}
                        lossRatio={p.loss_ratio}
                        bucketCount={18}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* History Telemetry Charts */}
      <div className="detail-chassis-band">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 className="section-title" style={{ fontSize: '16px', fontWeight: 700 }}>
              {t('charts_title')}
            </h3>
            <span className="spacex-chip" style={{ fontSize: '10px', color: 'var(--colors-status-live)', borderColor: 'var(--colors-status-live)' }}>
              LIVE STREAM
            </span>
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
        {hasTemp && (
          <HistoryChart
            nodeId={node.id}
            range={range}
            title={t('chart_temp_title')}
            metricKey="cpu_temp_celsius"
            unit="°C"
            strokeColor="#ff9100"
          />
        )}
        <HistoryChart
          nodeId={node.id}
          range={range}
          title={`${t('chart_memory_title')}${node.resources?.memory_limit_bytes ? ` // ${t('memory_limit')}: ${formatBytes(node.resources.memory_limit_bytes)}` : ''}`}
          metricKey="memory_usage_pct"
          unit="%"
          limitBytes={node.resources?.memory_limit_bytes}
          strokeColor="#ffffff"
        />
        <HistoryChart
          nodeId={node.id}
          range={range}
          title={t('chart_net_title')}
          unit="B/S"
          series={[
            { metricKey: 'rx_bps', label: t('chart_rx_label'), strokeColor: '#00e676', fillColor: 'rgba(0, 230, 118, 0.06)' },
            { metricKey: 'tx_bps', label: t('chart_tx_label'), strokeColor: '#38bdf8', fillColor: 'rgba(56, 189, 248, 0.06)' },
          ]}
        />
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

export function getProbeLabel(id: string): { label: string; tag?: string; color?: string } {
  const lower = id.toLowerCase();
  if (lower.includes('ct') || lower.includes('telecom') || lower.includes('电信')) {
    return { label: '中国电信骨干 (China Telecom)', tag: '电信 CT', color: '#0070c9' };
  }
  if (lower.includes('cu') || lower.includes('unicom') || lower.includes('联通')) {
    return { label: '中国联通骨干 (China Unicom)', tag: '联通 CU', color: '#e60012' };
  }
  if (lower.includes('cm') || lower.includes('mobile') || lower.includes('移动')) {
    return { label: '中国移动骨干 (China Mobile)', tag: '移动 CM', color: '#0085d0' };
  }
  if (lower.includes('ali')) {
    return { label: '阿里云公共 DNS (223.5.5.5)', tag: '阿里 DNS', color: '#ff6a00' };
  }
  if (lower.includes('cf') || lower.includes('cloudflare')) {
    return { label: 'Cloudflare Anycast (1.1.1.1)', tag: 'CLOUDFLARE', color: '#f38020' };
  }
  if (lower.includes('google')) {
    return { label: 'Google Public DNS (8.8.8.8)', tag: 'GOOGLE', color: '#4285f4' };
  }
  if (lower.includes('apple')) {
    return { label: 'Apple Global CDN', tag: 'APPLE', color: '#a2aaad' };
  }
  return { label: id.toUpperCase() };
}

function formatEnvironment(env?: { type?: string | null; runtime?: string | null; resource_scope?: string | null } | null): string {
  if (!env) return 'UNKNOWN';
  const type = (env.type || '').toLowerCase();
  const runtime = (env.runtime || '').toLowerCase();

  if (runtime && runtime !== 'native' && runtime !== 'unknown') {
    const runtimeUpper = runtime.toUpperCase();
    if (type === 'container') {
      return `${runtimeUpper} (CONTAINER)`;
    }
    if (type === 'vm') {
      return `${runtimeUpper} (VM)`;
    }
    if (type === 'physical') {
      return `BARE METAL (${runtimeUpper})`;
    }
    return runtimeUpper;
  }

  if (type === 'container') return 'CONTAINER';
  if (type === 'vm') return 'VIRTUAL MACHINE (VM)';
  if (type === 'physical') return 'BARE METAL (PHYSICAL)';
  return (env.resource_scope || 'MACHINE').toUpperCase();
}
