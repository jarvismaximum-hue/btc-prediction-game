/**
 * ETH Price Game — Will ETH go UP or DOWN in the next 5 minutes?
 * Data feed: Coinbase WebSocket ETH-USD ticker
 */

import WebSocket from 'ws';
import type { GameConfig } from '../game-registry';

let currentPrice = 0;
let ws: WebSocket | null = null;

function connectFeed(): void {
  if (ws) { ws.removeAllListeners(); ws.close(); }
  ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
  ws.on('open', () => {
    console.log('[ETH-Price] Connected to Coinbase ETH-USD');
    ws!.send(JSON.stringify({ type: 'subscribe', channels: [{ name: 'ticker', product_ids: ['ETH-USD'] }] }));
  });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ticker') currentPrice = parseFloat(msg.price);
    } catch {}
  });
  ws.on('close', () => setTimeout(connectFeed, 3000));
  ws.on('error', () => ws?.close());
}

export function createEthPriceGame(): GameConfig {
  connectFeed();
  return {
    type: 'eth-price',
    name: 'ETH Price',
    description: 'Predict whether Ethereum will go UP or DOWN in the next 5 minutes',
    icon: 'Ξ',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => currentPrice,
    getMarketInfo: (openValue: number) => ({
      title: `ETH $${openValue.toFixed(2)} — UP or DOWN?`,
      description: `Will ETH be above or below $${openValue.toFixed(2)} in 5 minutes?`,
    }),
  };
}
