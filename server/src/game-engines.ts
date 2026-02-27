/**
 * Game Engines — creates GameConfig objects for each supported game type.
 * Each engine manages its own data feed (WebSocket, REST polling, etc.)
 * and returns a GameConfig that the GameRegistry can register and manage.
 */

import { GameConfig } from './game-registry';
import { PriceEngine } from './price-engine';

// ---------------------------------------------------------------------------
// Shared HTTP helper
// ---------------------------------------------------------------------------

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// 1. BTC Price — btc-5min
//    Uses the existing PriceEngine (Coinbase WebSocket BTC-USD)
// ---------------------------------------------------------------------------

export function createBtcGame(priceEngine: PriceEngine): GameConfig {
  return {
    type: 'btc-5min',
    name: 'BTC 5-Min',
    description: 'Predict if BTC price goes up or down in 5 minutes',
    icon: '\u20bf',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => priceEngine.price,
    getMarketInfo: (openValue: number) => ({
      title: `BTC 5-Min: Above $${openValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}?`,
      description: `Will BTC be above $${openValue.toFixed(2)} in 5 minutes?`,
    }),
    resolveOutcome: (openValue, closeValue) =>
      closeValue >= openValue ? 'UP' : 'DOWN',
  };
}

// ---------------------------------------------------------------------------
// 2. ETH Price — eth-5min
//    Polls CoinGecko free API every 10 seconds
// ---------------------------------------------------------------------------

let ethPrice = 0;
let ethPollTimer: NodeJS.Timeout | null = null;

async function pollEthPrice(): Promise<void> {
  // Source 1: Coinbase REST API (most reliable, no key needed)
  try {
    const data = await fetchJson('https://api.coinbase.com/v2/prices/ETH-USD/spot');
    const price = parseFloat(data?.data?.amount);
    if (price > 0) { ethPrice = price; return; }
  } catch {}

  // Source 2: Binance US
  try {
    const data = await fetchJson('https://api.binance.us/api/v3/ticker/price?symbol=ETHUSD');
    const price = parseFloat(data?.price);
    if (price > 0) { ethPrice = price; return; }
  } catch {}

  // Source 3: Kraken
  try {
    const data = await fetchJson('https://api.kraken.com/0/public/Ticker?pair=ETHUSD');
    const pairs = data?.result;
    const key = Object.keys(pairs || {})[0];
    const price = parseFloat(pairs?.[key]?.c?.[0]);
    if (price > 0) { ethPrice = price; return; }
  } catch {}

  // Source 4: CoinGecko (rate-limited, last resort)
  try {
    const data = await fetchJson(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
    );
    const price = data?.ethereum?.usd;
    if (typeof price === 'number' && price > 0) { ethPrice = price; return; }
  } catch (err: any) {
    console.error('[ETH-5min] All price sources failed:', err.message);
  }
}

export function createEthGame(): GameConfig {
  // Start polling immediately, then every 10 seconds
  pollEthPrice().catch(() => {});
  if (ethPollTimer) clearInterval(ethPollTimer);
  ethPollTimer = setInterval(pollEthPrice, 10_000);

  return {
    type: 'eth-5min',
    name: 'ETH 5-Min',
    description: 'Predict if ETH price goes up or down in 5 minutes',
    icon: '\u039E',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => ethPrice,
    getMarketInfo: (openValue: number) => ({
      title: `ETH 5-Min: Above $${openValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}?`,
      description: `Will ETH be above $${openValue.toFixed(2)} in 5 minutes?`,
    }),
    resolveOutcome: (openValue, closeValue) =>
      closeValue >= openValue ? 'UP' : 'DOWN',
  };
}

// ---------------------------------------------------------------------------
// 3. Stock Price — SPY — spy-5min
//    Polls Yahoo Finance every 15 seconds
//    Checks US market hours (M-F 9:30-16:00 ET)
// ---------------------------------------------------------------------------

let spyPrice = 0;
let spyPollTimer: NodeJS.Timeout | null = null;

