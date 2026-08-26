import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useNodeHistoryQuery } from '../queries/nodes';

interface HistoryChartProps {
  nodeId: string;
  title: string;
  metricKey: string;
  unit: string;
  range?: string;
  strokeColor?: string;
}

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

  const { data, isLoading } = useNodeHistoryQuery(nodeId, range);

  useEffect(() => {
    if (!chartRef.current) return;

    if (uplotInstance.current) {
      uplotInstance.current.destroy();
      uplotInstance.current = null;
    }

    const points = data?.points || [];
    if (points.length === 0) return;

    const timestamps: number[] = [];
    const values: (number | null)[] = [];

    for (const pt of points) {
      timestamps.push(Math.floor(pt.bucket_start_ms / 1000));
      const val = pt[metricKey];
      values.push(val != null ? Number(val) : null);
    }

    const alignedData: uPlot.AlignedData = [timestamps, values];
    const width = chartRef.current.clientWidth || 600;

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

    return () => {
      if (uplotInstance.current) {
        uplotInstance.current.destroy();
        uplotInstance.current = null;
      }
    };
  }, [data, title, metricKey, unit, strokeColor]);

  return (
    <div className="chart-band">
      <div style={{ marginBottom: '12px' }}>
        <span className="eyebrow-cap" style={{ color: '#ffffff' }}>
          {title}
        </span>
      </div>

      <div style={{ minHeight: '190px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} ref={chartRef}>
        {isLoading && (
          <span className="eyebrow-cap">ACQUIRING TELEMETRY BUFFER...</span>
        )}
        {!isLoading && (!data?.points || data.points.length === 0) && (
          <span className="eyebrow-cap">NO TELEMETRY BUFFER IN TIMEFRAME</span>
        )}
      </div>
    </div>
  );
};
