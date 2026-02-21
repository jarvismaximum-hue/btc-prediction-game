import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import type { Market } from '../hooks/useSocket';

interface Props {
  candles: any[];
  liveCandle: any;
  currentPrice: number;
  market: Market | null;
  socketRef?: React.RefObject<any>;
}

// ---- Module-level chart state (survives React re-renders) ----
let _chart: IChartApi | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _series: any = null;
let _targetLine: any = null;
let _ro: ResizeObserver | null = null;
let _mountedContainer: HTMLDivElement | null = null;
let _lastMarketId: string | null = null;
let _targetOverlay: HTMLDivElement | null = null;
let _targetRafId: number | null = null;
let _targetPrice: number | null = null;

// ---- Buffered candle queue ----
let _candleQueue: any[] = [];
let _renderInterval: ReturnType<typeof setInterval> | null = null;
let _lastRenderedTime = 0;

function startCadenceRenderer() {
  if (_renderInterval) return;
  const now = Date.now();
  const nextSecond = Math.ceil(now / 1000) * 1000;
  const delay = nextSecond - now;
  setTimeout(() => {
    renderNextCandle();
    _renderInterval = setInterval(renderNextCandle, 1000);
  }, delay);
}

function renderNextCandle() {
  if (!_series || _candleQueue.length === 0) return;
  const candle = _candleQueue.shift()!;
  if (candle.time <= _lastRenderedTime) return;
  _lastRenderedTime = candle.time;
  try {
    _series.update({
      time: candle.time as any,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  } catch {}
  try { _chart?.timeScale().scrollToRealTime(); } catch {}
}

function stopCadenceRenderer() {
  if (_renderInterval) {
    clearInterval(_renderInterval);
    _renderInterval = null;
  }
}

// ---- Target price overlay ----
// Positions a custom DOM label on the right price axis.
// When the target is out of view, pins it to top or bottom edge.
function createTargetOverlay(chartContainer: HTMLDivElement): HTMLDivElement {
  if (_targetOverlay) return _targetOverlay;

  const overlay = document.createElement('div');
  overlay.className = 'target-overlay';
  overlay.style.cssText = `
    position: absolute;
    right: 0;
    pointer-events: none;
    z-index: 10;
    display: none;
  `;

  const label = document.createElement('div');
  label.className = 'target-overlay-label';
  label.style.cssText = `
    background: #ffd700;
    color: #0a0e17;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 4px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    text-align: center;
    width: 100%;
    box-sizing: border-box;
  `;
  overlay.appendChild(label);

  chartContainer.style.position = 'relative';
  chartContainer.appendChild(overlay);
  _targetOverlay = overlay;
  return overlay;
}

function updateTargetOverlayPosition() {
  if (!_chart || !_series || !_targetOverlay || _targetPrice === null) {
    if (_targetOverlay) _targetOverlay.style.display = 'none';
    _targetRafId = requestAnimationFrame(updateTargetOverlayPosition);
    return;
  }

  const container = _mountedContainer;
  if (!container) {
    _targetRafId = requestAnimationFrame(updateTargetOverlayPosition);
    return;
  }

  const chartHeight = container.clientHeight;
  const priceY = _series.priceToCoordinate(_targetPrice);
  const label = _targetOverlay.querySelector('.target-overlay-label') as HTMLElement;

  if (!label) {
    _targetRafId = requestAnimationFrame(updateTargetOverlayPosition);
    return;
  }

  _targetOverlay.style.display = 'block';

  // Position on the price axis (right side)
  const priceScaleWidth = _chart.priceScale('right').width();
  _targetOverlay.style.width = `${priceScaleWidth}px`;

  const priceText = _targetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const labelHeight = 18;
  const topMargin = 2;
  const bottomMargin = 26; // time axis height

  if (priceY === null || priceY < 0) {
    // Target is ABOVE visible area — pin label to top of price axis
    _targetOverlay.style.top = `${topMargin}px`;
    label.textContent = `\u25B2 $${priceText}`;
    label.style.background = '#ffd700';
    label.style.borderRadius = '0 0 3px 3px';
  } else if (priceY > chartHeight - bottomMargin) {
    // Target is BELOW visible area — pin label to bottom of price axis
    _targetOverlay.style.top = `${chartHeight - bottomMargin - labelHeight}px`;
    label.textContent = `\u25BC $${priceText}`;
    label.style.background = '#ffd700';
    label.style.borderRadius = '3px 3px 0 0';
  } else {
    // Target is visible — position at exact Y on the price axis
    _targetOverlay.style.top = `${priceY - labelHeight / 2}px`;
    label.textContent = `$${priceText}`;
    label.style.background = '#ffd700';
    label.style.borderRadius = '3px';
  }

  _targetRafId = requestAnimationFrame(updateTargetOverlayPosition);
}

function startTargetOverlayLoop() {
  if (_targetRafId !== null) return;
  _targetRafId = requestAnimationFrame(updateTargetOverlayPosition);
}

function stopTargetOverlayLoop() {
  if (_targetRafId !== null) {
    cancelAnimationFrame(_targetRafId);
    _targetRafId = null;
  }
}

function ensureChart(container: HTMLDivElement) {
  if (_chart && _series && _mountedContainer === container) {
    return { chart: _chart, series: _series };
  }

  if (_chart) {
    try { _ro?.disconnect(); } catch {}
    try { _chart.remove(); } catch {}
    _chart = null;
    _series = null;
    _targetLine = null;
    _ro = null;
    _mountedContainer = null;
    stopTargetOverlayLoop();
    if (_targetOverlay) {
      _targetOverlay.remove();
      _targetOverlay = null;
    }
  }

  const chart = createChart(container, {
    layout: {
      background: { color: '#0a0e17' },
      textColor: '#a0aec0',
    },
    grid: {
      vertLines: { color: '#1a2332', style: 1 },
      horzLines: { color: '#1a2332', style: 1 },
    },
    crosshair: {
      mode: 0,
      vertLine: { color: 'rgba(0, 212, 170, 0.3)', width: 1, style: 3, labelBackgroundColor: '#1a2332' },
      horzLine: { color: 'rgba(0, 212, 170, 0.3)', width: 1, style: 3, labelBackgroundColor: '#1a2332' },
    },
    rightPriceScale: {
      borderColor: '#1a2332',
      scaleMargins: { top: 0.15, bottom: 0.15 },
    },
    timeScale: {
      borderColor: '#1a2332',
      timeVisible: true,
      secondsVisible: true,
      rightOffset: 5,
      fixLeftEdge: false,
      fixRightEdge: true,
      barSpacing: 8,
    },
    width: container.clientWidth,
    height: 420,
    handleScale: { axisPressedMouseMove: true },
    handleScroll: { vertTouchDrag: false },
  });

  const series = chart.addSeries(CandlestickSeries, {
    upColor: '#00d4aa',
    downColor: '#ff4976',
    borderUpColor: '#00d4aa',
    borderDownColor: '#ff4976',
    wickUpColor: '#00d4aa',
    wickDownColor: '#ff4976',
    priceLineVisible: true,
    priceLineColor: '#00d4aa',
    priceLineWidth: 1,
  });

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = entry.contentRect.width;
      if (w > 0 && _chart) {
        try { _chart.applyOptions({ width: w }); } catch {}
      }
    }
  });
  ro.observe(container);

  _chart = chart;
  _series = series;
  _ro = ro;
  _mountedContainer = container;

  createTargetOverlay(container);
  startCadenceRenderer();
  startTargetOverlayLoop();

  return { chart, series };
}

