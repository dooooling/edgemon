import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePublicNodesQuery } from '../queries/nodes';
import { useRealtimeStore } from '../realtime/store';
import { WorldMap } from '../components/WorldMap';
import { NodeCard } from '../components/NodeCard';

export const OverviewPage: React.FC = () => {
  const { data, isLoading, refetch } = usePublicNodesQuery();
  const connectRealtime = useRealtimeStore((s) => s.connectRealtime);
  const overlays = useRealtimeStore((s) => s.overlays);

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
      {/* 1. Hero Band */}
      <section className="hero-band">
        <span className="eyebrow-cap">MISSION ARCHITECTURE // EDGE MONITORING</span>
        <h1 className="display-xxl">GLOBAL TELEMETRY STREAM</h1>
        <p className="hero-subline">
          Zero-RCE, low-overhead distributed Linux & Windows daemon architecture. Real-time telemetry routed across Cloudflare edge workers.
        </p>
      </section>

      {/* 2. Mission Statistics Grid */}
      <div className="mission-stats-grid">
        <div className="stat-tile">
          <span className="eyebrow-cap">TOTAL FLEET NODES</span>
          <div className="stat-val-large">{nodes.length}</div>
        </div>
        <div className="stat-tile">
          <span className="eyebrow-cap">ACTIVE ORBITAL BEACONS</span>
          <div className="stat-val-large stat-val-live">{onlineNodes.length}</div>
        </div>
        <div className="stat-tile">
          <span className="eyebrow-cap">OFFLINE / SILENT</span>
          <div className={`stat-val-large ${offlineCount > 0 ? 'stat-val-alert' : ''}`}>
            {offlineCount}
          </div>
        </div>
        <div className="stat-tile">
          <span className="eyebrow-cap">AGGREGATE BANDWIDTH</span>
          <div className="stat-val-large" style={{ fontSize: '22px' }}>
            ↓ {formatBps(totalRxBps)} · ↑ {formatBps(totalTxBps)}
          </div>
        </div>
      </div>

      {/* 3. Orbital World Map */}
      <WorldMap nodes={nodes} />

      {/* 4. Fleet Nodes Grid Section */}
      <div className="section-title-bar">
        <div>
          <span className="eyebrow-cap">FLEET INVENTORY</span>
          <h2 className="display-lg" style={{ fontSize: '24px', marginTop: '4px' }}>
            REGISTERED INSTANCES ({nodes.length})
          </h2>
        </div>
        <button className="button-ghost-on-dark button-ghost-sm" onClick={() => refetch()}>
          REFRESH FLEET
        </button>
      </div>

      {isLoading && nodes.length === 0 ? (
        <div className="node-card-tile" style={{ textAlign: 'center', padding: '60px' }}>
          <span className="eyebrow-cap">CONNECTING TO ORBITAL TELEMETRY PIPELINE...</span>
        </div>
      ) : nodes.length === 0 ? (
        <div className="node-card-tile" style={{ textAlign: 'center', padding: '60px', gap: '20px' }}>
          <h3 className="display-lg" style={{ fontSize: '24px' }}>NO ACTIVE INSTANCES</h3>
          <p className="caption">Deploy your lightweight Linux/Windows agent daemon or provision security tokens.</p>
          <div>
            <Link to="/admin" className="button-ghost-on-dark">
              OPEN MISSION CONSOLE
            </Link>
          </div>
        </div>
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
