import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useNodeHistoryQuery } from '../queries/nodes';
import { useRealtimeStore, RealtimePoint } from '../realtime/store';
import { useTranslation } from '../i18n/I18nContext';

interface HistoryChartProps {
  nodeId: string;
  title: string;
  metricKey: string;
  unit: string;
  range?: string;
  strokeColor?: string;
}

const EMPTY_SERIES: RealtimePoint[] = [];

export const HistoryChart: React.FC<HistoryChartProps> = ({
  nodeId,
  title,
  metricKey,
  unit,
  range = '24h',
  strokeColor = '#ffffff',
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotInstance = useRef<uPlot | null>(null);
  const prevConfigRef = useRef<{ range: string; metricKey: string }>({ range, metricKey });
  const { t } = useTranslation();

  const { data, isLoading } = useNodeHistoryQuery(nodeId, range);
  const realtimeSeries = useRealtimeStore((s) => s.realtimeSeries[nodeId] ?? EMPTY_SERIES);

  useEffect(() => {
    if (!chartRef.current) return;

    const historyPoints = (data?.points || []).map((pt: any) => ({
      ts_ms: pt.bucket_start_ms,
      value: pt[metricKey] != null ? Number(pt[metricKey]) : null,
    }));

    let mergedPoints: Array<{ ts_ms: number; value: number | null }> = [];

    if (range === '10m') {
      const cutoff = Date.now() - 10 * 60_000;
      const filteredHistory = historyPoints.filter((p) => p.ts_ms >= cutoff);
      const filteredLive = realtimeSeries
        .map((rt) => ({
          ts_ms: rt.ts_ms,
          value: (rt as any)[metricKey] != null ? Number((rt as any)[metricKey]) : null,
        }))
        .filter((p) => p.ts_ms >= cutoff);

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
          },
          {
            stroke: '#a0a0a8',
            grid: { stroke: 'rgba(255, 255, 255, 0.08)', width: 1 },
            ticks: { stroke: 'transparent' },
            values: (_u, vals) => vals.map((v) => `${v}${unit}`),
          },
        ],
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
        if (entry.contentRect.width > 0 && uplotInstance.current) {
          uplotInstance.current.setSize({
            width: entry.contentRect.width,
            height: 190,
          });
        }
      }
    });
    ro.observe(chartRef.current);
    return () => {
      ro.disconnect();
    };
  }, []);

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
    </div>
  );
};
