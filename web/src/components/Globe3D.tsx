import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { NodeItem } from '../api/client';
import { useRealtimeStore } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';

interface Globe3DProps {
  nodes: NodeItem[];
  mode?: '3d' | '2d';
}

// 400+ Sampled Landmass Coordinates for Morphing 3D/2D Dot-Matrix Rendering
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

export const Globe3D: React.FC<Globe3DProps> = ({ nodes, mode = '3d' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedNode, setSelectedNode] = useState<NodeItem | null>(null);
  const overlays = useRealtimeStore((s) => s.overlays);
  const { t } = useTranslation();

  const rotYRef = useRef<number>(0.5);
  const rotXRef = useRef<number>(0.2);
  const morphRef = useRef<number>(mode === '2d' ? 1 : 0);
  const isDraggingRef = useRef<boolean>(false);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const geoNodes = nodes.filter(
    (n) => n.geo?.lat != null && n.geo?.lon != null && !isNaN(n.geo.lat) && !isNaN(n.geo.lon)
  );

  function isOnline(node: NodeItem): boolean {
    const lastSeen = overlays[node.id]?.last_seen_at_ms ?? node.state?.last_seen_at_ms;
    return lastSeen ? Date.now() - lastSeen < 90 * 1000 : false;
  }

  // Continuous Morphing 3D Sphere <-> 2D Flat Map Projection Math
  function projectMorphed(
    lat: number,
    lon: number,
    radius: number,
    rotX: number,
    rotY: number,
    morph: number,
    centerX: number,
    centerY: number
  ) {
    // Ease-in-ease-out S-curve for smooth unroll
    const ease = (1 - Math.cos(morph * Math.PI)) / 2;

    // 1. 3D Spherical Position
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180) + rotY;

    const x3dRaw = -radius * Math.sin(phi) * Math.cos(theta);
    const y3dRaw = radius * Math.cos(phi);
    const z3dRaw = radius * Math.sin(phi) * Math.sin(theta);

    // Apply X-tilt (rotX)
    const cosX = Math.cos(rotX * (1 - ease));
    const sinX = Math.sin(rotX * (1 - ease));
    const x3d = x3dRaw;
    const y3d = y3dRaw * cosX - z3dRaw * sinX;
    const z3d = y3dRaw * sinX + z3dRaw * cosX;

    // 2. 2D Flat Rectangular Position
    const flatWidth = radius * 2.3;
    const flatHeight = radius * 1.15;
    const x2d = (lon / 180) * flatWidth;
    const y2d = (lat / 90) * flatHeight;
    const z2d = 0;

    // 3. Morph Linear Blend
    const xMorphed = (1 - ease) * x3d + ease * x2d;
    const yMorphed = (1 - ease) * y3d + ease * y2d;
    const zMorphed = (1 - ease) * z3d + ease * z2d;

    const screenX = centerX + xMorphed;
    const screenY = centerY - yMorphed;

    // Visibility & Backface Culling during Morph
    const visible = z3d >= -20 || ease > 0.35;
    const alpha = Math.min(1.0, Math.max(0.15, (z3d + radius) / (radius * 2) + ease * 0.7));

    return { x: screenX, y: screenY, z: zMorphed, alpha, visible };
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
      const radius = Math.min(width, height) * 0.36;

      // Target morph interpolation (0 = 3D Sphere, 1 = 2D Map)
      const targetMorph = mode === '2d' ? 1.0 : 0.0;
      morphRef.current += (targetMorph - morphRef.current) * 0.06;
      const morph = morphRef.current;

      if (!isDraggingRef.current && morph < 0.8) {
        rotYRef.current += 0.002 * (1 - morph); // Slow spin when in 3D
      }
      pulsePhase += 0.04;

      const rotX = rotXRef.current;
      const rotY = rotYRef.current;

      // 1. Outer Atmosphere Glow Ring (fades out as map unfolds into 2D)
      if (morph < 0.95) {
        const glowAlpha = (1 - morph) * 0.15;
        const glowGrad = ctx.createRadialGradient(
          centerX,
          centerY,
          radius * 0.95,
          centerX,
          centerY,
          radius * 1.15
        );
        glowGrad.addColorStop(0, `rgba(0, 230, 118, ${glowAlpha})`);
        glowGrad.addColorStop(1, 'rgba(0, 230, 118, 0.0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 1.15, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Base Sphere / Flat Chassis Fill
      ctx.fillStyle = '#0a0a0d';
      ctx.strokeStyle = `rgba(34, 34, 42, ${1 - morph * 0.5})`;
      ctx.lineWidth = 1.5;

      if (morph < 0.05) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // 3. Morphing 3D/2D Wireframe Grid Lines
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 + morph * 0.04})`;
      ctx.lineWidth = 0.8;

      // Latitude Parallels
      [-60, -30, 0, 30, 60].forEach((lat) => {
        ctx.beginPath();
        for (let lon = -180; lon <= 180; lon += 5) {
          const pt = projectMorphed(lat, lon, radius, rotX, rotY, morph, centerX, centerY);
          if (pt.visible) {
            if (lon === -180) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          } else {
            ctx.moveTo(pt.x, pt.y);
          }
        }
        ctx.stroke();
      });

      // Longitude Meridians
      [-120, -60, 0, 60, 120, 180].forEach((lon) => {
        ctx.beginPath();
        for (let lat = -90; lat <= 90; lat += 5) {
          const pt = projectMorphed(lat, lon, radius, rotX, rotY, morph, centerX, centerY);
          if (pt.visible) {
            if (lat === -90) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          } else {
            ctx.moveTo(pt.x, pt.y);
          }
        }
        ctx.stroke();
      });

      // 4. Morphing Landmass Dot-Matrix
      LAND_POINTS.forEach(([lat, lon]) => {
        const pt = projectMorphed(lat, lon, radius, rotX, rotY, morph, centerX, centerY);
        if (pt.visible) {
          ctx.fillStyle = `rgba(80, 80, 95, ${pt.alpha})`;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.0, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // 5. Morphing Active Telemetry Node Beacons
      geoNodes.forEach((node) => {
        const pt = projectMorphed(
          node.geo.lat!,
          node.geo.lon!,
          radius,
          rotX,
          rotY,
          morph,
          centerX,
          centerY
        );
        const online = isOnline(node);

        if (pt.visible) {
          // Pulsing Beacon Outer Ring
          if (online) {
            const pulseR = 5 + Math.sin(pulsePhase) * 4;
            ctx.strokeStyle = '#00e676';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pulseR, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Beacon Solid Core
          ctx.fillStyle = online ? '#00e676' : '#e22718';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Label
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 11px Inter, sans-serif';
          ctx.fillText(node.name.toUpperCase(), pt.x + 8, pt.y + 4);
        }
      });

      animId = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [geoNodes, overlays, mode]);

  // Mouse & Touch Drag Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isDraggingRef.current && mode === '3d') {
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
    const radius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.36;

    let hovered: NodeItem | null = null;
    for (const node of geoNodes) {
      const pt = projectMorphed(
        node.geo.lat!,
        node.geo.lon!,
        radius,
        rotXRef.current,
        rotYRef.current,
        morphRef.current,
        centerX,
        centerY
      );
      if (pt.visible) {
        const dist = Math.hypot(mouseX - pt.x, mouseY - pt.y);
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
    <div style={{ position: 'relative', width: '100%', height: '400px', cursor: mode === '3d' ? 'grab' : 'default' }}>
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
