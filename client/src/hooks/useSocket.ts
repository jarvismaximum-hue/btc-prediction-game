import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiBase, apiFetch } from '../services/api';

export interface PriceTick {
  price: number;
  timestamp: number;
  volume: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Market {
  id: string;
  status: 'pending' | 'trading' | 'settling' | 'settled';
  openPrice: number;
  closePrice: number;
  outcome: 'UP' | 'DOWN' | null;
  startTime: number;
  endTime: number;
  settledAt: number | null;
}

export interface OrderBookLevel {
  price: number;
  shares: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [priceHistory, setPriceHistory] = useState<PriceTick[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [liveCandle] = useState<Candle | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [orderbook, setOrderbook] = useState<OrderBookSnapshot>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [settledMarkets, setSettledMarkets] = useState<Market[]>([]);

  // Fetch persisted settled markets on mount
  useEffect(() => {
    apiFetch('/api/markets/settled')
      .then(res => res.ok ? res.json() : [])
      .then((markets: Market[]) => {
        if (markets.length > 0) setSettledMarkets(markets);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const socket = io(getApiBase(), { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // Server already emits candleHistory on every new connection — no need to re-request
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('priceTick', (tick: PriceTick) => {
      setCurrentPrice(tick.price);
      setPriceHistory(prev => {
        const next = [...prev, tick];
        return next.length > 300 ? next.slice(-300) : next;
      });
    });

    // Candle data — history bulk load (only from candleHistory events)
    socket.on('candleHistory', (history: Candle[]) => {
      setCandles(history);
    });

    // Closed candle — PriceChart handles these directly via socketRef.
    // We do NOT update candles state here to avoid triggering setData() re-calls.
    socket.on('candle', (_candle: Candle) => {
      // no-op: PriceChart listens directly
    });

    // Live candle update — still set state as fallback, but PriceChart
    // primarily listens directly via socketRef for smooth rAF rendering
    socket.on('candleUpdate', (_candle: Candle) => {
      // no-op: PriceChart listens directly via socketRef
    });

    socket.on('market', (data: { market: Market; orderbook: OrderBookSnapshot }) => {
      setMarket(data.market);
      setOrderbook(data.orderbook);
    });

    socket.on('marketOpen', (m: Market) => setMarket(m));
    socket.on('marketClosing', (m: Market) => setMarket(m));
    socket.on('marketSettled', (m: Market) => {
      setSettledMarkets(prev => {
        // Deduplicate — don't add if already in the list (e.g. loaded from DB)
        const filtered = prev.filter(p => p.id !== m.id);
        return [m, ...filtered].slice(0, 20);
      });
    });
    socket.on('trades', (trades: any[]) => {
      setRecentTrades(prev => [...trades, ...prev].slice(0, 30));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return {
    socketRef,  // Expose raw socket ref for imperative access
    connected,
    currentPrice,
    priceHistory,
    candles,
    liveCandle,
    market,
    orderbook,
    recentTrades,
    settledMarkets,
  };
}
