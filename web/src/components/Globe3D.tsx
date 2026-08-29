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
  mode?: '3d' | 'sandtable' | '2d';
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

  // Multi-Morph Continuous Weights (Globe, Sandtable, 2D Flat Map)
  const wGRef = useRef<number>(mode === '3d' ? 1 : 0);
  const wSRef = useRef<number>(mode === 'sandtable' ? 1 : 0);
  const wFRef = useRef<number>(mode === '2d' ? 1 : 0);

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

  // Unified 3D Globe <-> 3D Tactical Sandtable <-> 2D Flat Map Projection Math
  function projectMorphed(
    lat: number,
    lon: number,
    radius: number,
    rotX: number,
    rotY: number,
    wG: number,
    wS: number,
    wF: number,
    centerX: number,
    centerY: number,
    altitude = 0
  ) {
    // 1. 3D Globe Spherical Position
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180) + rotY;

    const rTotal = radius + altitude;
    const x3dRaw = -rTotal * Math.sin(phi) * Math.cos(theta);
    const y3dRaw = rTotal * Math.cos(phi);
    const z3dRaw = rTotal * Math.sin(phi) * Math.sin(theta);

    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    const x3d = x3dRaw;
    const y3d = y3dRaw * cosX - z3dRaw * sinX;
    const z3d = y3dRaw * sinX + z3dRaw * cosX;

    // 2. 3D Tactical Sandtable Position (Isometric Pitch & Extruded Altitude)
    const flatWidth = radius * 2.2;
    const flatHeight = radius * 1.1;
    const xPlan = (lon / 180) * flatWidth;
    const yPlan = (lat / 90) * flatHeight;

    const sandPitch = 1.05 + rotX * 0.45; // ~60 degree tilt
    const cosSandY = Math.cos(rotY * 0.6);
    const sinSandY = Math.sin(rotY * 0.6);

    const xRot = xPlan * cosSandY - yPlan * sinSandY;
    const yRot = xPlan * sinSandY + yPlan * cosSandY;

    const cosPitch = Math.cos(sandPitch);
    const sinPitch = Math.sin(sandPitch);

    const xSandRaw = xRot;
    const ySandRaw = yRot * cosPitch - altitude;
    const zSandRaw = yRot * sinPitch;

    const focalLength = radius * 3.2;
    const perspective = focalLength / (focalLength + zSandRaw * 0.5);

    const xSand = xSandRaw * perspective;
    const ySand = ySandRaw * perspective;
    const zSand = zSandRaw;

    // 3. 2D Flat Plan Position
    const x2d = (lon / 180) * (radius * 2.3);
    const y2d = (lat / 90) * (radius * 1.15) + altitude * 0.5;
    const z2d = 0;

    // 4. Weighted Linear Blend
    const screenX = centerX + (wG * x3d + wS * xSand + wF * x2d);
    const screenY = centerY - (wG * y3d + wS * ySand + wF * y2d);
    const zMorphed = wG * z3d + wS * zSand + wF * z2d;

    const visible = (wG * (z3d >= -20 ? 1 : 0) + (wS + wF)) > 0.35 || z3d >= -20;
    const alpha = Math.min(1.0, Math.max(0.12, ((z3d + radius) / (radius * 2)) * wG + (wS + wF) * 0.9));

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
      const baseRadius = Math.min(width, height) * 0.35;
      const radius = baseRadius * scale;

      // Multi-Morph Target Weight Interpolation
      const targetWG = mode === '3d' ? 1.0 : 0.0;
      const targetWS = mode === 'sandtable' ? 1.0 : 0.0;
      const targetWF = mode === '2d' ? 1.0 : 0.0;

      wGRef.current += (targetWG - wGRef.current) * 0.08;
      wSRef.current += (targetWS - wSRef.current) * 0.08;
      wFRef.current += (targetWF - wFRef.current) * 0.08;

      const wG = wGRef.current;
      const wS = wSRef.current;
      const wF = wFRef.current;

      // Strict Dynamic Pan Boundary Clamping
      if (wF > 0.5 || wS > 0.5) {
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
      const centerY = height / 2 + panYRef.current + wS * (radius * 0.15);

      if (!isDraggingRef.current) {
        if (wG > 0.5) rotYRef.current += 0.0018 * wG; // Globe spin
        if (wS > 0.5) rotYRef.current += 0.001 * wS;  // Sandtable slow orbit
      }
      pulsePhase += 0.035;

      const rotX = rotXRef.current;
      const rotY = rotYRef.current;

      // 1. Atmosphere Halo (Globe Mode)
      if (wG > 0.05) {
        const glowAlpha = wG * 0.18;
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

      // 2. 3D Sandtable Command Platform Base (Pedestal & Floor Grid)
      if (wS > 0.05) {
        const baseAlpha = wS;
        const cornerNW = projectMorphed(80, -175, radius, rotX, rotY, wG, wS, wF, centerX, centerY, -4);
        const cornerNE = projectMorphed(80, 175, radius, rotX, rotY, wG, wS, wF, centerX, centerY, -4);
        const cornerSE = projectMorphed(-75, 175, radius, rotX, rotY, wG, wS, wF, centerX, centerY, -4);
        const cornerSW = projectMorphed(-75, -175, radius, rotX, rotY, wG, wS, wF, centerX, centerY, -4);

        // Ground Floor Fill
        ctx.fillStyle = `rgba(6, 8, 14, ${baseAlpha * 0.9})`;
        ctx.strokeStyle = `rgba(0, 150, 255, ${baseAlpha * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cornerNW.x, cornerNW.y);
        ctx.lineTo(cornerNE.x, cornerNE.y);
        ctx.lineTo(cornerSE.x, cornerSE.y);
        ctx.lineTo(cornerSW.x, cornerSW.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Floor Extrusion Depth (Bottom Edge Bevel)
        const bevelDepth = 12 * wS;
        ctx.fillStyle = `rgba(2, 4, 8, ${baseAlpha * 0.95})`;
        ctx.strokeStyle = `rgba(0, 102, 177, ${baseAlpha * 0.3})`;
        ctx.beginPath();
        ctx.moveTo(cornerSW.x, cornerSW.y);
        ctx.lineTo(cornerSE.x, cornerSE.y);
        ctx.lineTo(cornerSE.x, cornerSE.y + bevelDepth);
        ctx.lineTo(cornerSW.x, cornerSW.y + bevelDepth);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // 3. Globe Sphere Base Fill
      if (wG > 0.1) {
        ctx.fillStyle = '#06070a';
        ctx.strokeStyle = `rgba(0, 102, 177, ${wG * 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // 4. Coordinate Graticule Grid Lines
      [-60, -30, 0, 30, 60].forEach((lat) => {
        const isEquator = lat === 0;
        ctx.strokeStyle = isEquator
          ? `rgba(0, 230, 118, ${0.15 * wG + 0.25 * wS + 0.2 * wF})`
          : `rgba(255, 255, 255, ${0.04 * wG + 0.08 * wS + 0.05 * wF})`;
        ctx.lineWidth = isEquator ? 1.0 : 0.6;
        if (isEquator) ctx.setLineDash([6, 4]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 4) {
          const pt = projectMorphed(lat, lon, radius, rotX, rotY, wG, wS, wF, centerX, centerY, 0);
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

      [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].forEach((lon) => {
        const isPrime = lon === 0;
        ctx.strokeStyle = isPrime
          ? `rgba(0, 150, 255, ${0.18 * wG + 0.28 * wS + 0.2 * wF})`
          : `rgba(255, 255, 255, ${0.04 * wG + 0.08 * wS + 0.05 * wF})`;
        ctx.lineWidth = isPrime ? 1.0 : 0.6;
        if (isPrime) ctx.setLineDash([6, 4]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        let started = false;
        for (let lat = -85; lat <= 85; lat += 4) {
          const pt = projectMorphed(lat, lon, radius, rotX, rotY, wG, wS, wF, centerX, centerY, 0);
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

      // 5. 3D Sandtable Landmass Relief Extrusions & Topographic Plates
      const terrainHeight = 14 * wS; // 3D Extrusion Height on Sandtable

      // 5a. Extruded Landmass Vertical Side Walls (Sandtable 3D Relief)
      if (wS > 0.1) {
        WORLD_POLYGONS.forEach((poly) => {
          ctx.fillStyle = `rgba(0, 50, 90, ${wS * 0.45})`;
          ctx.strokeStyle = `rgba(0, 102, 177, ${wS * 0.35})`;
          ctx.lineWidth = 0.8;

          for (let i = 0; i < poly.points.length - 1; i++) {
            const [latA, lonA] = poly.points[i];
            const [latB, lonB] = poly.points[i + 1];

            const ptABase = projectMorphed(latA, lonA, radius, rotX, rotY, wG, wS, wF, centerX, centerY, 0);
            const ptATop = projectMorphed(latA, lonA, radius, rotX, rotY, wG, wS, wF, centerX, centerY, terrainHeight);
            const ptBTop = projectMorphed(latB, lonB, radius, rotX, rotY, wG, wS, wF, centerX, centerY, terrainHeight);
            const ptBBase = projectMorphed(latB, lonB, radius, rotX, rotY, wG, wS, wF, centerX, centerY, 0);

            if (ptABase.visible && ptBBase.visible) {
              ctx.beginPath();
              ctx.moveTo(ptABase.x, ptABase.y);
              ctx.lineTo(ptATop.x, ptATop.y);
              ctx.lineTo(ptBTop.x, ptBTop.y);
              ctx.lineTo(ptBBase.x, ptBBase.y);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
        });
      }

      // 5b. Top Elevated Landmass Polygons
      WORLD_POLYGONS.forEach((poly) => {
        ctx.fillStyle = `rgba(0, 102, 177, ${0.08 * wG + 0.22 * wS + 0.12 * wF})`;
        ctx.strokeStyle = `rgba(0, 180, 255, ${0.45 * wG + 0.75 * wS + 0.55 * wF})`;
        ctx.lineWidth = 1.1;

        ctx.beginPath();
        let pathStarted = false;
        poly.points.forEach(([lat, lon]) => {
          const pt = projectMorphed(lat, lon, radius, rotX, rotY, wG, wS, wF, centerX, centerY, terrainHeight);
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

      // 6. Tactical Dot-Matrix Mesh (Elevated on Sandtable)
      LAND_POINTS.forEach(([lat, lon]) => {
        const pt = projectMorphed(lat, lon, radius, rotX, rotY, wG, wS, wF, centerX, centerY, terrainHeight);
        if (pt.visible) {
          ctx.fillStyle = `rgba(130, 180, 230, ${pt.alpha * (0.75 + wS * 0.25)})`;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.4 + wS * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // 7. Major Region Labels
      MAJOR_REGIONS.forEach((reg) => {
        const pt = projectMorphed(reg.lat, reg.lon, radius, rotX, rotY, wG, wS, wF, centerX, centerY, terrainHeight + 4);
        if (pt.visible && pt.alpha > 0.35) {
          ctx.fillStyle = `rgba(180, 210, 240, ${pt.alpha * 0.75})`;
          ctx.font = '700 9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(reg.name, pt.x, pt.y);
          ctx.textAlign = 'left';
        }
      });

      // 8. 3D Laser Light Pillars & Elevation Beacons (Sandtable Hologram Effect)
      const onlineNodes = geoNodes.filter(isOnline);
      const pillarAltitude = 38 * wS; // Laser pillar height

      geoNodes.forEach((node) => {
        const online = isOnline(node);
        const ptGround = projectMorphed(node.geo.lat!, node.geo.lon!, radius, rotX, rotY, wG, wS, wF, centerX, centerY, terrainHeight);
        const ptTop = projectMorphed(node.geo.lat!, node.geo.lon!, radius, rotX, rotY, wG, wS, wF, centerX, centerY, terrainHeight + pillarAltitude);

        if (ptGround.visible) {
          // 8a. Concentric Radar Scan Rings on Ground
          if (online) {
            const wave1 = 6 + (pulsePhase * 4) % 14;
            const alpha1 = Math.max(0, 1 - wave1 / 20);
            ctx.strokeStyle = `rgba(0, 230, 118, ${alpha1 * 0.8})`;
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.arc(ptGround.x, ptGround.y, wave1, 0, Math.PI * 2);
            ctx.stroke();

            const wave2 = 6 + ((pulsePhase * 4 + 7) % 14);
            const alpha2 = Math.max(0, 1 - wave2 / 20);
            ctx.strokeStyle = `rgba(0, 230, 118, ${alpha2 * 0.6})`;
            ctx.beginPath();
            ctx.arc(ptGround.x, ptGround.y, wave2, 0, Math.PI * 2);
            ctx.stroke();
          }

          // 8b. Vertical Holographic Laser Light Pillar in 3D Space
          if (wS > 0.05) {
            // Neon Laser Column
            const pillarGrad = ctx.createLinearGradient(ptGround.x, ptGround.y, ptTop.x, ptTop.y);
            pillarGrad.addColorStop(0, online ? 'rgba(0, 230, 118, 0.15)' : 'rgba(226, 39, 24, 0.15)');
            pillarGrad.addColorStop(1, online ? 'rgba(0, 230, 118, 0.85)' : 'rgba(226, 39, 24, 0.85)');

            ctx.strokeStyle = pillarGrad;
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(ptGround.x, ptGround.y);
            ctx.lineTo(ptTop.x, ptTop.y);
            ctx.stroke();

            // Graduation Tick Marks
            [0.33, 0.66].forEach((fraction) => {
              const tickX = ptGround.x + (ptTop.x - ptGround.x) * fraction;
              const tickY = ptGround.y + (ptTop.y - ptGround.y) * fraction;
              ctx.strokeStyle = online ? 'rgba(0, 230, 118, 0.6)' : 'rgba(226, 39, 24, 0.6)';
              ctx.lineWidth = 1.0;
              ctx.beginPath();
              ctx.moveTo(tickX - 3, tickY);
              ctx.lineTo(tickX + 3, tickY);
              ctx.stroke();
            });
          }

          // 8c. Solid Beacon Core (at Top Altitude)
          ctx.fillStyle = online ? '#00e676' : '#e22718';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(ptTop.x, ptTop.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Node Label & Airport Colo Tag
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 11px Inter, sans-serif';
          const coloTag = node.geo?.colo ? ` [${node.geo.colo}]` : '';
          ctx.fillText(`${node.name.toUpperCase()}${coloTag}`, ptTop.x + 9, ptTop.y + 4);
        }
      });

      // 9. High-Altitude 3D Geodesic Arcs & Travelling Photons
      if (onlineNodes.length >= 2) {
        for (let i = 0; i < onlineNodes.length; i++) {
          for (let j = i + 1; j < onlineNodes.length; j++) {
            const nodeA = onlineNodes[i];
            const nodeB = onlineNodes[j];

            ctx.strokeStyle = 'rgba(0, 230, 118, 0.28)';
            ctx.lineWidth = 1.0;
            ctx.setLineDash([4, 4]);

            ctx.beginPath();
            let arcStarted = false;
            const steps = 28;

            for (let s = 0; s <= steps; s++) {
              const tStep = s / steps;
              const [arcLat, arcLon] = interpolateGreatCircle(
                nodeA.geo.lat!,
                nodeA.geo.lon!,
                nodeB.geo.lat!,
                nodeB.geo.lon!,
                tStep
              );
              // Parabolic mid-air altitude boost
              const parabolicAlt = terrainHeight + pillarAltitude + Math.sin(tStep * Math.PI) * (28 * wS + 12 * wF);
              const pt = projectMorphed(arcLat, arcLon, radius, rotX, rotY, wG, wS, wF, centerX, centerY, parabolicAlt);

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

            // Animated Travelling Photon Pulse
            const pulseT = ((pulsePhase * 0.25 + i * 0.3 + j * 0.2) % 1.0);
            const [photonLat, photonLon] = interpolateGreatCircle(
              nodeA.geo.lat!,
              nodeA.geo.lon!,
              nodeB.geo.lat!,
              nodeB.geo.lon!,
              pulseT
            );
            const photonAlt = terrainHeight + pillarAltitude + Math.sin(pulseT * Math.PI) * (28 * wS + 12 * wF);
            const photonPt = projectMorphed(photonLat, photonLon, radius, rotX, rotY, wG, wS, wF, centerX, centerY, photonAlt);

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

      // 10. Tactical HUD Legends
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '700 9px monospace';
      const modeLabel = wS > 0.5 ? '3D TACTICAL SANDTABLE' : wG > 0.5 ? '3D ORBITAL GLOBE' : '2D GEODESIC PLAN';
      ctx.fillText(`VIEW: ${modeLabel} // REF WGS-84`, 16, height - 16);
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

      if (mode === '3d' || mode === 'sandtable') {
        rotYRef.current += deltaX * 0.008;
        rotXRef.current = Math.max(-1.0, Math.min(1.0, rotXRef.current + deltaY * 0.008));
      } else {
        const baseRadius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.35;
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
    const centerY = canvas.clientHeight / 2 + panYRef.current + wSRef.current * (Math.min(canvas.clientWidth, canvas.clientHeight) * 0.35 * scaleRef.current * 0.15);
    const radius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.35 * scaleRef.current;

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
    const pillarAltitude = (14 + 38) * wSRef.current;

    for (const node of geoNodes) {
      const pt = projectMorphed(
        node.geo.lat!,
        node.geo.lon!,
        radius,
        rotXRef.current,
        rotYRef.current,
        wGRef.current,
        wSRef.current,
        wFRef.current,
        centerX,
        centerY,
        pillarAltitude
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