function isUSMarketOpen(): boolean {
  const now = new Date();
  // Convert to Eastern Time by using toLocaleString trick
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etString);
  const day = et.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  // Market open 9:30 (570 min) to 16:00 (960 min)
  return totalMinutes >= 570 && totalMinutes < 960;
}

async function pollSpyPrice(): Promise<void> {
  // Source 1: Yahoo Finance (query1)
  try {
    const data = await fetchJson(
      'https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1m&range=1d',
    );
    const meta = data?.chart?.result?.[0]?.meta;
    const price = isUSMarketOpen()
      ? meta?.regularMarketPrice
      : meta?.regularMarketPrice || meta?.previousClose || meta?.chartPreviousClose;
    if (typeof price === 'number' && price > 0) { spyPrice = price; return; }
  } catch {}

  // Source 2: Yahoo Finance (query2, different CDN)
  try {
    const data = await fetchJson(
      'https://query2.finance.yahoo.com/v8/finance/chart/SPY?interval=1m&range=1d',
    );
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice || meta?.previousClose;
    if (typeof price === 'number' && price > 0) { spyPrice = price; return; }
  } catch (err: any) {
    console.error('[SPY-5min] All price sources failed:', err.message);
  }
}

export function createSpyGame(): GameConfig {
  // Start polling immediately, then every 15 seconds
  pollSpyPrice().catch(() => {});
  if (spyPollTimer) clearInterval(spyPollTimer);
  spyPollTimer = setInterval(pollSpyPrice, 15_000);

  return {
    type: 'spy-5min',
    name: 'SPY 5-Min',
    description: 'Predict if SPY price goes up or down in 5 minutes',
    icon: '\uD83D\uDCC8',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => spyPrice,
    getMarketInfo: (openValue: number) => {
      const marketStatus = isUSMarketOpen() ? '' : ' (After Hours)';
      return {
        title: `SPY 5-Min: Above $${openValue.toFixed(2)}?${marketStatus}`,
        description: `Will SPY be above $${openValue.toFixed(2)} in 5 minutes?`,
      };
    },
    resolveOutcome: (openValue, closeValue) =>
      closeValue >= openValue ? 'UP' : 'DOWN',
  };
}

// ---------------------------------------------------------------------------
// 4. Weather Temperature — weather-temp
//    Polls Open-Meteo API every 30 seconds for Destin, FL
// ---------------------------------------------------------------------------

let weatherTemp = 0;
let weatherPollTimer: NodeJS.Timeout | null = null;

const DESTIN_FL = { latitude: 30.4, longitude: -86.5 };

async function pollWeatherTemp(): Promise<void> {
  try {
    const data = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${DESTIN_FL.latitude}&longitude=${DESTIN_FL.longitude}&current_weather=true`,
    );
    const temp = data?.current_weather?.temperature;
    if (typeof temp === 'number') {
      // Open-Meteo returns Celsius by default; convert to Fahrenheit
      weatherTemp = temp * 9 / 5 + 32;
    }
  } catch (err: any) {
    console.error('[Weather-Temp] Open-Meteo fetch error:', err.message);
  }
}

export function createWeatherGame(): GameConfig {
  // Start polling immediately, then every 30 seconds
  pollWeatherTemp().catch(() => {});
  if (weatherPollTimer) clearInterval(weatherPollTimer);
  weatherPollTimer = setInterval(pollWeatherTemp, 30_000);

  return {
    type: 'weather-temp',
    name: 'Weather Temp',
    description: 'Predict if the temperature in Destin, FL goes up or down in 10 minutes',
    icon: '\uD83C\uDF21\uFE0F',
    durationMs: 10 * 60 * 1000,
    settleDelayMs: 5000,
    getCurrentValue: async () => weatherTemp,
    getMarketInfo: (openValue: number) => ({
      title: `Weather: Above ${openValue.toFixed(1)}\u00B0F in Destin, FL?`,
      description: `Will temperature in Destin, FL go above ${openValue.toFixed(1)}\u00B0F in 10 minutes?`,
    }),
    resolveOutcome: (openValue, closeValue) =>
      closeValue > openValue ? 'UP' : 'DOWN', // DOWN if equal or lower
  };
}