export function PriceChart({ candles, liveCandle: _liveCandle, currentPrice, market, socketRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const priceDisplayRef = useRef<HTMLSpanElement>(null);
  const diffDisplayRef = useRef<HTMLDivElement>(null);
  const lastPriceRef = useRef(0);
  const flashTimeoutRef = useRef<number>(0);
  const initDataLoaded = useRef(false);

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;
    ensureChart(containerRef.current);
    return () => {
      stopCadenceRenderer();
      stopTargetOverlayLoop();
    };
  }, []);

  // Seed historical candle data (bulk load on connect)
  useEffect(() => {
    if (!_series || candles.length === 0) return;
    if (initDataLoaded.current) return;
    initDataLoaded.current = true;

    const sorted = candles
      .slice()
      .sort((a: any, b: any) => a.time - b.time)
      .map((c: any) => ({
        time: c.time as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

    if (sorted.length > 0) {
      try { _series.setData(sorted); } catch {}
      _lastRenderedTime = sorted[sorted.length - 1].time;
    }

    try { _chart?.timeScale().scrollToRealTime(); } catch {}
  }, [candles]);

  // Socket listeners — queue completed candles and update price display
  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return;

    const handleCandle = (candle: any) => {
      if (!candle) return;
      _candleQueue.push({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
    };

    const handleTick = (tick: { price: number; timestamp: number }) => {
      if (priceDisplayRef.current) {
        const formatted = '$' + tick.price.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        priceDisplayRef.current.textContent = formatted;

        const prev = lastPriceRef.current;
        if (prev > 0 && prev !== tick.price) {
          const dir = tick.price > prev ? 'flash-up' : 'flash-down';
          priceDisplayRef.current.classList.remove('flash-up', 'flash-down');
          void priceDisplayRef.current.offsetWidth;
          priceDisplayRef.current.classList.add(dir);
          clearTimeout(flashTimeoutRef.current);
          flashTimeoutRef.current = window.setTimeout(() => {
            priceDisplayRef.current?.classList.remove('flash-up', 'flash-down');
          }, 600);
        }
        lastPriceRef.current = tick.price;
      }

      if (diffDisplayRef.current && market) {
        const diff = tick.price - market.openPrice;
        const pct = market.openPrice > 0 ? (diff / market.openPrice) * 100 : 0;
        const isUp = diff >= 0;
        diffDisplayRef.current.className = `price-diff ${isUp ? 'up' : 'down'}`;
        diffDisplayRef.current.textContent = `${isUp ? '+' : ''}${diff.toFixed(2)} (${isUp ? '+' : ''}${pct.toFixed(3)}%)`;
      }
    };

    socket.on('candle', handleCandle);
    socket.on('priceTick', handleTick);

    return () => {
      socket.off('candle', handleCandle);
      socket.off('priceTick', handleTick);
    };
  }, [socketRef?.current, market?.openPrice]);

  // Target price line + overlay tracking
  useEffect(() => {
    if (!_series) return;

    const marketId = market?.id ?? null;
    if (marketId === _lastMarketId && _targetLine) return;
    _lastMarketId = marketId;

    if (_targetLine) {
      try { _series.removePriceLine(_targetLine); } catch {}
      _targetLine = null;
    }

    if (market && market.status === 'trading' && market.openPrice > 0) {
      _targetPrice = market.openPrice;
      try {
        _targetLine = _series.createPriceLine({
          price: market.openPrice,
          color: '#ffd700',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: false, // we use our custom overlay instead
          title: '',
        });
      } catch {}
    } else {
      _targetPrice = null;
    }
  }, [market?.id, market?.status, market?.openPrice]);

  const diff = market ? currentPrice - market.openPrice : 0;
  const diffPct = market && market.openPrice > 0 ? (diff / market.openPrice) * 100 : 0;
  const isUp = diff >= 0;

  return (
    <div className="price-chart">
      <div className="price-header">
        <div className="current-price">
          <span className="label">BTC/USDT</span>
          <span className="value price-value" ref={priceDisplayRef}>
            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        {market && market.status === 'trading' && market.openPrice > 0 && (
          <div className="target-price-inline">
            <span className="target-label">Target:</span>
            <span className="target-value">${market.openPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        )}
        {market && market.status === 'trading' && (
          <div
            className={`price-diff ${isUp ? 'up' : 'down'}`}
            ref={diffDisplayRef}
          >
            <span>{isUp ? '+' : ''}{diff.toFixed(2)} ({isUp ? '+' : ''}{diffPct.toFixed(3)}%)</span>
          </div>
        )}
      </div>
      <div ref={containerRef} className="chart-container" />
    </div>
  );
}
