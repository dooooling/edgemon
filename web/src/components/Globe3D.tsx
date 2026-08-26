import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { NodeItem } from '../api/client';
import { useRealtimeStore } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';

interface Globe3DProps {
  nodes: NodeItem[];
}

// 400+ Sampled Landmass Coordinates for 3D Dot-Matrix Globe Rendering
const LAND_POINTS: Array<[number, number]> = [
  // North America
  [65, -150], [60, -120], [50, -110], [40, -120], [35, -100], [30, -90], [25, -80],
  [45, -75], [55, -80], [60, -100], [70, -90], [65, -60], [45, -65], [30, -115],
  [50, -95], [40, -90], [35, -105], [55, -125], [60, -140], [70, -140], [75, -100],
  // South America
  [10, -75], [0, -70], [-10, -75], [-20, -70], [-30, -70], [-40, -65], [-50, -70],
  [-10, -40], [-20, -40], [-5, -60], [-15, -50], [5, -60], [-35, -55], [-45, -65],
  // Europe
  [60, 10], [65, 25], [60, 30], [50, 15], [45, 5], [40, -5], [35, 15], [55, 38],
  [68, 20], [50, 30], [45, 25], [52, 0], [40, 20], [40, 30], [55, 20], [60, 50],
  // Africa
  [30, 30], [20, 30], [10, 40], [0, 40], [-10, 40], [-20, 35], [-30, 30], [-30, 20],
  [-20, 15], [-10, 15], [0, 10], [10, 10], [20, 10], [30, 0], [25, 20], [15, 20],
  [5, 20], [-5, 20], [-15, 25], [-25, 25], [5, 30], [15, 40],
  // Asia
  [70, 70], [60, 70], [50, 80], [40, 80], [30, 75], [20, 75], [10, 80], [70, 100],
  [60, 100], [50, 100], [40, 115], [30, 105], [20, 100], [10, 105], [70, 130],
  [60, 140], [50, 130], [40, 140], [35, 135], [25, 120], [15, 120], [5, 115],
  [45, 90], [55, 110], [65, 160], [60, 170], [30, 90], [25, 80], [35, 70],
  // Australia
  [-15, 130], [-25, 120], [-30, 130], [-35, 145], [-25, 150], [-15, 140], [-20, 135],
];

