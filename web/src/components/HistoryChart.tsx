import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useNodeHistoryQuery } from '../queries/nodes';
import { useRealtimeStore, RealtimePoint } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';
import { formatBeijingAxis, formatBeijingTimeOnly } from '../utils/time';

interface HistoryChartProps {
  nodeId: string;
  title: string;
  metricKey: string;
  unit: string;
  range?: string;
  strokeColor?: string;
  limitBytes?: number | null;
}

const EMPTY_SERIES: RealtimePoint[] = [];

export const HistoryChart: React.FC<HistoryChartProps> = ({
  nodeId,
  title,
  metricKey,
  unit,
  range = '10m',
  strokeColor = '#ffffff',
  limitBytes,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const timeValRef = useRef<HTMLSpanElement>(null);
  const metricValRef = useRef<HTMLSpanElement>(null);
  const uplotInstance = useRef<uPlot | null>(null);
  const prevConfigRef = useRef<{ range: string; metricKey: string }>({ range, metricKey });
  const { t } = useTranslation();

  const { data, isLoading } = useNodeHistoryQuery(nodeId, range);
  const realtimeSeries = useRealtimeStore((s) => s.realtimeSeries[nodeId] ?? EMPTY_SERIES);

  useEffect(() => {
    if (!chartRef.current) return;

    const extractVal = (item: any): number | null => {
      if (metricKey === 'memory_usage_pct') {
        const used = item.memory_used_bytes != null ? Number(item.memory_used_bytes) : null;
        if (used !== null && limitBytes && limitBytes > 0) {
          return Number(((used / limitBytes) * 100).toFixed(1));
        }
        return null;
      }
      return item[metricKey] != null ? Number(item[metricKey]) : null;
    };

    const historyPoints = (data?.points || []).map((pt: any) => ({
      ts_ms: pt.bucket_start_ms,
      value: extractVal(pt),
    }));

    let mergedPoints: Array<{ ts_ms: number; value: number | null }> = [];

    if (range === '10m') {
      const now = Date.now();
      const cutoff = now - 10 * 60_000;
      const maxFuture = now + 60_000;
      const filteredHistory = historyPoints.filter((p) => p.ts_ms >= cutoff && p.ts_ms <= maxFuture);
      const filteredLive = realtimeSeries
        .map((rt) => ({
          ts_ms: rt.ts_ms,
          value: extractVal(rt),
        }))
        .filter((p) => p.ts_ms >= cutoff && p.ts_ms <= maxFuture);

      const map = new Map<number, number | null>();
      for (const p of filteredHistory) {
        map.set(p.ts_ms, p.value);
      }
      for (const p of filteredLive) {
        map.set(p.ts_ms, p.value);
      }

      mergedPoints = Array.from(map.entries())
        .map(([ts_ms, value]) => ({ ts_ms, value }))
        .sort((a, b) => a.ts_ms - b.ts_ms);
    } else {
      mergedPoints = historyPoints;
    }

    if (mergedPoints.length === 0) {
      if (uplotInstance.current) {
        uplotInstance.current.destroy();
        uplotInstance.current = null;
      }
      return;
    }

    const timestamps: number[] = [];
    const values: (number | null)[] = [];

    for (const pt of mergedPoints) {
      timestamps.push(Math.floor(pt.ts_ms / 1000));
      values.push(pt.value);
    }

    const alignedData: uPlot.AlignedData = [timestamps, values];
    const width = chartRef.current.clientWidth || 600;

    const isSameConfig =
      prevConfigRef.current.range === range &&
      prevConfigRef.current.metricKey === metricKey;

    if (uplotInstance.current && isSameConfig) {
      // Direct high-performance data update without DOM destruction/flicker
      uplotInstance.current.setData(alignedData);
    } else {
      if (uplotInstance.current) {
        uplotInstance.current.destroy();
        uplotInstance.current = null;
      }

      const opts: uPlot.Options = {
        width,
        height: 190,
        scales: {
          x: { time: true },
          y: { auto: true },
        },
        axes: [
          {
            stroke: '#a0a0a8',
            grid: { stroke: 'rgba(255, 255, 255, 0.08)', width: 1 },
            ticks: { stroke: 'transparent' },
            values: (_u, splits) => splits.map((ts) => formatBeijingAxis(ts, range)),
          },
          {
            stroke: '#a0a0a8',
            grid: { stroke: 'rgba(255, 255, 255, 0.08)', width: 1 },
            ticks: { stroke: 'transparent' },
            values: (_u, vals) => vals.map((v) => formatValue(v, unit)),
          },
        ],
        cursor: {
          drag: { x: false, y: false },
          sync: { key: 'history-charts' },
        },
        legend: {
          show: false, // Disabled built-in jumping table legend
        },
        hooks: {
          setCursor: [
            (u) => {
              const idx = u.cursor.idx;
              if (idx != null && u.data[0][idx] != null) {
                const ts = u.data[0][idx];
                const val = u.data[1][idx];
                if (timeValRef.current) {
                  timeValRef.current.textContent = formatBeijingTimeOnly(ts * 1000, true);
                }
                if (metricValRef.current) {
                  metricValRef.current.textContent = val != null ? formatValue(val, unit) : 'N/A';
                }
              } else {
                if (timeValRef.current) timeValRef.current.textContent = '--:--:--';
                if (metricValRef.current) metricValRef.current.textContent = '--';
              }
            },
          ],
        },
        series: [
          {},
          {
            label: title,
            stroke: strokeColor,
            width: 1.5,
            fill: 'rgba(255, 255, 255, 0.05)',
          },
        ],
      };

      uplotInstance.current = new uPlot(opts, alignedData, chartRef.current);
      prevConfigRef.current = { range, metricKey };
    }
  }, [data, realtimeSeries, range, title, metricKey, unit, strokeColor]);

  // Automatic container resize observer
  useEffect(() => {
    if (!chartRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        if (newWidth > 0 && uplotInstance.current) {
          uplotInstance.current.setSize({ width: newWidth, height: 190 });
        }
      }
    });

    ro.observe(chartRef.current);
    return () => ro.disconnect();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uplotInstance.current) {
        uplotInstance.current.destroy();
        uplotInstance.current = null;
      }
    };
  }, []);

  return (
    <div className="chart-band">
      <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="eyebrow-cap" style={{ color: '#ffffff' }}>
          {title}
        </span>
        {range === '10m' && (
          <span className="spacex-chip" style={{ color: '#00e676', borderColor: '#00e676' }}>
            2-SEC LIVE STREAM
          </span>
        )}
      </div>

      <div style={{ minHeight: '190px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} ref={chartRef}>
        {isLoading && (
          <span className="eyebrow-cap">{t('chart_loading')}</span>
        )}
        {!isLoading && (!data?.points || data.points.length === 0) && realtimeSeries.length === 0 && (
          <span className="eyebrow-cap">{t('chart_no_data')}</span>
        )}
      </div>

      {/* Fixed Grid HUD Strip: Permanent locked columns, 0 shifting */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(140px, auto) minmax(200px, 1fr)',
          alignItems: 'center',
          gap: '20px',
          padding: '8px 14px',
          marginTop: '10px',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--colors-hairline-subtle)',
          borderRadius: '4px',
          fontFamily: 'monospace',
          fontSize: '11px',
        }}
      >
        {/* Column 1: Time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--colors-muted)', textTransform: 'uppercase' }}>TIME:</span>
          <span ref={timeValRef} style={{ fontWeight: 700, color: 'var(--colors-on-dark)', fontVariantNumeric: 'tabular-nums' }}>
            --:--:--
          </span>
        </div>

        {/* Column 2: Metric Value */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', backgroundColor: strokeColor, borderRadius: '2px', flexShrink: 0 }}></span>
          <span style={{ color: 'var(--colors-muted)', textTransform: 'uppercase' }}>{title}:</span>
          <span ref={metricValRef} style={{ fontWeight: 700, color: 'var(--colors-on-dark)', fontVariantNumeric: 'tabular-nums' }}>
            --
          </span>
        </div>
      </div>
    </div>
  );
};

function formatValue(v: number | null | undefined, unit: string): string {
  if (v == null) return '';
  if (unit === '°C' || unit === '℃' || unit.toLowerCase() === 'c') {
    return `${Number(v).toFixed(1)} °C`;
  }
  if (unit === 'B') {
    if (v >= 1024 * 1024 * 1024) return (v / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' MB';
    return (v / 1024).toFixed(0) + ' KB';
  }
  if (unit === 'B/S') {
    if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' MB/S';
    if (v >= 1024) return (v / 1024).toFixed(0) + ' KB/S';
    return v + ' B/S';
  }
  if (unit === '%') {
    return `${Number(v).toFixed(1)}%`;
  }
  if (unit === 'MS') {
    return `${Number(v).toFixed(1)} MS`;
  }
  return `${v}${unit}`;
}
