import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiBase } from '../services/api';

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
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [orderbook, setOrderbook] = useState<OrderBookSnapshot>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [settledMarkets, setSettledMarkets] = useState<Market[]>([]);

  useEffect(() => {
    const socket = io(getApiBase(), { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('priceTick', (tick: PriceTick) => {
      setCurrentPrice(tick.price);
      setPriceHistory(prev => {
        const next = [...prev, tick];
        return next.length > 300 ? next.slice(-300) : next;
      });
    });

    // Candle data — history bulk load
    socket.on('candleHistory', (history: Candle[]) => {
      setCandles(history);
    });

    // Closed candle — add to state (PriceChart also listens directly via socketRef)
    socket.on('candle', (candle: Candle) => {
      setCandles(prev => {
        const next = [...prev, candle];
        return next.length > 720 ? next.slice(-720) : next;
      });
    });

    // Live candle update — still set state as fallback, but PriceChart
    // primarily listens directly via socketRef for smooth rAF rendering
    socket.on('candleUpdate', (candle: Candle) => {
      setLiveCandle(candle);
    });

    socket.on('market', (data: { market: Market; orderbook: OrderBookSnapshot }) => {
      setMarket(data.market);
      setOrderbook(data.orderbook);
    });

    socket.on('marketOpen', (m: Market) => setMarket(m));
    socket.on('marketClosing', (m: Market) => setMarket(m));
    socket.on('marketSettled', (m: Market) => {
      setSettledMarkets(prev => [m, ...prev].slice(0, 20));
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
