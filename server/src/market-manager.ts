import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { OrderBook, Side, Trade } from './orderbook';
import { PriceEngine } from './price-engine';
import { GalaChainService } from './galachain';
import { calcFees } from './fees';
import * as db from './db';

export type MarketStatus = 'pending' | 'trading' | 'settling' | 'settled';
export type Outcome = 'UP' | 'DOWN' | null;

export interface Market {
  id: string;
  status: MarketStatus;
  openPrice: number;
  closePrice: number;
  outcome: Outcome;
  startTime: number;
  endTime: number;
  settledAt: number | null;
}

export interface Position {
  userId: string;
  marketId: string;
  side: Side;
  shares: number;
  avgPrice: number;
  pnl: number;
}

const MARKET_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const SETTLE_DELAY_MS = 3000; // 3 seconds to settle after close

export class MarketManager extends EventEmitter {
  private markets: Map<string, Market> = new Map();
  private orderBooks: Map<string, OrderBook> = new Map();
  private positions: Map<string, Position[]> = new Map(); // userId -> positions
  private currentMarketId: string | null = null;
  private marketTimer: NodeJS.Timeout | null = null;

  constructor(
    private priceEngine: PriceEngine,
    private galachain: GalaChainService,
  ) {
    super();
  }

  get currentMarket(): Market | null {
    if (!this.currentMarketId) return null;
    return this.markets.get(this.currentMarketId) || null;
  }

  getMarket(id: string): Market | null {
    return this.markets.get(id) || null;
  }

  getOrderBook(marketId: string): OrderBook | null {
    return this.orderBooks.get(marketId) || null;
  }

  /** Get balance from database */
  async getBalance(userId: string): Promise<number> {
    return db.getBalance(userId);
  }

  /** Get in-game balance */
  async getGalaBalance(userId: string): Promise<number> {
    return db.getBalance(userId);
  }

  getPositions(userId: string): Position[] {
    return this.positions.get(userId) || [];
  }

  getUserOrders(userId: string): any[] {
    const market = this.currentMarket;
    if (!market) return [];
    const ob = this.orderBooks.get(market.id);
    if (!ob) return [];
    return ob.getUserOrders(userId);
  }

