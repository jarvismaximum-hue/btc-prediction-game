import { useEffect, useRef } from 'react';
import { createChart, AreaSeries } from 'lightweight-charts';
import type { IChartApi, Time } from 'lightweight-charts';

interface Props {
  data: { timestamp: number; price: number }[];
}

export function AuctionPriceChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 180,
      layout: {
        background: { color: 'transparent' },
        textColor: '#4a6080',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(26, 45, 74, 0.3)' },
        horzLines: { color: 'rgba(26, 45, 74, 0.3)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(26, 45, 74, 0.5)',
      },
      timeScale: {
        borderColor: 'rgba(26, 45, 74, 0.5)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: 'rgba(0, 230, 180, 0.3)' },
        horzLine: { color: 'rgba(0, 230, 180, 0.3)' },
      },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#00e6b4',
      topColor: 'rgba(0, 230, 180, 0.25)',
      bottomColor: 'rgba(0, 230, 180, 0)',
      lineWidth: 2,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !data.length) return;
    const mapped = data.map((d) => ({
      time: (d.timestamp / 1000) as Time,
      value: d.price,
    }));
    seriesRef.current.setData(mapped);
  }, [data]);

  return <div ref={containerRef} style={{ borderRadius: '8px', overflow: 'hidden' }} />;
}
