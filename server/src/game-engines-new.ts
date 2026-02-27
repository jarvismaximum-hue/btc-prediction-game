/**
 * Additional game engines for the Agent Arena.
 * Each engine polls a public API for real-time data.
 */

import { GameConfig } from './game-registry';

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Gold Price (XAU/USD) — gold-5min
// Polls CoinGecko (they have gold vs USD via commodities)
// Fallback: uses a free forex API
// ---------------------------------------------------------------------------

let goldPrice = 0;
let goldPollTimer: NodeJS.Timeout | null = null;

async function pollGoldPrice(): Promise<void> {
  // Source 1: metals.dev free API
  try {
    const data = await fetchJson('https://api.metals.dev/v1/latest?api_key=demo&currency=USD&unit=toz');
    const price = data?.metals?.gold;
    if (typeof price === 'number' && price > 0) { goldPrice = price; return; }
  } catch {}

  // Source 2: Coinbase PAXG (gold-backed token, close proxy)
  try {
    const data = await fetchJson('https://api.coinbase.com/v2/prices/PAXG-USD/spot');
    const price = parseFloat(data?.data?.amount);
    if (price > 0) { goldPrice = price; return; }
  } catch {}

  // Source 3: CoinGecko tether-gold (rate-limited, last resort)
  try {
    const data = await fetchJson(
      'https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd'
    );
    const price = data?.['tether-gold']?.usd;
    if (typeof price === 'number' && price > 0) { goldPrice = price; return; }
  } catch (err: any) {
    console.error('[Gold] All price sources failed:', err.message);
  }
}

function createGoldGame(): GameConfig {
  pollGoldPrice().catch(() => {});
  if (goldPollTimer) clearInterval(goldPollTimer);
  goldPollTimer = setInterval(pollGoldPrice, 15_000);

  return {
    type: 'gold-5min',
    name: 'Gold 5-Min',
    description: 'Predict if gold (XAU/USD) price goes up or down in 5 minutes',
    icon: '\uD83E\uDD47',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => goldPrice,
    getMarketInfo: (openValue: number) => ({
      title: `Gold 5-Min: Above $${openValue.toFixed(2)}?`,
      description: `Will gold be above $${openValue.toFixed(2)} in 5 minutes?`,
    }),
    resolveOutcome: (open, close) => close >= open ? 'UP' : 'DOWN',
  };
}

// ---------------------------------------------------------------------------
// NASDAQ / QQQ — qqq-5min
// Polls Yahoo Finance
// ---------------------------------------------------------------------------

let qqqPrice = 0;
let qqqPollTimer: NodeJS.Timeout | null = null;

function isUSMarketOpen(): boolean {
  const now = new Date();
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etString);
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const totalMinutes = et.getHours() * 60 + et.getMinutes();
  return totalMinutes >= 570 && totalMinutes < 960;
}

async function pollQqqPrice(): Promise<void> {
  // Source 1: Yahoo Finance
  try {
    const data = await fetchJson(
      'https://query1.finance.yahoo.com/v8/finance/chart/QQQ?interval=1m&range=1d'
    );
    const meta = data?.chart?.result?.[0]?.meta;
    const price = isUSMarketOpen()
      ? meta?.regularMarketPrice
      : meta?.regularMarketPrice || meta?.previousClose || meta?.chartPreviousClose;
    if (typeof price === 'number' && price > 0) { qqqPrice = price; return; }
  } catch {}

  // Source 2: Alternative Yahoo endpoint
  try {
    const data = await fetchJson(
      'https://query2.finance.yahoo.com/v8/finance/chart/QQQ?interval=1m&range=1d'
    );
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice || meta?.previousClose;
    if (typeof price === 'number' && price > 0) { qqqPrice = price; return; }
  } catch (err: any) {
    console.error('[QQQ] All price sources failed:', err.message);
  }
}

function createQqqGame(): GameConfig {
  pollQqqPrice().catch(() => {});
  if (qqqPollTimer) clearInterval(qqqPollTimer);
  qqqPollTimer = setInterval(pollQqqPrice, 15_000);

  return {
    type: 'qqq-5min',
    name: 'NASDAQ 5-Min',
    description: 'Predict if NASDAQ (QQQ) goes up or down in 5 minutes',
    icon: '\uD83D\uDCC8',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => qqqPrice,
    getMarketInfo: (openValue: number) => {
      const status = isUSMarketOpen() ? '' : ' (After Hours)';
      return {
        title: `NASDAQ 5-Min: Above $${openValue.toFixed(2)}?${status}`,
        description: `Will QQQ be above $${openValue.toFixed(2)} in 5 minutes?`,
      };
    },
    resolveOutcome: (open, close) => close >= open ? 'UP' : 'DOWN',
  };
}

// ---------------------------------------------------------------------------
// EUR/USD Forex — eurusd-5min
// Polls a free forex API
// ---------------------------------------------------------------------------

let eurusdPrice = 0;
let forexPollTimer: NodeJS.Timeout | null = null;

async function pollEurusd(): Promise<void> {
  // Source 1: Open Exchange Rates (free, reliable)
  try {
    const data = await fetchJson('https://open.er-api.com/v6/latest/EUR');
    const rate = data?.rates?.USD;
    if (typeof rate === 'number' && rate > 0) { eurusdPrice = rate; return; }
  } catch {}

  // Source 2: exchangerate.host
  try {
    const data = await fetchJson('https://api.exchangerate.host/latest?base=EUR&symbols=USD');
    const rate = data?.rates?.USD;
    if (typeof rate === 'number' && rate > 0) { eurusdPrice = rate; return; }
  } catch {}

  // Source 3: Coinbase EURC stablecoin proxy
  try {
    const data = await fetchJson('https://api.coinbase.com/v2/exchange-rates?currency=EUR');
    const rate = parseFloat(data?.data?.rates?.USD);
    if (rate > 0) { eurusdPrice = rate; return; }
  } catch (err: any) {
    console.error('[EUR/USD] All forex sources failed:', err.message);
  }
}

