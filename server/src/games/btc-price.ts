/**
 * BTC Price Game — Will BTC go UP or DOWN in the next 5 minutes?
 * Data feed: Coinbase WebSocket BTC-USD ticker
 */

import { PriceEngine } from '../price-engine';
import type { GameConfig } from '../game-registry';

export function createBtcPriceGame(priceEngine: PriceEngine): GameConfig {
  return {
    type: 'btc-price',
    name: 'BTC Price',
    description: 'Predict whether Bitcoin will go UP or DOWN in the next 5 minutes',
    icon: '₿',
    durationMs: 5 * 60 * 1000,
    settleDelayMs: 3000,
    getCurrentValue: async () => priceEngine.price,
    getMarketInfo: (openValue: number) => ({
      title: `BTC ${openValue >= 100000 ? '$' + (openValue / 1000).toFixed(1) + 'K' : '$' + openValue.toFixed(2)} — UP or DOWN?`,
      description: `Will BTC be above or below $${openValue.toLocaleString(undefined, { minimumFractionDigits: 2 })} in 5 minutes?`,
    }),
  };
}
