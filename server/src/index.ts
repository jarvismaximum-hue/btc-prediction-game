import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import dotenv from 'dotenv';

import { PriceEngine } from './price-engine';
import { MarketManager } from './market-manager';
import { GalaChainService } from './galachain';
import { createAuthRouter, requireAuth } from './auth';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3010', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: (_origin, cb) => cb(null, true), credentials: true }));
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: (_origin: any, cb: any) => cb(null, true), credentials: true },
});

// --- Services ---
const priceEngine = new PriceEngine();
const galachain = new GalaChainService();
const marketManager = new MarketManager(priceEngine, galachain);

// --- Auth routes ---
app.use(createAuthRouter());

// --- Public endpoints ---
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    price: priceEngine.price,
    currentMarket: marketManager.currentMarket,
    mockMode: galachain.isMockMode,
  });
});

app.get('/api/markets', (_req, res) => {
  res.json(marketManager.getRecentMarkets(20));
});

app.get('/api/markets/current', (_req, res): void => {
  const market = marketManager.currentMarket;
  if (!market) { res.json(null); return; }

  const ob = marketManager.getOrderBook(market.id);
  res.json({
    market,
    orderbook: ob?.getSnapshot() || { bids: [], asks: [] },
    trades: ob?.getRecentTrades(20) || [],
  });
});

app.get('/api/price/history', (_req, res) => {
  res.json(priceEngine.history);
});

app.get('/api/price/candles', (_req, res) => {
  res.json(priceEngine.candleHistory);
});

// --- Protected endpoints ---
app.get('/api/account', requireAuth, (req, res) => {
  const user = (req as any).user;
  const balance = marketManager.getBalance(user.address);
  const positions = marketManager.getPositions(user.address);
  res.json({ address: user.address, balance, positions });
});

app.post('/api/order', requireAuth, (req, res): void => {
  const user = (req as any).user;
  const { side, price, shares } = req.body;

  if (!side || !['UP', 'DOWN'].includes(side)) {
    res.status(400).json({ error: 'side must be UP or DOWN' }); return;
  }
  if (typeof price !== 'number' || price < 0.01 || price > 0.99) {
    res.status(400).json({ error: 'price must be between 0.01 and 0.99' }); return;
  }
  if (typeof shares !== 'number' || shares <= 0) {
    res.status(400).json({ error: 'shares must be positive' }); return;
  }

  try {
    const result = marketManager.placeOrder(user.address, side, price, shares);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/order/cancel', requireAuth, (req, res) => {
  const user = (req as any).user;
  const { orderId } = req.body;
  const success = marketManager.cancelOrder(user.address, orderId);
  res.json({ success });
});

// Dev: credit mock balance
app.post('/api/dev/credit', requireAuth, (req, res): void => {
  if (!galachain.isMockMode) {
    res.status(403).json({ error: 'Only available in mock mode' }); return;
  }
  const user = (req as any).user;
  const amount = req.body.amount || 1000;
  marketManager.creditBalance(user.address, amount);
  res.json({ balance: marketManager.getBalance(user.address) });
});

// --- Socket.IO ---
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Send current state immediately
  const market = marketManager.currentMarket;
  if (market) {
    const ob = marketManager.getOrderBook(market.id);
    socket.emit('market', {
      market,
      orderbook: ob?.getSnapshot() || { bids: [], asks: [] },
    });
  }

  // Send candle history
  socket.emit('candleHistory', priceEngine.candleHistory);

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// Forward price ticks to all connected clients (throttled to ~20/sec)
let lastTickEmit = 0;
priceEngine.on('tick', (tick) => {
  const now = Date.now();
  if (now - lastTickEmit >= 50) {
    lastTickEmit = now;
    io.emit('priceTick', tick);
  }
});

// Forward candle data (closed candles + live updates)
priceEngine.on('candle', (candle) => {
  io.emit('candle', candle);
});

// Live candle update (current forming candle) — no throttle; client uses rAF to batch at 60fps
priceEngine.on('candleUpdate', (candle) => {
  io.emit('candleUpdate', candle);
});

// Forward market events
marketManager.on('marketOpen', (market) => {
  io.emit('marketOpen', market);
  const ob = marketManager.getOrderBook(market.id);
  io.emit('market', { market, orderbook: ob?.getSnapshot() || { bids: [], asks: [] } });
});

marketManager.on('marketClosing', (market) => io.emit('marketClosing', market));
marketManager.on('marketSettled', (market) => io.emit('marketSettled', market));

marketManager.on('order', ({ market, order, trades }) => {
  const ob = marketManager.getOrderBook(market.id);
  io.emit('market', { market, orderbook: ob?.getSnapshot() || { bids: [], asks: [] } });
  if (trades.length > 0) io.emit('trades', trades);
});

// --- Start ---
httpServer.listen(PORT, () => {
  console.log(`\n🎮 BTC Prediction Game server running on http://localhost:${PORT}`);
  console.log(`   Mode: ${galachain.isMockMode ? 'MOCK (dev)' : 'LIVE (GalaChain)'}`);
  console.log(`   Frontend: ${FRONTEND_URL}\n`);

  priceEngine.start();
  priceEngine.once('connected', () => {
    console.log('[Server] Price feed connected, starting market cycle');
    marketManager.startCycle();
  });
});