function createForexGame(): GameConfig {
  pollEurusd().catch(() => {});
  if (forexPollTimer) clearInterval(forexPollTimer);
  forexPollTimer = setInterval(pollEurusd, 30_000);

  return {
    type: 'eurusd-5min',
    name: 'EUR/USD 5-Min',
    description: 'Predict if EUR/USD exchange rate goes up or down in 5 minutes',
    icon: '\uD83D\uDCB1',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => eurusdPrice,
    getMarketInfo: (openValue: number) => ({
      title: `EUR/USD 5-Min: Above ${openValue.toFixed(4)}?`,
      description: `Will EUR/USD be above ${openValue.toFixed(4)} in 5 minutes?`,
    }),
    resolveOutcome: (open, close) => close >= open ? 'UP' : 'DOWN',
  };
}

// ---------------------------------------------------------------------------
// Solana Price — sol-5min
// ---------------------------------------------------------------------------

let solPrice = 0;
let solPollTimer: NodeJS.Timeout | null = null;

async function pollSolPrice(): Promise<void> {
  // Source 1: Coinbase REST API
  try {
    const data = await fetchJson('https://api.coinbase.com/v2/prices/SOL-USD/spot');
    const price = parseFloat(data?.data?.amount);
    if (price > 0) { solPrice = price; return; }
  } catch {}

  // Source 2: Binance US
  try {
    const data = await fetchJson('https://api.binance.us/api/v3/ticker/price?symbol=SOLUSD');
    const price = parseFloat(data?.price);
    if (price > 0) { solPrice = price; return; }
  } catch {}

  // Source 3: Kraken
  try {
    const data = await fetchJson('https://api.kraken.com/0/public/Ticker?pair=SOLUSD');
    const pairs = data?.result;
    const key = Object.keys(pairs || {})[0];
    const price = parseFloat(pairs?.[key]?.c?.[0]);
    if (price > 0) { solPrice = price; return; }
  } catch {}

  // Source 4: CoinGecko (rate-limited, last resort)
  try {
    const data = await fetchJson(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );
    const price = data?.solana?.usd;
    if (typeof price === 'number' && price > 0) { solPrice = price; return; }
  } catch (err: any) {
    console.error('[SOL] All price sources failed:', err.message);
  }
}

function createSolGame(): GameConfig {
  pollSolPrice().catch(() => {});
  if (solPollTimer) clearInterval(solPollTimer);
  solPollTimer = setInterval(pollSolPrice, 15_000);

  return {
    type: 'sol-5min',
    name: 'SOL 5-Min',
    description: 'Predict if Solana price goes up or down in 5 minutes',
    icon: '\u2600\uFE0F',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => solPrice,
    getMarketInfo: (openValue: number) => ({
      title: `SOL 5-Min: Above $${openValue.toFixed(2)}?`,
      description: `Will SOL be above $${openValue.toFixed(2)} in 5 minutes?`,
    }),
    resolveOutcome: (open, close) => close >= open ? 'UP' : 'DOWN',
  };
}

// ---------------------------------------------------------------------------
// Gas Price game — already exists but let's add Ethereum gas as a variant
// ---------------------------------------------------------------------------

let gasPrice = 0;
let gasPollTimer: NodeJS.Timeout | null = null;

async function pollGasPrice(): Promise<void> {
  try {
    const data = await fetchJson('https://api.etherscan.io/api?module=gastracker&action=gasoracle');
    const fast = data?.result?.FastGasPrice || data?.result?.ProposeGasPrice;
    if (typeof fast === 'string' && parseFloat(fast) > 0) {
      gasPrice = parseFloat(fast);
    }
  } catch {
    // Fallback to direct RPC
    try {
      const rpcRes = await fetch('https://eth.llamarpc.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
      });
      const rpcData: any = await rpcRes.json();
      const hex = rpcData?.result;
      if (hex) gasPrice = parseInt(hex, 16) / 1e9; // Wei to Gwei
    } catch (err: any) {
      console.error('[Gas] Fetch error:', err.message);
    }
  }
}

function createGasGame(): GameConfig {
  pollGasPrice().catch(() => {});
  if (gasPollTimer) clearInterval(gasPollTimer);
  gasPollTimer = setInterval(pollGasPrice, 10_000);

  return {
    type: 'gas-5min',
    name: 'ETH Gas 5-Min',
    description: 'Predict if Ethereum gas fees go up or down in 5 minutes',
    icon: '\u26FD',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => gasPrice,
    getMarketInfo: (openValue: number) => ({
      title: `ETH Gas: Above ${openValue.toFixed(1)} Gwei?`,
      description: `Will Ethereum gas be above ${openValue.toFixed(1)} Gwei in 5 minutes?`,
    }),
    resolveOutcome: (open, close) => close >= open ? 'UP' : 'DOWN',
  };
}

// ---------------------------------------------------------------------------
// Export all new games
// ---------------------------------------------------------------------------

export function createNewGameEngines(): GameConfig[] {
  return [
    createGoldGame(),
    createQqqGame(),
    createForexGame(),
    createSolGame(),
    createGasGame(),
  ];
}
