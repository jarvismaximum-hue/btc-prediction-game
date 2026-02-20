/**
 * Polymarket-style fee model:
 * - Taker fee: shares * 0.25 * (p * (1 - p))^2
 *   - Peaks at ~1.5625% when p = 0.5
 *   - Approaches 0% at extremes (p near 0 or 1)
 * - Maker fee: 0% (makers add liquidity to order book)
 * - Maker rebate: 20% of taker fees redistributed to makers
 * - Platform fee: 1% flat on all GALA transactions
 */

export interface FeeBreakdown {
  takerFee: number;
  makerRebate: number;
  platformFee: number;
  totalFee: number;
  netCost: number; // amount + totalFee
}

/** Calculate taker fee per Polymarket formula */
export function calcTakerFee(shares: number, probability: number): number {
  const p = Math.max(0.01, Math.min(0.99, probability));
  const factor = p * (1 - p);
  return shares * 0.25 * factor * factor;
}

/** Calculate full fee breakdown for a trade */
export function calcFees(shares: number, pricePerShare: number, isMaker: boolean): FeeBreakdown {
  const probability = Math.max(0.01, Math.min(0.99, pricePerShare));
  const grossAmount = shares * pricePerShare;
  const platformFee = grossAmount * 0.01; // 1% flat

  if (isMaker) {
    // Makers pay no trading fee, receive rebate from taker fees (handled at match time)
    return {
      takerFee: 0,
      makerRebate: 0,
      platformFee,
      totalFee: platformFee,
      netCost: grossAmount + platformFee,
    };
  }

  const takerFee = calcTakerFee(shares, probability);
  return {
    takerFee,
    makerRebate: 0, // rebate goes to maker, not deducted from taker
    platformFee,
    totalFee: takerFee + platformFee,
    netCost: grossAmount + takerFee + platformFee,
  };
}

/** Calculate maker rebate from a matched taker trade */
export function calcMakerRebate(takerFee: number): number {
  return takerFee * 0.20; // 20% of taker fee goes to maker
}
