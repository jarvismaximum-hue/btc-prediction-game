import { v4 as uuid } from 'uuid';
import { calcFees, calcMakerRebate, FeeBreakdown } from './fees';

export type Side = 'UP' | 'DOWN';

export interface Order {
  id: string;
  userId: string;
  marketId: string;
  side: Side;
  price: number;      // 0.01 to 0.99 (probability / price per share in GALA)
  shares: number;
  filled: number;
  status: 'open' | 'partial' | 'filled' | 'cancelled';
  isMaker: boolean;
  fees: FeeBreakdown;
  createdAt: number;
}

export interface Trade {
  id: string;
  marketId: string;
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  shares: number;
  takerFee: number;
  makerRebate: number;
  platformFee: number;
  timestamp: number;
}

export interface OrderBookLevel {
  price: number;
  shares: number;
  orderCount: number;
}

export class OrderBook {
  // bids (buy orders) sorted high→low price, then by time
  private bids: Order[] = [];
  // asks (sell orders) sorted low→high price, then by time
  private asks: Order[] = [];
  private trades: Trade[] = [];

  constructor(public readonly marketId: string) {}

  getSnapshot(): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } {
    return {
      bids: this.aggregateLevels(this.bids),
      asks: this.aggregateLevels(this.asks),
    };
  }

  getRecentTrades(limit = 20): Trade[] {
    return this.trades.slice(-limit);
  }

  getAllTrades(): Trade[] {
    return [...this.trades];
  }

  placeOrder(userId: string, side: Side, price: number, shares: number): { order: Order; trades: Trade[] } {
    if (price < 0.01 || price > 0.99) throw new Error('Price must be between 0.01 and 0.99');
    if (shares <= 0) throw new Error('Shares must be positive');

    const order: Order = {
      id: uuid(),
      userId,
      marketId: this.marketId,
      side,
      price: Math.round(price * 100) / 100,
      shares,
      filled: 0,
      status: 'open',
      isMaker: true, // starts as maker; becomes taker if it matches immediately
      fees: calcFees(shares, price, true),
      createdAt: Date.now(),
    };

    const newTrades = this.matchOrder(order);

    // If order still has unfilled shares, add to book as resting (maker) order
    if (order.filled < order.shares) {
      if (side === 'UP') {
        this.bids.push(order);
        this.bids.sort((a, b) => b.price - a.price || a.createdAt - b.createdAt);
      } else {
        this.asks.push(order);
        this.asks.sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);
      }
    }

    return { order, trades: newTrades };
  }

  cancelOrder(orderId: string): Order | null {
    for (const book of [this.bids, this.asks]) {
      const idx = book.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        const order = book[idx];
        order.status = 'cancelled';
        book.splice(idx, 1);
        return order;
      }
    }
    return null;
  }

  private matchOrder(incomingOrder: Order): Trade[] {
    const newTrades: Trade[] = [];
    // UP orders match against DOWN asks; DOWN orders match against UP bids
    const oppositeBook = incomingOrder.side === 'UP' ? this.asks : this.bids;
    const remaining = () => incomingOrder.shares - incomingOrder.filled;

    while (remaining() > 0 && oppositeBook.length > 0) {
      const restingOrder = oppositeBook[0];

      // Check price compatibility
      // UP buyer willing to pay >= ask price, or DOWN seller willing to accept <= bid price
      const canMatch = incomingOrder.side === 'UP'
        ? incomingOrder.price >= restingOrder.price
        : incomingOrder.price <= restingOrder.price;

      if (!canMatch) break;

      const fillShares = Math.min(remaining(), restingOrder.shares - restingOrder.filled);
      const fillPrice = restingOrder.price; // price-time priority: fill at resting order's price

      // Incoming order is the taker
      incomingOrder.isMaker = false;
      const takerFees = calcFees(fillShares, fillPrice, false);
      const makerRebate = calcMakerRebate(takerFees.takerFee);

      const trade: Trade = {
        id: uuid(),
        marketId: this.marketId,
        buyOrderId: incomingOrder.side === 'UP' ? incomingOrder.id : restingOrder.id,
        sellOrderId: incomingOrder.side === 'DOWN' ? incomingOrder.id : restingOrder.id,
        price: fillPrice,
        shares: fillShares,
        takerFee: takerFees.takerFee,
        makerRebate,
        platformFee: takerFees.platformFee,
        timestamp: Date.now(),
      };

      incomingOrder.filled += fillShares;
      restingOrder.filled += fillShares;

      if (incomingOrder.filled >= incomingOrder.shares) incomingOrder.status = 'filled';
      else incomingOrder.status = 'partial';

      if (restingOrder.filled >= restingOrder.shares) {
        restingOrder.status = 'filled';
        oppositeBook.shift();
      } else {
        restingOrder.status = 'partial';
      }

      // Update fee calculations
      incomingOrder.fees = calcFees(incomingOrder.filled, incomingOrder.price, false);

      newTrades.push(trade);
      this.trades.push(trade);
    }

    return newTrades;
  }

  private aggregateLevels(orders: Order[]): OrderBookLevel[] {
    const levels = new Map<number, { shares: number; count: number }>();
    for (const o of orders) {
      const remaining = o.shares - o.filled;
      if (remaining <= 0) continue;
      const existing = levels.get(o.price) || { shares: 0, count: 0 };
      existing.shares += remaining;
      existing.count++;
      levels.set(o.price, existing);
    }
    return Array.from(levels.entries()).map(([price, { shares, count }]) => ({
      price,
      shares,
      orderCount: count,
    }));
  }
}
