/**
 * Stock Price Games — Will SPY/QQQ go UP or DOWN?
 * Data feed: Yahoo Finance quote endpoint (free, no API key)
 * Only runs during US market hours (9:30 AM - 4:00 PM ET, Mon-Fri)
 */

import type { GameConfig } from '../game-registry';

const STOCK_CACHE: Map<string, { price: number; timestamp: number }> = new Map();
const CACHE_TTL_MS = 5000; // 5 second cache

async function fetchStockPrice(symbol: string): Promise<number> {
  const cached = STOCK_CACHE.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.price;

  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`);
    const data: any = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice || 0;
    if (price > 0) STOCK_CACHE.set(symbol, { price, timestamp: Date.now() });
    return price;
  } catch (err) {
    console.error(`[Stock] Failed to fetch ${symbol}:`, err);
    return STOCK_CACHE.get(symbol)?.price || 0;
  }
}

export function createStockGame(symbol: string, name: string, icon: string): GameConfig {
  return {
    type: `stock-${symbol.toLowerCase()}`,
    name: `${name} Price`,
    description: `Predict whether ${name} (${symbol}) will go UP or DOWN in the next 5 minutes`,
    icon,
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 5000,
    getCurrentValue: () => fetchStockPrice(symbol),
    getMarketInfo: (openValue: number) => ({
      title: `${symbol} $${openValue.toFixed(2)} — UP or DOWN?`,
      description: `Will ${name} be above or below $${openValue.toFixed(2)} in 5 minutes?`,
    }),
  };
}
