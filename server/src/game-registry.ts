/**
 * Game Registry — manages all game types and their active markets.
 * Each game type has its own engine that handles market creation, resolution, and data feeds.
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { OrderBook, Side, Trade } from './orderbook';
import { calcFees } from './fees';
import * as db from './db';

export type MarketStatus = 'pending' | 'trading' | 'settling' | 'settled';
export type Outcome = 'UP' | 'DOWN' | null;

export interface Market {
  id: string;
  gameType: string;
  status: MarketStatus;
  title: string;
  description: string;
  openValue: number;
  closeValue: number;
  outcome: Outcome;
  startTime: number;
  endTime: number;
  settledAt: number | null;
  metadata: Record<string, any>;
}

export interface Position {
  userId: string;
  marketId: string;
  gameType: string;
  side: Side;
  shares: number;
  avgPrice: number;
  pnl: number;
}

export interface GameConfig {
  type: string;
  name: string;
  description: string;
  icon: string;
  durationMs: number;
  settleDelayMs: number;
  /** Function that returns the current value to track */
  getCurrentValue: () => Promise<number>;
  /** Function that returns metadata for the market title/description */
  getMarketInfo: (openValue: number) => { title: string; description: string };
  /** Optional: custom resolution logic. Default: UP if close >= open */
  resolveOutcome?: (openValue: number, closeValue: number) => Outcome;
}

const PLATFORM_WALLET = process.env.PLATFORM_WALLET || '0x522769cB379cb7DF64Da1FEe299A207107de97c1';

export class GameRegistry extends EventEmitter {
  private games: Map<string, GameConfig> = new Map();
  private markets: Map<string, Market> = new Map();
  private orderBooks: Map<string, OrderBook> = new Map();
  private positions: Map<string, Position[]> = new Map(); // userId -> positions
  private currentMarkets: Map<string, string> = new Map(); // gameType -> current marketId
  private marketTimers: Map<string, NodeJS.Timeout> = new Map();

  registerGame(config: GameConfig): void {
    this.games.set(config.type, config);
    console.log(`[GameRegistry] Registered game: ${config.name} (${config.type})`);
  }

  getGames(): GameConfig[] {
    return Array.from(this.games.values());
  }

  getGame(type: string): GameConfig | undefined {
    return this.games.get(type);
  }

  getCurrentMarket(gameType: string): Market | null {
    const marketId = this.currentMarkets.get(gameType);
    if (!marketId) return null;
    return this.markets.get(marketId) || null;
  }

  getOrderBook(marketId: string): OrderBook | null {
    return this.orderBooks.get(marketId) || null;
  }

