import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { NodeItem } from '../api/client';
import { useRealtimeStore } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';

interface WorldMapProps {
  nodes: NodeItem[];
}

export const WorldMap: React.FC<WorldMapProps> = ({ nodes }) => {
  const [selectedNode, setSelectedNode] = useState<NodeItem | null>(null);
  const overlays = useRealtimeStore((s) => s.overlays);
  const { t } = useTranslation();

  const geoNodes = nodes.filter(
    (n) => n.geo?.lat != null && n.geo?.lon != null && !isNaN(n.geo.lat) && !isNaN(n.geo.lon)
  );

  function isOnline(node: NodeItem): boolean {
    const lastSeen = overlays[node.id]?.last_seen_at_ms ?? node.state?.last_seen_at_ms;
    return lastSeen ? Date.now() - lastSeen < 90 * 1000 : false;
  }

  function projectX(lon: number): number {
    return ((lon + 180) / 360) * 800;
  }

  function projectY(lat: number): number {
    return ((90 - lat) / 180) * 400;
  }

  return (
    <div className="map-band">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px' }}>
        <div>
          <span className="eyebrow-cap">GLOBAL ORBITAL CONSTELLATION</span>
          <h2 className="display-lg" style={{ fontSize: '24px', marginTop: '4px' }}>
            {t('map_title')}
          </h2>
        </div>
        <span className="eyebrow-cap">{geoNodes.length} {t('nav_active_count')}</span>
      </div>

      <div className="map-viewport" style={{ position: 'relative' }}>
        <svg viewBox="0 0 800 400" className="orbital-svg" xmlns="http://www.w3.org/2000/svg">
          {/* Orbital Grids */}
          <g stroke="#1a1a1f" strokeWidth="0.6">
            <line x1="0" y1="200" x2="800" y2="200" strokeDasharray="3 3" />
            <line x1="400" y1="0" x2="400" y2="400" strokeDasharray="3 3" />
            <line x1="200" y1="0" x2="200" y2="400" />
            <line x1="600" y1="0" x2="600" y2="400" />
            <circle cx="400" cy="200" r="160" fill="none" stroke="#111116" />
          </g>

          {/* Continents Vectors */}
          <g fill="#18181c" stroke="#282830" strokeWidth="0.8">
            {/* North America */}
            <path d="M120,60 L240,50 L280,100 L240,160 L180,180 L140,140 L100,100 Z" />
            {/* South America */}
            <path d="M220,190 L280,210 L300,280 L250,360 L210,280 L200,220 Z" />
            {/* Europe & Africa */}
            <path d="M370,70 L460,60 L450,120 L390,110 Z" />
            <path d="M380,130 L480,140 L490,230 L440,320 L370,220 Z" />
            {/* Asia */}
            <path d="M470,60 L680,60 L720,140 L640,200 L540,190 L480,120 Z" />
            {/* Australia */}
            <path d="M620,240 L710,250 L700,310 L610,300 Z" />
            <circle cx="685" cy="115" r="3.5" fill="#282830" />
          </g>

          {/* Node Beacons */}
          {geoNodes.map((node) => {
            const x = projectX(node.geo.lon!);
            const y = projectY(node.geo.lat!);
            const online = isOnline(node);

            return (
              <g key={node.id}>
                {online && (
                  <circle
                    cx={x}
                    cy={y}
                    r="6"
                    fill="none"
                    stroke="#00e676"
                    className="orbital-pulse"
                  />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r="5"
                  fill={online ? '#00e676' : '#e22718'}
                  stroke="#000000"
                  strokeWidth="1.5"
                  className="orbital-node-dot"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setSelectedNode(node)}
                />
              </g>
            );
          })}
        </svg>

        {/* Floating Mission Radar Tooltip */}
        {selectedNode && (
          <div className="radar-tooltip" style={{
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            backgroundColor: 'var(--colors-surface-card)',
            border: '1px solid var(--colors-hairline)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            zIndex: 10
          }}>
            <span className="button-cap" style={{ fontWeight: 700, fontSize: '14px', color: '#ffffff' }}>{selectedNode.name}</span>
            <span className="caption" style={{ color: 'var(--colors-body)' }}>
              LOC: {selectedNode.geo.city || selectedNode.geo.country || 'UNKNOWN'} // COLO: {selectedNode.geo.colo || 'CF'}
            </span>
            {selectedNode.state?.edge_rtt_ms && (
              <span className="caption" style={{ color: 'var(--colors-status-live)', fontWeight: 700 }}>
                RTT: {selectedNode.state.edge_rtt_ms} MS
              </span>
            )}
            <Link
              to={`/node/${selectedNode.id}`}
              className="button-ghost-on-dark button-ghost-sm"
              style={{ marginTop: '6px' }}
            >
              {t('inspect_node')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};
