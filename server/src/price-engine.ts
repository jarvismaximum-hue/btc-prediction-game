import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface PriceTick {
  price: number;
  timestamp: number;
  volume: number;
}

export interface Candle {
  time: number; // unix seconds (start of candle)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CANDLE_INTERVAL_MS = 1000; // 1-second candles

export class PriceEngine extends EventEmitter {
  private ws: WebSocket | null = null;
  private currentPrice: number = 0;
  private priceHistory: PriceTick[] = [];
  private maxHistory = 600;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Candle aggregation
  private candles: Candle[] = [];
  private maxCandles = 900; // 15 min of 1s candles
  private currentCandle: Candle | null = null;
  private candleTimer: NodeJS.Timeout | null = null;
  private lastCandleUpdateEmit = 0;

  get price(): number {
    return this.currentPrice;
  }

  get history(): PriceTick[] {
    return [...this.priceHistory];
  }

  get candleHistory(): Candle[] {
    const result = [...this.candles];
    if (this.currentCandle) result.push({ ...this.currentCandle });
    return result;
  }

  start(): void {
    this.connect();
    this.startCandleTimer();
  }

  stop(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.candleTimer) clearInterval(this.candleTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private startCandleTimer(): void {
    // Align to next 5-second boundary
    const now = Date.now();
    const nextBoundary = Math.ceil(now / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS;
    const delay = nextBoundary - now;

    setTimeout(() => {
      this.closeCandle();
      this.candleTimer = setInterval(() => this.closeCandle(), CANDLE_INTERVAL_MS);
    }, delay);
  }

  private closeCandle(): void {
    if (this.currentCandle && this.currentCandle.close > 0) {
      this.candles.push({ ...this.currentCandle });
      if (this.candles.length > this.maxCandles) {
        this.candles = this.candles.slice(-this.maxCandles);
      }
      this.emit('candle', this.currentCandle);
    }
    // Start a new candle
    const candleTime = Math.floor(Date.now() / 1000);
    if (this.currentPrice > 0) {
      this.currentCandle = {
        time: candleTime,
        open: this.currentPrice,
        high: this.currentPrice,
        low: this.currentPrice,
        close: this.currentPrice,
        volume: 0,
      };
    } else {
      this.currentCandle = null;
    }
  }

  private updateCandle(price: number, volume: number): void {
    if (!this.currentCandle) {
      this.currentCandle = {
        time: Math.floor(Date.now() / 1000),
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      };
    } else {
      this.currentCandle.high = Math.max(this.currentCandle.high, price);
      this.currentCandle.low = Math.min(this.currentCandle.low, price);
      this.currentCandle.close = price;
      this.currentCandle.volume += volume;
    }
    // Throttle candleUpdate to ~10/sec — client interpolates between updates
    const now = Date.now();
    if (now - this.lastCandleUpdateEmit >= 100) {
      this.lastCandleUpdateEmit = now;
      this.emit('candleUpdate', { ...this.currentCandle });
    }
  }

  private connect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    this.ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');

    this.ws.on('open', () => {
      console.log('[PriceEngine] Connected to Coinbase BTC-USD stream');
      this.ws!.send(JSON.stringify({
        type: 'subscribe',
        channels: [{ name: 'ticker', product_ids: ['BTC-USD'] }],
      }));
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'ticker') return;
        const price = parseFloat(msg.price);
        const volume = parseFloat(msg.last_size || '0');
        const tick: PriceTick = { price, timestamp: Date.now(), volume };
        this.currentPrice = price;
        this.priceHistory.push(tick);
        if (this.priceHistory.length > this.maxHistory) {
          this.priceHistory = this.priceHistory.slice(-this.maxHistory);
        }
        this.updateCandle(price, volume);
        this.emit('tick', tick);
      } catch (e) {
        // skip malformed messages
      }
    });

    this.ws.on('close', () => {
      console.log('[PriceEngine] Disconnected, reconnecting in 3s...');
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    });

    this.ws.on('error', (err) => {
      console.error('[PriceEngine] WebSocket error:', err.message);
      this.ws?.close();
    });
  }
}
