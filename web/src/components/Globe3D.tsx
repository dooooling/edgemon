import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NodeItem } from '../api/client';
import { useRealtimeStore } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';
import { CountryFlag } from './CountryFlag';
import { OsIcon } from './OsIcon';
import { WORLD_POLYGONS, MAJOR_REGIONS, LAND_POINTS } from './world-geo-data';

interface Globe3DProps {
  nodes: NodeItem[];
  mode?: '3d' | '2d';
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2) + ' TB';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function formatBps(bps?: number | null): string {
  if (!bps || bps <= 0) return '0 B/s';
  if (bps >= 1024 * 1024) return (bps / (1024 * 1024)).toFixed(1) + ' MB/s';
  if (bps >= 1024) return (bps / 1024).toFixed(0) + ' KB/s';
  return bps.toFixed(0) + ' B/s';
}

function formatUptime(uptimeSec?: number | null): string {
  if (!uptimeSec || uptimeSec <= 0) return 'N/A';
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// Great Circle Geodesic Interpolation for Flight Telemetry Arcs
function interpolateGreatCircle(lat1: number, lon1: number, lat2: number, lon2: number, t: number): [number, number] {
  const phi1 = (lat1 * Math.PI) / 180;
  const lam1 = (lon1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const lam2 = (lon2 * Math.PI) / 180;

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((phi1 - phi2) / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam1 - lam2) / 2) ** 2
    )
  );

  if (d < 0.001) return [lat1, lon1];

  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);

  const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
  const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
  const z = A * Math.sin(phi1) + B * Math.sin(phi2);

  const lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  return [lat, lon];
}