  getRecentMarkets(limit = 10): Market[] {
    return Array.from(this.markets.values())
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);
  }

  /** Credit user's in-game balance (persisted) */
  async creditBalance(userId: string, amount: number, type = 'credit', txHash?: string, marketId?: string): Promise<number> {
    return db.credit(userId, amount, type, txHash, marketId);
  }

  /** Debit user's in-game balance (persisted) */
  async debitBalance(userId: string, amount: number, type = 'debit', txHash?: string, marketId?: string): Promise<number> {
    return db.debit(userId, amount, type, txHash, marketId);
  }

  /** Start the market cycle */
  startCycle(): void {
    console.log('[MarketManager] Starting market cycle');
    this.createNextMarket();
  }

  stopCycle(): void {
    if (this.marketTimer) {
      clearTimeout(this.marketTimer);
      this.marketTimer = null;
    }
  }

  /** Place an order in the current market */
  async placeOrder(userId: string, side: Side, price: number, shares: number): Promise<{ order: any; trades: Trade[] }> {
    const market = this.currentMarket;
    if (!market || market.status !== 'trading') {
      throw new Error('No active market for trading');
    }

    const fees = calcFees(shares, price, false);
    const betCost = shares * price;
    const totalFee = fees.platformFee + fees.takerFee;

    // Atomically debit bet cost + fees in a single locked transaction
    const debits: Array<{ amount: number; type: string; marketId?: string; details?: Record<string, any> }> = [
      { amount: betCost, type: 'bet', marketId: market.id, details: { side, price, shares } },
    ];
    if (totalFee > 0) {
      debits.push({
        amount: totalFee, type: 'fee', marketId: market.id,
        details: { platformFee: fees.platformFee, takerFee: fees.takerFee, side, price, shares },
      });
    }
    await db.debitMultiple(userId, debits);

    // Credit platform wallet with collected fees (separate, non-critical)
    if (totalFee > 0) {
      await db.credit(this.galachain.platformWallet, totalFee, 'fee_collected', undefined, market.id, {
        fromUser: userId,
        platformFee: fees.platformFee,
        takerFee: fees.takerFee,
      });
    }

    const ob = this.orderBooks.get(market.id)!;
    const result = ob.placeOrder(userId, side, price, shares);

    // Track positions
    this.updatePosition(userId, market.id, side, result.order.filled || shares, price);

    // Emit events
    this.emit('order', { market, order: result.order, trades: result.trades });
    if (result.trades.length > 0) {
      this.emit('trades', { market, trades: result.trades });
    }

    return result;
  }

  /** Cancel an order */
  async cancelOrder(userId: string, orderId: string): Promise<boolean> {
    const market = this.currentMarket;
    if (!market || market.status !== 'trading') return false;

    const ob = this.orderBooks.get(market.id);
    if (!ob) return false;

    const cancelled = ob.cancelOrder(orderId);
    if (cancelled && cancelled.userId === userId) {
      // Refund the unfilled portion
      const unfilled = cancelled.shares - cancelled.filled;
      const refund = unfilled * cancelled.price;
      await db.credit(userId, refund, 'refund', undefined, market.id, { orderId, unfilled });
      this.emit('orderCancelled', { market, order: cancelled });
      return true;
    }
    return false;
  }

  private createNextMarket(): void {
    const price = this.priceEngine.price;
    if (price <= 0) {
      console.log('[MarketManager] Waiting for price data...');
      this.marketTimer = setTimeout(() => this.createNextMarket(), 1000);
      return;
    }

    const now = Date.now();
    const market: Market = {
      id: uuid(),
      status: 'trading',
      openPrice: price,
      closePrice: 0,
      outcome: null,
      startTime: now,
      endTime: now + MARKET_DURATION_MS,
      settledAt: null,
    };

    this.markets.set(market.id, market);
    this.orderBooks.set(market.id, new OrderBook(market.id));
    this.currentMarketId = market.id;

    console.log(`[MarketManager] Market ${market.id.slice(0, 8)} opened at $${price.toFixed(2)}`);
    this.emit('marketOpen', market);

    // Schedule market close
    this.marketTimer = setTimeout(() => this.closeMarket(market.id), MARKET_DURATION_MS);
  }

  private closeMarket(marketId: string): void {
    const market = this.markets.get(marketId);
    if (!market) return;

    market.status = 'settling';
    market.closePrice = this.priceEngine.price;
    market.outcome = market.closePrice >= market.openPrice ? 'UP' : 'DOWN';

    console.log(`[MarketManager] Market ${marketId.slice(0, 8)} closing. Open: $${market.openPrice.toFixed(2)}, Close: $${market.closePrice.toFixed(2)}, Outcome: ${market.outcome}`);
    this.emit('marketClosing', market);

    // Settle after delay
    setTimeout(() => this.settleMarket(marketId), SETTLE_DELAY_MS);

    // Start next market immediately
    this.createNextMarket();
  }

  private async settleMarket(marketId: string): Promise<void> {
    const market = this.markets.get(marketId);
    if (!market || !market.outcome) return;

    market.status = 'settled';
    market.settledAt = Date.now();

    // Pay out winning positions
    for (const [userId, positions] of this.positions.entries()) {
      for (const pos of positions) {
        if (pos.marketId !== marketId) continue;

        if (pos.side === market.outcome) {
          // Winner: credit in-game balance (1 GALA per share minus platform fee)
          const grossPayout = pos.shares;
          const payoutFee = grossPayout * 0.05; // 5% platform fee on winnings
          const netPayout = grossPayout - payoutFee;
          const profit = netPayout - (pos.shares * pos.avgPrice);
          pos.pnl = profit;
          await db.credit(userId, netPayout, 'payout', undefined, marketId, { side: pos.side, shares: pos.shares, avgPrice: pos.avgPrice, profit, fee: payoutFee });
          // Credit platform wallet with the payout fee
          if (payoutFee > 0) {
            await db.credit(this.galachain.platformWallet, payoutFee, 'fee_collected', undefined, marketId, {
              fromUser: userId,
              type: 'payout_fee',
              grossPayout,
              fee: payoutFee,
            });
          }
        } else {
          // Loser: shares resolve to 0
          pos.pnl = -(pos.shares * pos.avgPrice);
        }
      }
    }

    // Persist to database
    await db.saveSettledMarket({
      id: market.id,
      openPrice: market.openPrice,
      closePrice: market.closePrice,
      outcome: market.outcome!,
      startTime: market.startTime,
      endTime: market.endTime,
      settledAt: market.settledAt!,
    });

    console.log(`[MarketManager] Market ${marketId.slice(0, 8)} settled: ${market.outcome}`);
    this.emit('marketSettled', market);
  }

  private updatePosition(userId: string, marketId: string, side: Side, shares: number, price: number): void {
    if (!this.positions.has(userId)) {
      this.positions.set(userId, []);
    }
    const userPositions = this.positions.get(userId)!;

    const existing = userPositions.find(p => p.marketId === marketId && p.side === side);
    if (existing) {
      // Average in
      const totalShares = existing.shares + shares;
      existing.avgPrice = (existing.avgPrice * existing.shares + price * shares) / totalShares;
      existing.shares = totalShares;
    } else {
      userPositions.push({
        userId,
        marketId,
        side,
        shares,
        avgPrice: price,
        pnl: 0,
      });
    }
  }
}
