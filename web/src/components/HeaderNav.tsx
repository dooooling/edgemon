import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePublicNodesQuery } from '../queries/nodes';
import { useRealtimeStore } from '../realtime/store';

export const HeaderNav: React.FC = () => {
  const location = useLocation();
  const { data } = usePublicNodesQuery();
  const wsConnected = useRealtimeStore((s) => s.wsConnected);
  const overlays = useRealtimeStore((s) => s.overlays);

  const nodes = data?.nodes || [];
  const now = Date.now();
  const onlineCutoffMs = 180 * 1000;

  const onlineNodes = nodes.filter((n) => {
    const lastSeen = overlays[n.id]?.last_seen_at_ms ?? n.state?.last_seen_at_ms;
    return lastSeen ? now - lastSeen < onlineCutoffMs : false;
  });

  return (
    <header className="nav-bar-overlay">
      <div className="nav-container">
        {/* Brand Wordmark (Uppercase D-DIN) */}
        <Link to="/" className="nav-brand-wordmark">
          <span>EDGEMON</span>
          <span style={{ color: 'var(--colors-on-primary-mute)', fontWeight: 400 }}>// TELEMETRY</span>
        </Link>

        {/* Center All-Caps Links */}
        <nav className="nav-menu-cluster">
          <Link
            to="/"
            className={`nav-menu-link ${location.pathname === '/' ? 'active' : ''}`}
          >
            FLEET OVERVIEW
          </Link>
          <Link
            to="/admin"
            className={`nav-menu-link ${location.pathname === '/admin' ? 'active' : ''}`}
          >
            MISSION CONSOLE
          </Link>
        </nav>

        {/* Status Beacon & Ghost Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div className="status-indicator-beacon">
            <span className={`beacon-dot ${wsConnected ? 'beacon-live' : 'beacon-idle'}`}></span>
            <span>{wsConnected ? `ORBITAL STREAM (${onlineNodes.length} ACTIVE)` : 'OFFLINE SYNC'}</span>
          </div>

          {location.pathname !== '/admin' && (
            <Link to="/admin" className="button-ghost-on-dark button-ghost-sm">
              PROVISION NODE
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};
