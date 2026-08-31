import React, { useState } from 'react';
import { useRealtimeStore, ProbeBucketSample } from '../realtime/store';
import { formatBeijingTimeOnly } from '../utils/time';

export interface ProbeResultItem {
  id: string;
  target?: string;
  status?: string;
  latency_ms?: number | null;
  rtt_ms?: number | null;
  loss_ratio?: number;
  loss_pct?: number;
}

interface ProbeHeatmapProps {
  nodeId: string;
  currentProbes?: ProbeResultItem[];
  compact?: boolean;
}

export const TARGET_LABELS: Record<string, { name: string; flag: string }> = {
  ct: { name: '电信 (CT)', flag: '🇨🇳' },
  cu: { name: '联通 (CU)', flag: '🇨🇳' },
  cm: { name: '移动 (CM)', flag: '🇨🇳' },
  ali: { name: '阿里 (ALI)', flag: '⚡' },
  cf: { name: 'CLOUDFLARE', flag: '🌐' },
  google: { name: 'GOOGLE', flag: '🌐' },
  apple: { name: 'APPLE', flag: '🌐' },
};

export function getLatencyColor(rtt: number | null | undefined, loss: number): string {
  if (loss > 0 || rtt === null || rtt === undefined || rtt <= 0) {
    if (loss >= 100 || rtt === null || rtt === undefined) return '#f85149'; // Red (down/loss)
    return '#ff7043'; // Orange (packet loss)
  }
  if (rtt < 50) return '#00e676'; // Neon green (ultra fast)
  if (rtt < 100) return '#00d4aa'; // Cyan green (good)
  if (rtt < 180) return '#38bdf8'; // Sky blue (fair)
  if (rtt < 280) return '#ffb870'; // Warm yellow (high)
  return '#ff7043'; // Coral orange (very high)
}

function getBarHeight(rtt: number | null | undefined, loss: number): number {
  if (loss >= 100 || rtt === null || rtt === undefined) return 3; // minimal line
  if (loss > 0) return 6;
  if (rtt < 50) return 14;
  if (rtt < 100) return 12;
  if (rtt < 180) return 9;
  if (rtt < 280) return 7;
  return 5;
}

export const ProbeSparklineBar: React.FC<{
  nodeId: string;
  probeId: string;
  rtt?: number | null;
  lossRatio?: number;
  bucketCount?: number;
}> = ({ nodeId, probeId, rtt = null, lossRatio = 0, bucketCount = 18 }) => {
  const probeHistory = useRealtimeStore((s) => s.probeHistory[nodeId] || {});
  const [activeTooltip, setActiveTooltip] = useState<{
    sample: ProbeBucketSample;
    x: number;
    y: number;
  } | null>(null);

  const loss = (lossRatio || 0) * 100;
  const historyList = probeHistory[probeId] || [];
  let samples: ProbeBucketSample[] = [];

  if (historyList.length >= bucketCount) {
    samples = historyList.slice(-bucketCount);
  } else {
    const missing = bucketCount - historyList.length;
    const placeholders: ProbeBucketSample[] = Array.from({ length: missing }, (_, idx) => ({
      ts_ms: Date.now() - (missing - idx) * 60_000,
      rtt_ms: rtt ?? null,
      loss_pct: loss,
      status: 'ok',
    }));
    samples = [...placeholders, ...historyList];
  }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '200px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px',
          height: '16px',
          padding: '2px 0',
        }}
      >
        {samples.map((sample, sIdx) => {
          const sColor = getLatencyColor(sample.rtt_ms, sample.loss_pct);
          const sHeight = getBarHeight(sample.rtt_ms, sample.loss_pct);
          const isLatest = sIdx === samples.length - 1;

          return (
            <div
              key={sIdx}
              style={{
                flex: 1,
                height: '100%',
                display: 'flex',
                alignItems: 'flex-end',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setActiveTooltip({
                  sample,
                  x: rect.left + rect.width / 2,
                  y: rect.top,
                });
              }}
              onMouseLeave={() => setActiveTooltip(null)}
            >
              <div
                style={{
                  width: '100%',
                  height: `${sHeight}px`,
                  backgroundColor: sColor,
                  borderRadius: '1px',
                  opacity: isLatest ? 1 : 0.65,
                  transition: 'all 0.15s ease',
                  boxShadow: isLatest ? `0 0 6px ${sColor}80` : 'none',
                }}
              />
            </div>
          );
        })}
      </div>

      {activeTooltip && (
        <div
          style={{
            position: 'fixed',
            left: `${activeTooltip.x}px`,
            top: `${activeTooltip.y - 8}px`,
            transform: 'translate(-50%, -100%)',
            padding: '5px 9px',
            backgroundColor: '#0a0a0a',
            border: '1px solid var(--colors-hairline-subtle)',
            borderRadius: '4px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8)',
            fontSize: '10px',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          <div style={{ color: 'var(--colors-muted)', marginBottom: '2px' }}>
            {formatBeijingTimeOnly(activeTooltip.sample.ts_ms, true)}
          </div>
          <div style={{ color: getLatencyColor(activeTooltip.sample.rtt_ms, activeTooltip.sample.loss_pct), fontWeight: 700 }}>
            {activeTooltip.sample.loss_pct >= 100
              ? '⚠️ 丢包超时 (100% LOSS)'
              : `${activeTooltip.sample.rtt_ms != null ? `${activeTooltip.sample.rtt_ms.toFixed(1)} MS` : 'N/A'}${activeTooltip.sample.loss_pct > 0 ? ` (${activeTooltip.sample.loss_pct.toFixed(0)}% LOSS)` : ''}`}
          </div>
        </div>
      )}
    </div>
  );
};