  getRecentMarkets(gameType: string, limit = 10): Market[] {
    return Array.from(this.markets.values())
      .filter(m => m.gameType === gameType)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);
  }

  getAllCurrentMarkets(): Market[] {
    const result: Market[] = [];
    for (const marketId of this.currentMarkets.values()) {
      const m = this.markets.get(marketId);
      if (m) result.push(m);
    }
    return result;
  }

  /** Start market cycles for all registered games */
  async startAll(): Promise<void> {
    for (const [gameType] of this.games) {
      this.startGameCycle(gameType);
    }
  }

  /** Start market cycle for a specific game */
  async startGameCycle(gameType: string): Promise<void> {
    const game = this.games.get(gameType);
    if (!game) return;
    console.log(`[GameRegistry] Starting cycle for ${game.name}`);
    this.createNextMarket(gameType);
  }

  stopAll(): void {
    for (const [, timer] of this.marketTimers) {
      clearTimeout(timer);
    }
    this.marketTimers.clear();
  }

  /** Place an order in a specific market */
  async placeOrder(userId: string, marketId: string, side: Side, price: number, shares: number): Promise<{ order: any; trades: Trade[] }> {
    const market = this.markets.get(marketId);
    if (!market || market.status !== 'trading') {
      throw new Error('No active market for trading');
    }

    const fees = calcFees(shares, price, false);
    const betCost = shares * price;
    const totalFee = fees.platformFee + fees.takerFee;

    // Atomically debit bet cost + fees
    const debits: Array<{ amount: number; type: string; marketId?: string; details?: Record<string, any> }> = [
      { amount: betCost, type: 'bet', marketId: market.id, details: { side, price, shares, gameType: market.gameType } },
    ];
    if (totalFee > 0) {
      debits.push({
        amount: totalFee, type: 'fee', marketId: market.id,
        details: { platformFee: fees.platformFee, takerFee: fees.takerFee, side, price, shares },
      });
    }
    await db.debitMultiple(userId, debits);

    // Credit platform wallet with collected fees
    if (totalFee > 0) {
      await db.credit(PLATFORM_WALLET, totalFee, 'fee_collected', undefined, market.id, {
        fromUser: userId,
        platformFee: fees.platformFee,
        takerFee: fees.takerFee,
      });
    }

    const ob = this.orderBooks.get(market.id)!;
    const result = ob.placeOrder(userId, side, price, shares);

    // Track positions
    this.updatePosition(userId, market.id, market.gameType, side, result.order.filled || shares, price);

    // Emit events
    this.emit('order', { market, order: result.order, trades: result.trades });
    if (result.trades.length > 0) {
      this.emit('trades', { market, trades: result.trades });
    }

    return result;
  }

  /** Cancel an order */
  async cancelOrder(userId: string, marketId: string, orderId: string): Promise<boolean> {
    const market = this.markets.get(marketId);
    if (!market || market.status !== 'trading') return false;

    const ob = this.orderBooks.get(market.id);
    if (!ob) return false;

    const cancelled = ob.cancelOrder(orderId);
    if (cancelled && cancelled.userId === userId) {
      const unfilled = cancelled.shares - cancelled.filled;
      const refund = unfilled * cancelled.price;
      await db.credit(userId, refund, 'refund', undefined, market.id, { orderId, unfilled });
      this.emit('orderCancelled', { market, order: cancelled });
      return true;
    }
    return false;
  }

  getPositions(userId: string): Position[] {
    return this.positions.get(userId) || [];
  }

  getUserOrders(userId: string, gameType?: string): any[] {
    const marketId = gameType ? this.currentMarkets.get(gameType) : undefined;
    if (gameType && !marketId) return [];

    // If gameType specified, only return orders for that game's current market
    if (marketId) {
      const ob = this.orderBooks.get(marketId);
      return ob ? ob.getUserOrders(userId) : [];
    }

    // Otherwise return orders across all current markets
    const allOrders: any[] = [];
    for (const mid of this.currentMarkets.values()) {
      const ob = this.orderBooks.get(mid);
      if (ob) allOrders.push(...ob.getUserOrders(userId));
    }
    return allOrders;
  }

  // --- Private ---

  private async createNextMarket(gameType: string): Promise<void> {
    const game = this.games.get(gameType);
    if (!game) return;

    let value: number;
    try {
      value = await game.getCurrentValue();
    } catch (err) {
      console.log(`[GameRegistry] Waiting for ${game.name} data...`);
      const timer = setTimeout(() => this.createNextMarket(gameType), 2000);
      this.marketTimers.set(gameType, timer);
      return;
    }

    if (value <= 0) {
      console.log(`[GameRegistry] Waiting for ${game.name} data (value=0)...`);
      const timer = setTimeout(() => this.createNextMarket(gameType), 2000);
      this.marketTimers.set(gameType, timer);
      return;
    }

    const now = Date.now();
    const info = game.getMarketInfo(value);
    const market: Market = {
      id: uuid(),
      gameType,
      status: 'trading',
      title: info.title,
      description: info.description,
      openValue: value,
      closeValue: 0,
      outcome: null,
      startTime: now,
      endTime: now + game.durationMs,
      settledAt: null,
      metadata: {},
    };

    this.markets.set(market.id, market);
    this.orderBooks.set(market.id, new OrderBook(market.id));
    this.currentMarkets.set(gameType, market.id);

    console.log(`[GameRegistry] ${game.name} market ${market.id.slice(0, 8)} opened: ${info.title}`);
    this.emit('marketOpen', market);

    // Schedule close
    const timer = setTimeout(() => this.closeMarket(gameType, market.id), game.durationMs);
    this.marketTimers.set(`${gameType}-${market.id}`, timer);
  }

  private async closeMarket(gameType: string, marketId: string): Promise<void> {
    const market = this.markets.get(marketId);
    const game = this.games.get(gameType);
    if (!market || !game) return;

    market.status = 'settling';

    try {
      market.closeValue = await game.getCurrentValue();
    } catch {
      market.closeValue = market.openValue; // fallback to open value
    }

    // Resolve outcome
    if (game.resolveOutcome) {
      market.outcome = game.resolveOutcome(market.openValue, market.closeValue);
    } else {
      market.outcome = market.closeValue >= market.openValue ? 'UP' : 'DOWN';
    }

    console.log(`[GameRegistry] ${game.name} market ${marketId.slice(0, 8)} closing. Open: ${market.openValue}, Close: ${market.closeValue}, Outcome: ${market.outcome}`);
    this.emit('marketClosing', market);

    // Settle after delay
    setTimeout(() => this.settleMarket(gameType, marketId), game.settleDelayMs);

    // Start next market
    this.createNextMarket(gameType);
  }

  private async settleMarket(gameType: string, marketId: string): Promise<void> {
    const market = this.markets.get(marketId);
    if (!market || !market.outcome) return;

    market.status = 'settled';
    market.settledAt = Date.now();

    // Pay out winners
    for (const [userId, positions] of this.positions.entries()) {
      for (const pos of positions) {
        if (pos.marketId !== marketId) continue;

        if (pos.side === market.outcome) {
          const grossPayout = pos.shares;
          const payoutFee = grossPayout * 0.05; // 5% platform fee on winnings
          const netPayout = grossPayout - payoutFee;
          const profit = netPayout - (pos.shares * pos.avgPrice);
          pos.pnl = profit;
          await db.credit(userId, netPayout, 'payout', undefined, marketId, {
            side: pos.side, shares: pos.shares, avgPrice: pos.avgPrice, profit, fee: payoutFee, gameType,
          });
          if (payoutFee > 0) {
            await db.credit(PLATFORM_WALLET, payoutFee, 'fee_collected', undefined, marketId, {
              fromUser: userId, type: 'payout_fee', grossPayout, fee: payoutFee,
            });
          }
        } else {
          pos.pnl = -(pos.shares * pos.avgPrice);
        }
      }
    }

    // Persist to DB
    await db.saveSettledMarket({
      id: market.id,
      gameType: market.gameType,
      openPrice: market.openValue,
      closePrice: market.closeValue,
      outcome: market.outcome!,
      startTime: market.startTime,
      endTime: market.endTime,
      settledAt: market.settledAt!,
    });

    console.log(`[GameRegistry] ${gameType} market ${marketId.slice(0, 8)} settled: ${market.outcome}`);
    this.emit('marketSettled', market);
  }

  private updatePosition(userId: string, marketId: string, gameType: string, side: Side, shares: number, price: number): void {
    if (!this.positions.has(userId)) {
      this.positions.set(userId, []);
    }
    const userPositions = this.positions.get(userId)!;

    const existing = userPositions.find(p => p.marketId === marketId && p.side === side);
    if (existing) {
      const totalShares = existing.shares + shares;
      existing.avgPrice = (existing.avgPrice * existing.shares + price * shares) / totalShares;
      existing.shares = totalShares;
    } else {
      userPositions.push({ userId, marketId, gameType, side, shares, avgPrice: price, pnl: 0 });
    }
  }
}
