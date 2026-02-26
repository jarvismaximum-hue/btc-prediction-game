/**
 * ETH Gas Price Game — Will Ethereum gas fees go UP or DOWN?
 * Data feed: Public Ethereum RPC (free)
 * Gas prices fluctuate significantly and make for interesting predictions
 */

import type { GameConfig } from '../game-registry';

let currentGasGwei = 0;
let lastFetch = 0;

async function fetchGasPrice(): Promise<number> {
  const now = Date.now();
  if (currentGasGwei > 0 && now - lastFetch < 10000) return currentGasGwei; // 10s cache

  try {
    const rpcUrl = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
    });
    const data: any = await res.json();
    const gasWei = parseInt(data.result, 16);
    const gwei = gasWei / 1e9;
    if (gwei > 0) {
      currentGasGwei = Math.round(gwei * 100) / 100; // 2 decimal places
      lastFetch = now;
    }
    return currentGasGwei;
  } catch (err) {
    console.error('[GasPrice] Fetch error:', err);
    return currentGasGwei;
  }
}

export function createGasPriceGame(): GameConfig {
  fetchGasPrice().catch(() => {});

  return {
    type: 'gas-price',
    name: 'ETH Gas',
    description: 'Predict whether Ethereum gas fees will go UP or DOWN in the next 5 minutes',
    icon: '⛽',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: fetchGasPrice,
    getMarketInfo: (openValue: number) => ({
      title: `Gas ${openValue.toFixed(1)} Gwei — UP or DOWN?`,
      description: `Will ETH gas price be above or below ${openValue.toFixed(1)} Gwei in 5 minutes?`,
    }),
  };
}
