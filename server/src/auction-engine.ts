/**
 * Auction Engine — Dutch auction game integrated into ProfitPlay.
 * Adapted from the standalone token-auction-game to use ProfitPlay's
 * wallet auth system and PostgreSQL balance tracking.
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import * as db from './db';

// ============================================================
// Types
// ============================================================

export type AuctionPhase = 'PENDING' | 'AUCTION' | 'BURN' | 'SETTLEMENT' | 'COMPLETED';

export interface AuctionGame {
  id: string;
  name: string;
  tokenSymbol: string;
  phase: AuctionPhase;
  createdAt: number;

  totalSupply: number;
  remainingSupply: number;
  auctionStartPrice: number;
  auctionFloorPrice: number;
  auctionDecayRate: number;
  auctionDurationMs: number;
  auctionStartedAt: number | null;
  auctionEndsAt: number | null;

  burnStartFee: number;
  burnDecayRate: number;
  burnDurationMs: number;
  burnStartedAt: number | null;
  burnEndsAt: number | null;

  settlementStartedAt: number | null;
  settlementGracePeriodMs: number;
  completedAt: number | null;

  potAmount: number;
  platformFeeRate: number;
  platformFeesCollected: number;
  totalTokensBurned: number;

  priceHistory: { timestamp: number; price: number }[];
}

export interface AuctionTransaction {
  id: string;
  auctionId: string;
  address: string;
  type: 'BUY' | 'BURN' | 'SETTLEMENT_BURN';
  tokenAmount: number;
  ethAmount: number;
  pricePerToken: number;
  fee: number;
  timestamp: number;
}

// ============================================================
// In-Memory State (auctions + token balances)
// ============================================================

// Token balances are auction-specific, tracked in-memory (not in PG)
// GALA balances stay in PG via db.credit/debit
const tokenBalances = new Map<string, number>(); // `${address}:${auctionId}` -> token count

const PLATFORM_WALLET = process.env.PLATFORM_WALLET || '0x522769cB379cb7DF64Da1FEe299A207107de97c1';

function balanceKey(address: string, auctionId: string): string {
  return `${address.toLowerCase()}:${auctionId}`;
}

function round(n: number, decimals = 8): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// ============================================================
// Auction Engine
// ============================================================

export class AuctionEngine extends EventEmitter {
  private auctions: Map<string, AuctionGame> = new Map();
  private transactions: AuctionTransaction[] = [];
  private tickInterval: NodeJS.Timeout | null = null;
  private auctionCounter = 0;

  start(): void {
    if (this.tickInterval) return;
    this.spawnNextAuction();
    this.tickInterval = setInterval(() => this.tick(), 1000);
    console.log('[AuctionEngine] Started');
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  // --- Public getters ---

  getAuctions(): AuctionGame[] {
    return Array.from(this.auctions.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getActiveAuction(): AuctionGame | null {
    for (const a of this.auctions.values()) {
      if (a.phase !== 'COMPLETED') return a;
    }
    return null;
  }

  getAuction(id: string): AuctionGame | null {
    return this.auctions.get(id) || null;
  }

  getCurrentPrice(game: AuctionGame): number {
    if (game.phase !== 'AUCTION' || !game.auctionStartedAt) {
      if (game.priceHistory.length > 0) {
        return game.priceHistory[game.priceHistory.length - 1].price;
      }
      return game.auctionStartPrice;
    }
    const elapsedMs = Date.now() - game.auctionStartedAt;
    const elapsedHours = elapsedMs / 3600000;
    const floor = game.auctionFloorPrice;
    const start = game.auctionStartPrice;
    const price = floor + (start - floor) * Math.exp(-game.auctionDecayRate * elapsedHours);
    return Math.max(floor, round(price, 4));
  }

  getCurrentBurnFee(game: AuctionGame): number {
    if (game.phase !== 'BURN' || !game.burnStartedAt) {
      if (game.phase === 'SETTLEMENT') return 0;
      return game.burnStartFee;
    }
    const elapsedMs = Date.now() - game.burnStartedAt;
    const elapsedHours = elapsedMs / 3600000;
    return Math.max(0, game.burnStartFee * Math.exp(-game.burnDecayRate * elapsedHours));
  }

  getTokenBalance(address: string, auctionId: string): number {
    return tokenBalances.get(balanceKey(address, auctionId)) || 0;
  }

  getTotalRemainingTokens(auctionId: string): number {
    let total = 0;
    for (const [key, amount] of tokenBalances.entries()) {
      if (key.endsWith(`:${auctionId}`)) total += amount;
    }
    return total;
  }

  getTransactions(auctionId: string): AuctionTransaction[] {
    return this.transactions
      .filter(tx => tx.auctionId === auctionId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100);
  }

  // --- Actions ---

  async buyTokens(address: string, auctionId: string, ethAmount: number): Promise<AuctionTransaction> {
    const game = this.auctions.get(auctionId);
    if (!game) throw new Error('Auction not found');
    if (game.phase !== 'AUCTION') throw new Error('Auction not in buying phase');
    if (ethAmount <= 0) throw new Error('Amount must be positive');

    const currentPrice = this.getCurrentPrice(game);
    const platformFee = round(ethAmount * game.platformFeeRate);
    const netAmount = round(ethAmount - platformFee);
    let tokenAmount = Math.floor(netAmount / currentPrice);

    if (tokenAmount <= 0) throw new Error('Amount too small to buy any tokens');
    if (tokenAmount > game.remainingSupply) tokenAmount = game.remainingSupply;

    const actualSpent = round(tokenAmount * currentPrice);
    const actualFee = round(actualSpent * game.platformFeeRate / (1 - game.platformFeeRate));
    const totalCost = round(actualSpent + actualFee);

    // Debit GALA from user's PG balance
    await db.debit(address, totalCost, 'auction_buy', undefined, auctionId, {
      tokenAmount, pricePerToken: currentPrice, fee: actualFee,
    });

    // Credit platform wallet
    if (actualFee > 0) {
      await db.credit(PLATFORM_WALLET, actualFee, 'auction_fee', undefined, auctionId, {
        fromUser: address, type: 'buy_fee',
      });
    }

    // Update auction state
    game.remainingSupply -= tokenAmount;
    game.potAmount = round(game.potAmount + actualSpent);
    game.platformFeesCollected = round(game.platformFeesCollected + actualFee);

    // Credit tokens
    const key = balanceKey(address, auctionId);
    tokenBalances.set(key, (tokenBalances.get(key) || 0) + tokenAmount);

    const tx: AuctionTransaction = {
      id: uuidv4(),
      auctionId,
      address,
      type: 'BUY',
      tokenAmount,
      ethAmount: totalCost,
      pricePerToken: currentPrice,
      fee: actualFee,
      timestamp: Date.now(),
    };
    this.transactions.push(tx);

    this.emit('auction:buy', tx);
    this.emit('auction:potUpdate', { auctionId, potAmount: game.potAmount });

    // Check sellout
    if (game.remainingSupply <= 0) {
      this.transitionPhase(game, 'BURN');
    }

    return tx;
  }

  async burnTokens(address: string, auctionId: string, tokenAmount: number): Promise<AuctionTransaction> {
    const game = this.auctions.get(auctionId);
    if (!game) throw new Error('Auction not found');
    if (game.phase !== 'BURN' && game.phase !== 'SETTLEMENT') {
      throw new Error('Auction not in burn phase');
    }
    if (tokenAmount <= 0) throw new Error('Amount must be positive');

    const key = balanceKey(address, auctionId);
    const balance = tokenBalances.get(key) || 0;
    if (balance < tokenAmount) throw new Error('Insufficient token balance');

    const totalRemaining = this.getTotalRemainingTokens(auctionId);
    const burnFee = game.phase === 'SETTLEMENT' ? 0 : this.getCurrentBurnFee(game);

    const proRataShare = tokenAmount / totalRemaining;
    const grossClaim = round(proRataShare * game.potAmount);
    const feeAmount = round(grossClaim * burnFee);
    const netClaim = round(grossClaim - feeAmount);

    // Burn tokens
    tokenBalances.set(key, balance - tokenAmount);

    // Credit GALA to user
    if (netClaim > 0) {
      await db.credit(address, netClaim, 'auction_burn', undefined, auctionId, {
        tokenAmount, grossClaim, burnFee, feeAmount,
      });
    }

    // Update auction state
    game.potAmount = round(game.potAmount - netClaim);
    game.totalTokensBurned += tokenAmount;

    const tx: AuctionTransaction = {
      id: uuidv4(),
      auctionId,
      address,
      type: game.phase === 'SETTLEMENT' ? 'SETTLEMENT_BURN' : 'BURN',
      tokenAmount,
      ethAmount: netClaim,
      pricePerToken: tokenAmount > 0 ? round(netClaim / tokenAmount, 6) : 0,
      fee: feeAmount,
      timestamp: Date.now(),
    };
    this.transactions.push(tx);

    this.emit('auction:burn', tx);
    this.emit('auction:potUpdate', { auctionId, potAmount: game.potAmount });

    return tx;
  }

  // --- Internal ---

  private spawnNextAuction(): void {
    this.auctionCounter++;
    const durationMs = 10 * 60 * 1000; // 10 minutes
    const decayRate = 3.0 / (durationMs / 3600000); // ~95% decay by end

    const game: AuctionGame = {
      id: uuidv4(),
      name: `Auction #${this.auctionCounter}`,
      tokenSymbol: 'GEN',
      phase: 'AUCTION',
      createdAt: Date.now(),

      totalSupply: 100_000,
      remainingSupply: 100_000,
      auctionStartPrice: 1.0,
      auctionFloorPrice: 0.01,
      auctionDecayRate: decayRate,
      auctionDurationMs: durationMs,
      auctionStartedAt: Date.now(),
      auctionEndsAt: Date.now() + durationMs,

      burnStartFee: 0.5,
      burnDecayRate: decayRate,
      burnDurationMs: durationMs,
      burnStartedAt: null,
      burnEndsAt: null,

      settlementStartedAt: null,
      settlementGracePeriodMs: 30_000,
      completedAt: null,

      potAmount: 0,
      platformFeeRate: 0.02,
      platformFeesCollected: 0,
      totalTokensBurned: 0,

      priceHistory: [{ timestamp: Date.now(), price: 1.0 }],
    };

    this.auctions.set(game.id, game);
    this.emit('auction:phaseChange', { auctionId: game.id, phase: 'AUCTION', game });
    console.log(`[AuctionEngine] New auction: "${game.name}" (${game.id.slice(0, 8)})`);
  }

  private transitionPhase(game: AuctionGame, phase: AuctionPhase): void {
    const now = Date.now();
    switch (phase) {
      case 'BURN':
        game.phase = 'BURN';
        game.burnStartedAt = now;
        game.burnEndsAt = now + game.burnDurationMs;
        break;
      case 'SETTLEMENT':
        game.phase = 'SETTLEMENT';
        game.settlementStartedAt = now;
        break;
      case 'COMPLETED':
        game.phase = 'COMPLETED';
        game.completedAt = now;
        break;
    }
    this.emit('auction:phaseChange', { auctionId: game.id, phase, game });
  }

  private tick(): void {
    const now = Date.now();
    let needsNewAuction = false;

    for (const game of this.auctions.values()) {
      switch (game.phase) {
        case 'AUCTION': {
          if (game.auctionEndsAt && now >= game.auctionEndsAt) {
            this.transitionPhase(game, 'BURN');
          } else {
            const price = this.getCurrentPrice(game);
            const lastPoint = game.priceHistory[game.priceHistory.length - 1];
            if (!lastPoint || now - lastPoint.timestamp >= 10000) {
              game.priceHistory.push({ timestamp: now, price });
            }
          }
          break;
        }
        case 'BURN': {
          if (game.burnEndsAt && now >= game.burnEndsAt) {
            this.transitionPhase(game, 'SETTLEMENT');
          }
          break;
        }
        case 'SETTLEMENT': {
          if (game.settlementStartedAt &&
              now >= game.settlementStartedAt + game.settlementGracePeriodMs) {
            // Unclaimed pot goes to platform
            game.platformFeesCollected = round(game.platformFeesCollected + game.potAmount);
            game.potAmount = 0;
            this.transitionPhase(game, 'COMPLETED');
            needsNewAuction = true;
          }
          break;
        }
      }

      // Emit update for active games
      if (game.phase !== 'COMPLETED' && game.phase !== 'PENDING') {
        this.emit('auction:update', {
          ...game,
          currentPrice: this.getCurrentPrice(game),
          currentBurnFee: this.getCurrentBurnFee(game),
        });
      }
    }

    if (needsNewAuction || !this.hasActiveGame()) {
      this.spawnNextAuction();
    }
  }

  private hasActiveGame(): boolean {
    for (const game of this.auctions.values()) {
      if (game.phase === 'AUCTION' || game.phase === 'BURN' || game.phase === 'SETTLEMENT') {
        return true;
      }
    }
    return false;
  }
}