export const Globe3D: React.FC<Globe3DProps> = ({ nodes, mode = '3d' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const [tooltipData, setTooltipData] = useState<{ node: NodeItem; x: number; y: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(100);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
  const overlays = useRealtimeStore((s) => s.overlays);
  const { t } = useTranslation();

  const rotYRef = useRef<number>(0.5);
  const rotXRef = useRef<number>(0.2);
  const panXRef = useRef<number>(0);
  const panYRef = useRef<number>(0);
  const targetPanXRef = useRef<number>(0);
  const targetPanYRef = useRef<number>(0);
  const scaleRef = useRef<number>(1.0);
  const targetScaleRef = useRef<number>(1.0);
  const morphRef = useRef<number>(mode === '2d' ? 1 : 0);
  const isDraggingRef = useRef<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
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

    const visible = z3d >= -20 || ease > 0.35;
    const alpha = Math.min(1.0, Math.max(0.12, (z3d + radius) / (radius * 2) + ease * 0.7));

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

      // Apply Zoom Scale Interpolation
      scaleRef.current += (targetScaleRef.current - scaleRef.current) * 0.12;
      const scale = scaleRef.current;
      const baseRadius = Math.min(width, height) * 0.36;
      const radius = baseRadius * scale;

      // Target morph interpolation (0 = 3D Sphere, 1 = 2D Map)
      const targetMorph = mode === '2d' ? 1.0 : 0.0;
      morphRef.current += (targetMorph - morphRef.current) * 0.06;
      const morph = morphRef.current;

      // Strict Dynamic Pan Boundary Clamping
      if (morph > 0.3) {
        const flatHalfWidth = radius * 2.3;
        const flatHalfHeight = radius * 1.15;
        const maxPanX = Math.max(0, flatHalfWidth - width / 2 + 24);
        const maxPanY = Math.max(0, flatHalfHeight - height / 2 + 24);

        targetPanXRef.current = Math.max(-maxPanX, Math.min(maxPanX, targetPanXRef.current));
        targetPanYRef.current = Math.max(-maxPanY, Math.min(maxPanY, targetPanYRef.current));
      } else {
        targetPanXRef.current = 0;
        targetPanYRef.current = 0;
      }

      // Smooth pan interpolation
      panXRef.current += (targetPanXRef.current - panXRef.current) * 0.2;
      panYRef.current += (targetPanYRef.current - panYRef.current) * 0.2;

      const centerX = width / 2 + panXRef.current;
      const centerY = height / 2 + panYRef.current;

      if (!isDraggingRef.current && morph < 0.8) {
        rotYRef.current += 0.0018 * (1 - morph); // Subtle rotation when in 3D
      }
      pulsePhase += 0.035;

      const rotX = rotXRef.current;
      const rotY = rotYRef.current;

      // 1. Atmosphere Halo Gradient
      if (morph < 0.95) {
        const glowAlpha = (1 - morph) * 0.18;
        const glowGrad = ctx.createRadialGradient(
          centerX,
          centerY,
          radius * 0.92,
          centerX,
          centerY,
          radius * 1.18
        );
        glowGrad.addColorStop(0, `rgba(0, 150, 255, ${glowAlpha})`);
        glowGrad.addColorStop(0.6, `rgba(0, 230, 118, ${glowAlpha * 0.5})`);
        glowGrad.addColorStop(1, 'rgba(0, 150, 255, 0.0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 1.18, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Base Sphere / Ocean Fill
      if (morph < 0.1) {
        ctx.fillStyle = '#06070a';
        ctx.strokeStyle = 'rgba(0, 102, 177, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // 3. Coordinate Graticule Grid Lines & Degrees
      // Latitude Parallels
      [-60, -30, 0, 30, 60].forEach((lat) => {
        const isEquator = lat === 0;
        ctx.strokeStyle = isEquator
          ? `rgba(0, 230, 118, ${0.15 + morph * 0.1})`
          : `rgba(255, 255, 255, ${0.04 + morph * 0.03})`;
        ctx.lineWidth = isEquator ? 1.0 : 0.6;
        if (isEquator) ctx.setLineDash([6, 4]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 4) {
          const pt = projectMorphed(lat, lon, radius, rotX, rotY, morph, centerX, centerY);
          if (pt.visible) {
            if (!started) {
              ctx.moveTo(pt.x, pt.y);
              started = true;
            } else {
              ctx.lineTo(pt.x, pt.y);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Degree label along Prime Meridian
        const labelPt = projectMorphed(lat, 0, radius, rotX, rotY, morph, centerX, centerY);
        if (labelPt.visible && labelPt.alpha > 0.4) {
          ctx.fillStyle = `rgba(140, 150, 170, ${labelPt.alpha * 0.5})`;
          ctx.font = '600 8px monospace';
          ctx.fillText(lat === 0 ? 'EQ 0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`, labelPt.x + 3, labelPt.y - 2);
        }
      });

      // Longitude Meridians
      [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].forEach((lon) => {
        const isPrime = lon === 0;
        ctx.strokeStyle = isPrime
          ? `rgba(0, 150, 255, ${0.18 + morph * 0.1})`
          : `rgba(255, 255, 255, ${0.04 + morph * 0.03})`;
        ctx.lineWidth = isPrime ? 1.0 : 0.6;
        if (isPrime) ctx.setLineDash([6, 4]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        let started = false;
        for (let lat = -88; lat <= 88; lat += 4) {
          const pt = projectMorphed(lat, lon, radius, rotX, rotY, morph, centerX, centerY);
          if (pt.visible) {
            if (!started) {
              ctx.moveTo(pt.x, pt.y);
              started = true;
            } else {
              ctx.lineTo(pt.x, pt.y);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // 4. High-Precision Vector World Coastline Polygons
      WORLD_POLYGONS.forEach((poly) => {
        ctx.fillStyle = `rgba(0, 102, 177, ${0.07 + morph * 0.05})`; // Deep Blue Fill
        ctx.strokeStyle = `rgba(0, 160, 255, ${0.45 + morph * 0.25})`; // Bright Vector Outline
        ctx.lineWidth = 1.1;

        ctx.beginPath();
        let pathStarted = false;
        poly.points.forEach(([lat, lon]) => {
          const pt = projectMorphed(lat, lon, radius, rotX, rotY, morph, centerX, centerY);
          if (pt.visible) {
            if (!pathStarted) {
              ctx.moveTo(pt.x, pt.y);
              pathStarted = true;
            } else {
              ctx.lineTo(pt.x, pt.y);
            }
          }
        });
        if (pathStarted) {
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      });

      // 5. Morphing 500+ Landmass Tactical Dot-Matrix Point Cloud
      LAND_POINTS.forEach(([lat, lon]) => {
        const pt = projectMorphed(lat, lon, radius, rotX, rotY, morph, centerX, centerY);
        if (pt.visible) {
          ctx.fillStyle = `rgba(130, 160, 200, ${pt.alpha * 0.85})`;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // 6. Major Continental / Ocean Region Labels
      MAJOR_REGIONS.forEach((reg) => {
        const pt = projectMorphed(reg.lat, reg.lon, radius, rotX, rotY, morph, centerX, centerY);
        if (pt.visible && pt.alpha > 0.35) {
          ctx.fillStyle = `rgba(160, 180, 210, ${pt.alpha * 0.7})`;
          ctx.font = '700 9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(reg.name, pt.x, pt.y);
          ctx.textAlign = 'left';
        }
      });

      // 7. Inter-Node Geodesic Telemetry Arcs & Photon Pulses
      const onlineNodes = geoNodes.filter(isOnline);
      if (onlineNodes.length >= 2) {
        for (let i = 0; i < onlineNodes.length; i++) {
          for (let j = i + 1; j < onlineNodes.length; j++) {
            const nodeA = onlineNodes[i];
            const nodeB = onlineNodes[j];

            ctx.strokeStyle = 'rgba(0, 230, 118, 0.22)';
            ctx.lineWidth = 1.0;
            ctx.setLineDash([4, 4]);

            ctx.beginPath();
            let arcStarted = false;
            const steps = 24;
            const arcPts: Array<{ x: number; y: number; visible: boolean }> = [];

            for (let s = 0; s <= steps; s++) {
              const tStep = s / steps;
              const [arcLat, arcLon] = interpolateGreatCircle(
                nodeA.geo.lat!,
                nodeA.geo.lon!,
                nodeB.geo.lat!,
                nodeB.geo.lon!,
                tStep
              );
              const pt = projectMorphed(arcLat, arcLon, radius, rotX, rotY, morph, centerX, centerY);
              arcPts.push(pt);

              if (pt.visible) {
                if (!arcStarted) {
                  ctx.moveTo(pt.x, pt.y);
                  arcStarted = true;
                } else {
                  ctx.lineTo(pt.x, pt.y);
                }
              }
            }
            if (arcStarted) {
              ctx.stroke();
            }
            ctx.setLineDash([]);

            // Animated Travelling Photon Pulse along the telemetry arc
            const pulseT = ((pulsePhase * 0.25 + i * 0.3 + j * 0.2) % 1.0);
            const [photonLat, photonLon] = interpolateGreatCircle(
              nodeA.geo.lat!,
              nodeA.geo.lon!,
              nodeB.geo.lat!,
              nodeB.geo.lon!,
              pulseT
            );
            const photonPt = projectMorphed(photonLat, photonLon, radius, rotX, rotY, morph, centerX, centerY);
            if (photonPt.visible) {
              ctx.fillStyle = '#00e676';
              ctx.shadowColor = '#00e676';
              ctx.shadowBlur = 8;
              ctx.beginPath();
              ctx.arc(photonPt.x, photonPt.y, 2.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.shadowBlur = 0;
            }
          }
        }
      }

      // 8. Active Telemetry Node Beacons with Radar Waves
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
          if (online) {
            // Concentric Expanding Radar Waves
            const wave1 = 6 + (pulsePhase * 4) % 14;
            const alpha1 = Math.max(0, 1 - wave1 / 20);
            ctx.strokeStyle = `rgba(0, 230, 118, ${alpha1 * 0.8})`;
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, wave1, 0, Math.PI * 2);
            ctx.stroke();

            const wave2 = 6 + ((pulsePhase * 4 + 7) % 14);
            const alpha2 = Math.max(0, 1 - wave2 / 20);
            ctx.strokeStyle = `rgba(0, 230, 118, ${alpha2 * 0.6})`;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, wave2, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Beacon Solid Core
          ctx.fillStyle = online ? '#00e676' : '#e22718';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Node Name & CF Colo Airport Tag
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 11px Inter, sans-serif';
          const coloTag = node.geo?.colo ? ` [${node.geo.colo}]` : '';
          ctx.fillText(`${node.name.toUpperCase()}${coloTag}`, pt.x + 9, pt.y + 4);
        }
      });

      // 9. Tactical Telemetry HUD Legends & Crosshairs
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '700 9px monospace';
      ctx.fillText('COORD SYS: WGS-84 // INCLINATION 23.5°', 16, height - 16);
      ctx.fillText(`ACTIVE BEACONS: ${onlineNodes.length} / ${nodes.length}`, width - 180, height - 16);

      animId = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [geoNodes, overlays, mode, nodes.length]);

  // Native Non-Passive Wheel Event Listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(0.6, Math.min(2.5, targetScaleRef.current * zoomFactor));
      targetScaleRef.current = newScale;
      setCurrentZoom(Math.round(newScale * 100));
    };

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

  const handleZoomIn = () => {
    const newScale = Math.min(2.5, targetScaleRef.current * 1.25);
    targetScaleRef.current = newScale;
    setCurrentZoom(Math.round(newScale * 100));
  };

  const handleZoomOut = () => {
    const newScale = Math.max(0.6, targetScaleRef.current / 1.25);
    targetScaleRef.current = newScale;
    setCurrentZoom(Math.round(newScale * 100));
  };

  const handleZoomReset = () => {
    targetScaleRef.current = 1.0;
    targetPanXRef.current = 0;
    targetPanYRef.current = 0;
    setCurrentZoom(100);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isDraggingRef.current) {
      const deltaX = e.clientX - lastMouseRef.current.x;
      const deltaY = e.clientY - lastMouseRef.current.y;

      if (mode === '3d' && morphRef.current < 0.5) {
        rotYRef.current += deltaX * 0.008;
        rotXRef.current = Math.max(-1.0, Math.min(1.0, rotXRef.current + deltaY * 0.008));
      } else {
        const baseRadius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.36;
        const radius = baseRadius * scaleRef.current;
        const flatHalfWidth = radius * 2.3;
        const flatHalfHeight = radius * 1.15;

        const maxPanX = Math.max(0, flatHalfWidth - canvas.clientWidth / 2 + 24);
        const maxPanY = Math.max(0, flatHalfHeight - canvas.clientHeight / 2 + 24);

        if (maxPanX > 0 || maxPanY > 0) {
          const nextPanX = targetPanXRef.current + deltaX;
          const nextPanY = targetPanYRef.current + deltaY;
          targetPanXRef.current = Math.max(-maxPanX, Math.min(maxPanX, nextPanX));
          targetPanYRef.current = Math.max(-maxPanY, Math.min(maxPanY, nextPanY));
        }
      }
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Hover Node Hit Test
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const centerX = canvas.clientWidth / 2 + panXRef.current;
    const centerY = canvas.clientHeight / 2 + panYRef.current;
    const radius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.36 * scaleRef.current;

    // Calculate Geographic Cursor Coordinates
    const flatWidth = radius * 2.3;
    const flatHeight = radius * 1.15;
    const calcLon = ((mouseX - centerX) / flatWidth) * 180;
    const calcLat = ((centerY - mouseY) / flatHeight) * 90;
    if (Math.abs(calcLat) <= 90 && Math.abs(calcLon) <= 180) {
      setCursorCoords({ lat: calcLat, lon: calcLon });
    } else {
      setCursorCoords(null);
    }

    let hovered: { node: NodeItem; x: number; y: number } | null = null;
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
        if (dist < 18) {
          hovered = { node, x: pt.x, y: pt.y };
          break;
        }
      }
    }

    if (hovered?.node.id !== tooltipData?.node.id) {
      setTooltipData(hovered);
    } else if (hovered && tooltipData && (Math.abs(hovered.x - tooltipData.x) > 3 || Math.abs(hovered.y - tooltipData.y) > 3)) {
      setTooltipData(hovered);
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
    setTooltipData(null);
    setCursorCoords(null);
  };

  const handleCanvasDoubleClick = () => {
    if (tooltipData?.node) {
      navigate(`/node/${tooltipData.node.id}`);
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '420px',
        cursor: isDragging ? 'grabbing' : (tooltipData ? 'pointer' : 'grab'),
        touchAction: 'none',
        backgroundColor: '#030305',
        border: '1px solid var(--colors-hairline)',
        overflow: 'hidden',
      }}
    >
      {/* Zoom Control Buttons */}
      <div
        className="range-capsules"
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          zIndex: 10,
        }}
      >
        <button className="range-capsule-btn" onClick={handleZoomIn} title="Zoom In">
          +
        </button>
        <button className="range-capsule-btn" onClick={handleZoomOut} title="Zoom Out">
          -
        </button>
        <button className="range-capsule-btn" onClick={handleZoomReset} title="Reset View">
          {currentZoom}%
        </button>
      </div>

      {/* Real-time Cursor Coordinates Readout */}
      {cursorCoords && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            zIndex: 10,
            fontSize: '11px',
            fontFamily: 'monospace',
            color: 'rgba(255, 255, 255, 0.7)',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '4px 10px',
            border: '1px solid var(--colors-hairline)',
            pointerEvents: 'none',
          }}
        >
          TARGET: {Math.abs(cursorCoords.lat).toFixed(1)}°{cursorCoords.lat >= 0 ? 'N' : 'S'},{' '}
          {Math.abs(cursorCoords.lon).toFixed(1)}°{cursorCoords.lon >= 0 ? 'E' : 'W'}
        </div>
      )}

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleCanvasDoubleClick}
      />

      {/* Dynamic Anchored Mission Radar Tooltip with Rich Telemetry */}
      {tooltipData && (() => {
        const node = tooltipData.node;
        const overlay = overlays[node.id];
        const online = isOnline(node);
        const cpuPct = overlay?.cpu_usage_pct ?? node.state?.cpu_usage_pct;
        const cpuCores = node.resources?.cpu_capacity_cores || 1;
        const memoryUsed = overlay?.memory_used_bytes ?? node.state?.memory_used_bytes;
        const memoryLimit = node.resources?.memory_limit_bytes;
        const rootfsUsed = overlay?.rootfs_used_bytes ?? node.state?.rootfs_used_bytes;
        const rootfsLimit = node.resources?.rootfs_limit_bytes;
        const rxBps = overlay?.rx_bps ?? node.state?.rx_bps;
        const txBps = overlay?.tx_bps ?? node.state?.tx_bps;
        const rttMs = overlay?.edge_rtt_ms ?? node.state?.edge_rtt_ms;
        const uptimeSec = overlay?.uptime_sec ?? node.state?.uptime_sec;

        return (
          <div
            className="radar-tooltip"
            style={{
              position: 'absolute',
              left: `${tooltipData.x}px`,
              top: `${tooltipData.y}px`,
              transform: `translate(${
                tooltipData.x > (canvasRef.current?.clientWidth || 800) - 250 ? '-105%' : '14px'
              }, ${
                tooltipData.y < 160 ? '14px' : '-105%'
              })`,
              backgroundColor: 'rgba(8, 8, 12, 0.96)',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--colors-hairline)',
              borderRadius: '6px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              zIndex: 20,
              pointerEvents: 'auto',
              minWidth: '210px',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.9)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
            onDoubleClick={() => navigate(`/node/${node.id}`)}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '13px', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CountryFlag countryCode={node.geo?.country} />
                <span>{node.name}</span>
              </span>
              <span className="status-indicator-beacon" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span className={`beacon-dot ${online ? 'beacon-live' : 'beacon-idle'}`}></span>
                <span style={{ fontSize: '10px', color: online ? 'var(--colors-status-live)' : 'var(--colors-on-primary-mute)' }}>
                  {online ? t('node_online') : t('node_offline')}
                </span>
              </span>
            </div>

            {/* System & Geo Subtext */}
            <div style={{ fontSize: '11px', color: 'var(--colors-on-primary-mute)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <OsIcon os={node.system?.os} osVersion={node.system?.os_version} size={12} />
              <span>{node.system?.os || 'Linux'} · {node.geo?.city || node.geo?.country || 'COLO'} ({node.geo?.colo || 'CF'})</span>
            </div>

            {/* Telemetry Metrics Stack */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '6px', fontSize: '11px' }}>
              {/* CPU */}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--colors-on-primary-mute)' }}>CPU ({cpuCores}C)</span>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>{online && cpuPct != null ? `${cpuPct}%` : 'N/A'}</span>
              </div>

              {/* RAM */}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--colors-on-primary-mute)' }}>RAM</span>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>
                  {online && memoryUsed ? `${formatBytes(memoryUsed)}${memoryLimit ? ` / ${formatBytes(memoryLimit)}` : ''}` : 'N/A'}
                </span>
              </div>

              {/* DISK */}
              {rootfsLimit && rootfsLimit > 0 ? (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--colors-on-primary-mute)' }}>DISK</span>
                  <span style={{ color: '#ffffff', fontWeight: 600 }}>
                    {rootfsUsed ? `${formatBytes(rootfsUsed)} / ${formatBytes(rootfsLimit)}` : `${formatBytes(rootfsLimit)} TOTAL`}
                  </span>
                </div>
              ) : null}

              {/* NET Speed */}
              {online && (rxBps != null || txBps != null) ? (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--colors-on-primary-mute)' }}>NET</span>
                  <span style={{ color: 'var(--colors-status-live)', fontWeight: 600 }}>
                    ↓ {formatBps(rxBps)} · ↑ {formatBps(txBps)}
                  </span>
                </div>
              ) : null}

              {/* RTT & Uptime */}
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--colors-on-primary-mute)', fontSize: '10px', marginTop: '2px' }}>
                <span>RTT: <strong style={{ color: rttMs ? 'var(--colors-status-live)' : 'inherit' }}>{rttMs ? `${rttMs} ms` : 'N/A'}</strong></span>
                <span>UP: <strong style={{ color: '#ffffff' }}>{formatUptime(uptimeSec)}</strong></span>
              </div>
            </div>

            {/* Double Click Hint */}
            <div style={{ fontSize: '9px', color: 'var(--colors-on-primary-mute)', textAlign: 'center', marginTop: '2px', opacity: 0.8 }}>
              ⚡ DOUBLE CLICK TO INSPECT
            </div>
          </div>
        );
      })()}
    </div>
  );
};
