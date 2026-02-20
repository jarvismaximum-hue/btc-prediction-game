import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { OrderBook, Side, Trade } from './orderbook';
import { PriceEngine } from './price-engine';
import { GalaChainService } from './galachain';
import { calcFees } from './fees';

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
  private balances: Map<string, number> = new Map(); // userId -> GALA balance
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

  getBalance(userId: string): number {
    return this.balances.get(userId) || 0;
  }

  getPositions(userId: string): Position[] {
    return this.positions.get(userId) || [];
  }

  getRecentMarkets(limit = 10): Market[] {
    return Array.from(this.markets.values())
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);
  }

  /** Credit user's in-game balance (mock/dev) */
  creditBalance(userId: string, amount: number): void {
    const current = this.balances.get(userId) || 0;
    this.balances.set(userId, current + amount);
    this.galachain.creditMockBalance(userId, amount);
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
  placeOrder(userId: string, side: Side, price: number, shares: number): { order: any; trades: Trade[] } {
    const market = this.currentMarket;
    if (!market || market.status !== 'trading') {
      throw new Error('No active market for trading');
    }

    // Check balance
    const fees = calcFees(shares, price, false); // worst case: taker fees
    const requiredBalance = fees.netCost;
    const userBalance = this.getBalance(userId);
    if (userBalance < requiredBalance) {
      throw new Error(`Insufficient balance. Need ${requiredBalance.toFixed(4)} GALA, have ${userBalance.toFixed(4)}`);
    }

    // Deduct cost from balance
    this.balances.set(userId, userBalance - requiredBalance);

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
  cancelOrder(userId: string, orderId: string): boolean {
    const market = this.currentMarket;
    if (!market || market.status !== 'trading') return false;

    const ob = this.orderBooks.get(market.id);
    if (!ob) return false;

    const cancelled = ob.cancelOrder(orderId);
    if (cancelled && cancelled.userId === userId) {
      // Refund the unfilled portion
      const unfilled = cancelled.shares - cancelled.filled;
      const refund = unfilled * cancelled.price;
      this.balances.set(userId, (this.balances.get(userId) || 0) + refund);
      this.emit('orderCancelled', { market, order: cancelled });
      return true;
    }
    return false;
  }

  private createNextMarket(): void {
    const price = this.priceEngine.price;
    if (price <= 0) {
      // Wait for first price tick
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

  private settleMarket(marketId: string): void {
    const market = this.markets.get(marketId);
    if (!market || !market.outcome) return;

    market.status = 'settled';
    market.settledAt = Date.now();

    // Pay out winning positions
    const ob = this.orderBooks.get(marketId);
    if (ob) {
      const trades = ob.getAllTrades();
      const userShares = new Map<string, { UP: number; DOWN: number }>();

      // Calculate net shares per user from trades
      for (const trade of trades) {
        // This is simplified — in production you'd track through order ownership
      }
    }

    // Simplified payout: iterate positions
    for (const [userId, positions] of this.positions.entries()) {
      for (const pos of positions) {
        if (pos.marketId !== marketId) continue;

        if (pos.side === market.outcome) {
          // Winner: pay out 1 GALA per share (minus avg cost already deducted)
          const payout = pos.shares; // shares resolve to 1.0 each
          const profit = payout - (pos.shares * pos.avgPrice);
          pos.pnl = profit;
          this.balances.set(userId, (this.balances.get(userId) || 0) + payout);
        } else {
          // Loser: shares resolve to 0
          pos.pnl = -(pos.shares * pos.avgPrice);
        }
      }
    }

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
