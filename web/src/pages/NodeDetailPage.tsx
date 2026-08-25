import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { usePublicNodesQuery } from '../queries/nodes';
import { useRealtimeStore } from '../realtime/store';
import { HistoryChart } from '../components/HistoryChart';

export const NodeDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = usePublicNodesQuery();
  const connectRealtime = useRealtimeStore((s) => s.connectRealtime);
  const clearOverlay = useRealtimeStore((s) => s.clearOverlay);
  const overlay = useRealtimeStore((s) => (id ? s.overlays[id] : undefined));

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
          <span className="eyebrow-cap">ACQUIRING INSTANCE TELEMETRY MATRIX...</span>
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
              RETURN TO FLEET
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const lastSeen = overlay?.last_seen_at_ms ?? node.state?.last_seen_at_ms;
  const isOnline = lastSeen ? Date.now() - lastSeen < 180 * 1000 : false;
  const probes = overlay?.probes ?? node.state?.probes ?? [];

  return (
    <div className="page-container">
      {/* Top Navigation Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Link to="/" className="button-ghost-on-dark button-ghost-sm">
          ‹ BACK TO FLEET
        </Link>
        <div className="status-indicator-beacon" style={{ border: '1px solid var(--colors-hairline-on-dark)', padding: '6px 14px', borderRadius: '32px' }}>
          <span className="beacon-dot beacon-live"></span>
          <span>HIGH-PRECISION REALTIME STREAM (2-SEC LEASE ACTIVE)</span>
        </div>
      </div>

      {/* Instance Chassis Band */}
      <div className="detail-chassis-band">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span className="eyebrow-cap">INSTANCE TELEMETRY SPECIFICATION</span>
            <h1 className="display-xl" style={{ marginTop: '6px' }}>{node.name}</h1>
            <span className="eyebrow-cap" style={{ fontSize: '11px', marginTop: '8px', display: 'block' }}>
              UUID: {node.id}
            </span>
          </div>
          <div className="status-indicator-beacon">
            <span className={`beacon-dot ${isOnline ? 'beacon-live' : 'beacon-idle'}`}></span>
            <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
        </div>

        {/* Specs Grid */}
        <div className="specs-data-grid">
          <div className="spec-entry">
            <span className="spec-entry-label">ENVIRONMENT TYPE</span>
            <span className="spec-entry-val">
              {(node.environment?.type || 'MACHINE').toUpperCase()} // {(node.environment?.runtime || 'NATIVE').toUpperCase()}
            </span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">RESOURCE BOUNDARY</span>
            <span className="spec-entry-val">{(node.environment?.resource_scope || 'MACHINE').toUpperCase()}</span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">CPU CAPACITY</span>
            <span className="spec-entry-val">{node.resources?.cpu_capacity_cores || 1} CORES</span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">MEMORY LIMIT</span>
            <span className="spec-entry-val">{formatBytes(node.resources?.memory_limit_bytes)}</span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">ROOT STORAGE LIMIT</span>
            <span className="spec-entry-val">
              {node.resources?.rootfs_limit_bytes ? formatBytes(node.resources.rootfs_limit_bytes) : 'N/A (CONTAINER)'}
            </span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">SYSTEM / KERNEL</span>
            <span className="spec-entry-val">{node.system?.kernel || 'UNKNOWN'}</span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">LOCATION // COLO</span>
            <span className="spec-entry-val">
              {node.geo?.city || node.geo?.country || 'COLO'} ({node.geo?.colo || 'EDGE'})
            </span>
          </div>
          <div className="spec-entry">
            <span className="spec-entry-label">AUTONOMOUS SYSTEM (ASN)</span>
            <span className="spec-entry-val">
              {node.geo?.asn ? `AS${node.geo.asn} ${node.geo.as_org || ''}` : 'UNKNOWN'}
            </span>
          </div>
        </div>
      </div>

      {/* Probes Results Table */}
      {probes.length > 0 && (
        <div className="detail-chassis-band" style={{ marginBottom: '24px' }}>
          <span className="eyebrow-cap">CONNECTIVITY RADAR PROBES</span>
          <table className="spacex-table" style={{ marginTop: '16px' }}>
            <thead>
              <tr>
                <th>PROBE TARGET</th>
                <th>LINK STATUS</th>
                <th>ROUND-TRIP LATENCY (RTT)</th>
                <th>PACKET LOSS</th>
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

      {/* Historical Telemetry Charts */}
      <div>
        <div className="section-title-bar">
          <span className="eyebrow-cap">HISTORICAL FLIGHT TELEMETRY TRENDS</span>
        </div>
        <HistoryChart nodeId={node.id} title="CPU CORE USAGE (%)" metricKey="cpu_usage_pct" unit="%" strokeColor="#ffffff" />
        <HistoryChart nodeId={node.id} title="MEMORY ALLOCATION (BYTES)" metricKey="memory_used_bytes" unit="B" strokeColor="#ffffff" />
        <HistoryChart nodeId={node.id} title="NETWORK INBOUND THROUGHPUT (BPS)" metricKey="rx_bps" unit="B/S" strokeColor="#00e676" />
        <HistoryChart nodeId={node.id} title="CLOUDFLARE EDGE SMOOTHED RTT (MS)" metricKey="edge_rtt_ms" unit="MS" strokeColor="#ffffff" />
      </div>
    </div>
  );
};

function formatBytes(bytes?: number | null): string {
  if (!bytes) return 'N/A';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  return Math.round(bytes / (1024 * 1024)) + ' MB';
}