export const Globe3D: React.FC<Globe3DProps> = ({ nodes }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedNode, setSelectedNode] = useState<NodeItem | null>(null);
  const overlays = useRealtimeStore((s) => s.overlays);
  const { t } = useTranslation();

  const rotYRef = useRef<number>(0.5);
  const rotXRef = useRef<number>(0.3);
  const isDraggingRef = useRef<boolean>(false);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const geoNodes = nodes.filter(
    (n) => n.geo?.lat != null && n.geo?.lon != null && !isNaN(n.geo.lat) && !isNaN(n.geo.lon)
  );

  function isOnline(node: NodeItem): boolean {
    const lastSeen = overlays[node.id]?.last_seen_at_ms ?? node.state?.last_seen_at_ms;
    return lastSeen ? Date.now() - lastSeen < 90 * 1000 : false;
  }

  // 3D Projection math: convert lat/lon to 3D Cartesian coordinates
  function project3D(lat: number, lon: number, radius: number, rotX: number, rotY: number) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180) + rotY;

    // Standard spherical coordinates
    let x = -radius * Math.sin(phi) * Math.cos(theta);
    let y = radius * Math.cos(phi);
    let z = radius * Math.sin(phi) * Math.sin(theta);

    // Rotate around X-axis (tilt)
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    const yRot = y * cosX - z * sinX;
    const zRot = y * sinX + z * cosX;

    return { x, y: yRot, z: zRot };
  }

  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let pulsePhase = 0;

    function render() {
      if (!canvas || !ctx) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.38;

      if (!isDraggingRef.current) {
        rotYRef.current += 0.002; // Smooth auto-rotation
      }
      pulsePhase += 0.04;

      const rotX = rotXRef.current;
      const rotY = rotYRef.current;

      // 1. Atmosphere Halo / Outer Glow Ring
      const glowGrad = ctx.createRadialGradient(centerX, centerY, radius * 0.95, centerX, centerY, radius * 1.15);
      glowGrad.addColorStop(0, 'rgba(0, 230, 118, 0.15)');
      glowGrad.addColorStop(1, 'rgba(0, 230, 118, 0.0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 1.15, 0, Math.PI * 2);
      ctx.fill();

      // 2. Earth Sphere Body
      ctx.fillStyle = '#0a0a0d';
      ctx.strokeStyle = '#22222a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 3. 3D Wireframe Latitude Parallels & Longitude Meridians
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 0.8;

      // Latitude Parallels
      [-60, -30, 0, 30, 60].forEach((lat) => {
        ctx.beginPath();
        for (let lon = -180; lon <= 180; lon += 5) {
          const pt = project3D(lat, lon, radius, rotX, rotY);
          const screenX = centerX + pt.x;
          const screenY = centerY - pt.y;
          if (pt.z >= 0) {
            if (lon === -180) ctx.moveTo(screenX, screenY);
            else ctx.lineTo(screenX, screenY);
          } else {
            ctx.moveTo(screenX, screenY);
          }
        }
        ctx.stroke();
      });

      // Longitude Meridians
      [-120, -60, 0, 60, 120, 180].forEach((lon) => {
        ctx.beginPath();
        for (let lat = -90; lat <= 90; lat += 5) {
          const pt = project3D(lat, lon, radius, rotX, rotY);
          const screenX = centerX + pt.x;
          const screenY = centerY - pt.y;
          if (pt.z >= 0) {
            if (lat === -90) ctx.moveTo(screenX, screenY);
            else ctx.lineTo(screenX, screenY);
          } else {
            ctx.moveTo(screenX, screenY);
          }
        }
        ctx.stroke();
      });

      // 4. Landmass Dot-Matrix Surface
      ctx.fillStyle = '#2a2a32';
      LAND_POINTS.forEach(([lat, lon]) => {
        const pt = project3D(lat, lon, radius, rotX, rotY);
        if (pt.z >= -10) {
          const alpha = Math.max(0.1, (pt.z + radius) / (radius * 2));
          const screenX = centerX + pt.x;
          const screenY = centerY - pt.y;
          ctx.fillStyle = `rgba(60, 60, 70, ${alpha})`;
          ctx.beginPath();
          ctx.arc(screenX, screenY, 2.0, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // 5. Active Telemetry Node Beacons in 3D
      geoNodes.forEach((node) => {
        const pt = project3D(node.geo.lat!, node.geo.lon!, radius, rotX, rotY);
        const screenX = centerX + pt.x;
        const screenY = centerY - pt.y;
        const online = isOnline(node);

        // Only draw visible front-facing nodes (z >= -5)
        if (pt.z >= -5) {
          // Pulsing Beacon Outer Ring
          if (online) {
            const pulseR = 5 + Math.sin(pulsePhase) * 4;
            ctx.strokeStyle = '#00e676';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(screenX, screenY, pulseR, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Beacon Solid Core
          ctx.fillStyle = online ? '#00e676' : '#e22718';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(screenX, screenY, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Label
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 11px Inter, sans-serif';
          ctx.fillText(node.name.toUpperCase(), screenX + 8, screenY + 4);
        }
      });

      animId = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [geoNodes, overlays]);

  // Mouse & Touch Drag Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isDraggingRef.current) {
      const deltaX = e.clientX - lastMouseRef.current.x;
      const deltaY = e.clientY - lastMouseRef.current.y;
      rotYRef.current += deltaX * 0.008;
      rotXRef.current = Math.max(-1.0, Math.min(1.0, rotXRef.current + deltaY * 0.008));
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Hover Node Hit Test
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;
    const radius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.38;

    let hovered: NodeItem | null = null;
    for (const node of geoNodes) {
      const pt = project3D(node.geo.lat!, node.geo.lon!, radius, rotXRef.current, rotYRef.current);
      if (pt.z >= -5) {
        const screenX = centerX + pt.x;
        const screenY = centerY - pt.y;
        const dist = Math.hypot(mouseX - screenX, mouseY - screenY);
        if (dist < 15) {
          hovered = node;
          break;
        }
      }
    }

    if (hovered !== selectedNode) {
      setSelectedNode(hovered);
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '400px', cursor: 'grab' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Floating Mission Radar Tooltip */}
      {selectedNode && (
        <div
          className="radar-tooltip"
          style={{
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            backgroundColor: 'var(--colors-surface-card)',
            border: '1px solid var(--colors-hairline)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            zIndex: 10,
          }}
        >
          <span className="button-cap" style={{ fontWeight: 700, fontSize: '14px', color: '#ffffff' }}>
            {selectedNode.name}
          </span>
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
  );
};