export const ProbeHeatmap: React.FC<ProbeHeatmapProps> = ({
  nodeId,
  currentProbes = [],
  compact = false,
}) => {
  const realtimeOverlay = useRealtimeStore((s) => s.overlays[nodeId]);

  // Merge latest probes from realtime overlay or REST props
  const activeProbes: ProbeResultItem[] = (
    realtimeOverlay?.probes && realtimeOverlay.probes.length > 0
      ? realtimeOverlay.probes
      : currentProbes
  ).map((p: any) => ({
    id: p.id,
    target: p.target,
    status: p.status,
    latency_ms: p.latency_ms ?? p.rtt_ms ?? null,
    loss_ratio: p.loss_ratio ?? (p.loss_pct ? p.loss_pct / 100 : 0),
  }));

  if (!activeProbes || activeProbes.length === 0) {
    return null;
  }

  const BUCKET_COUNT = compact ? 12 : 18;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '6px' : '12px',
        padding: compact ? '8px 10px' : '14px 16px',
        backgroundColor: compact ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
        border: compact ? 'none' : '1px solid var(--colors-hairline-subtle)',
        borderRadius: '6px',
        position: 'relative',
      }}
    >
      {!compact && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="eyebrow-cap" style={{ fontSize: '10px', color: 'var(--colors-on-dark)' }}>
            三网与骨干连通性延迟热力雷达 (PING BUCKETS)
          </span>
          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--colors-muted)' }}>
            LIVE 60S SLIDING
          </span>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? 'repeat(auto-fit, minmax(130px, 1fr))' : 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: compact ? '6px 12px' : '12px 18px',
        }}
      >
        {activeProbes.map((probe) => {
          const key = probe.id.toLowerCase();
          const targetMeta = TARGET_LABELS[key] || { name: probe.id.toUpperCase(), flag: '📍' };
          const rtt = probe.latency_ms ?? null;
          const loss = (probe.loss_ratio || 0) * 100;
          const isDown = loss >= 100 || rtt === null || rtt === undefined;
          const currentColor = getLatencyColor(rtt, loss);

          return (
            <div key={probe.id} style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
              {/* Header: Name + Latency Value */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--colors-on-dark)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {targetMeta.flag} {targetMeta.name}
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    color: currentColor,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isDown ? (loss >= 100 ? '100% 丢包' : 'TIMEOUT') : `${rtt != null ? rtt.toFixed(1) : '0.0'} MS`}
                </span>
              </div>

              {/* Sparkline Bar */}
              <ProbeSparklineBar
                nodeId={nodeId}
                probeId={probe.id}
                rtt={rtt}
                lossRatio={probe.loss_ratio}
                bucketCount={BUCKET_COUNT}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
