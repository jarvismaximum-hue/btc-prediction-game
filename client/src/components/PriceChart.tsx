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
// Direct update helper — no queue, no cadence renderer.
// lightweight-charts handles same-time updates by replacing the candle in-place.
function updateCandle(candle: { time: number; open: number; high: number; low: number; close: number }) {
  if (!_series) return;
  try {
    _series.update({
      time: candle.time as any,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  } catch {}
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
  startTargetOverlayLoop();

  return { chart, series };
}

export function PriceChart({ candles, liveCandle: _liveCandle, currentPrice, market, socketRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const priceDisplayRef = useRef<HTMLSpanElement>(null);
  const diffDisplayRef = useRef<HTMLDivElement>(null);
  const lastPriceRef = useRef(0);
  const flashTimeoutRef = useRef<number>(0);
  const marketRef = useRef(market);

  // Keep marketRef always current so socket handlers can read latest values
  useEffect(() => { marketRef.current = market; }, [market]);


  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;
    ensureChart(containerRef.current);
    return () => {
      stopTargetOverlayLoop();
    };
  }, []);

  // Seed chart from candleHistory. This runs on initial connect AND reconnect.
  // candles state only changes from candleHistory events (not individual candle events).
  useEffect(() => {
    if (!_series || candles.length === 0) return;

    const sorted = candles
      .slice()
      .sort((a: any, b: any) => a.time - b.time)
      .filter((c: any) => c.open != null && c.high != null && c.low != null && c.close != null)
      .map((c: any) => ({
        time: c.time as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

    if (sorted.length === 0) return;

    try { _series.setData(sorted); } catch {}
    try { _chart?.timeScale().scrollToRealTime(); } catch {}
  }, [candles]);

  // Socket listeners — poll for socketRef.current since it may not be set on first render.
  // Once attached, stays attached until unmount.
  useEffect(() => {
    let pendingCandle: any = null;
    let rafId: number | null = null;
    let attached = false;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let currentSocket: any = null;

    const flushCandle = () => {
      rafId = null;
      if (pendingCandle && _series) {
        try {
          _series.update({
            time: pendingCandle.time as any,
            open: pendingCandle.open,
            high: pendingCandle.high,
            low: pendingCandle.low,
            close: pendingCandle.close,
          });
        } catch {}
        pendingCandle = null;
      }
    };

    const handleCandle = (candle: any) => {
      if (!candle || candle.open == null || candle.close == null) return;
      updateCandle(candle);
      try { _chart?.timeScale().scrollToRealTime(); } catch {}
    };

    const handleCandleUpdate = (candle: any) => {
      if (!candle || candle.open == null || candle.close == null) return;
      pendingCandle = candle;
      if (rafId === null) {
        rafId = requestAnimationFrame(flushCandle);
      }
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

      const m = marketRef.current;
      if (diffDisplayRef.current && m) {
        const diff = tick.price - m.openPrice;
        const pct = m.openPrice > 0 ? (diff / m.openPrice) * 100 : 0;
        const isUp = diff >= 0;
        diffDisplayRef.current.className = `price-diff ${isUp ? 'up' : 'down'}`;
        diffDisplayRef.current.textContent = `${isUp ? '+' : ''}${diff.toFixed(2)} (${isUp ? '+' : ''}${pct.toFixed(3)}%)`;
      }
    };

    function tryAttach() {
      const socket = socketRef?.current;
      if (!socket || attached) return;
      attached = true;
      currentSocket = socket;
      if (pollId) { clearInterval(pollId); pollId = null; }
      socket.on('candle', handleCandle);
      socket.on('candleUpdate', handleCandleUpdate);
      socket.on('priceTick', handleTick);
    }

    // Try immediately, then poll every 100ms until socket is available
    tryAttach();
    if (!attached) {
      pollId = setInterval(tryAttach, 100);
    }

    return () => {
      if (pollId) clearInterval(pollId);
      if (currentSocket) {
        currentSocket.off('candle', handleCandle);
        currentSocket.off('candleUpdate', handleCandleUpdate);
        currentSocket.off('priceTick', handleTick);
      }
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

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
