/**
 * Trading Bots — 5 simulated agents that trade on all markets and chat.
 * Each bot has a name, persona, trading style, and chat personality.
 * All bots use the platform wallet for funding.
 */

import { GameRegistry, Market } from './game-registry';
import { Server as SocketIO } from 'socket.io';
import * as db from './db';

// Bot personas
interface Bot {
  id: string;          // fake wallet address
  name: string;        // display name in chat
  style: 'momentum' | 'contrarian' | 'random' | 'conservative' | 'aggressive';
  bias: number;        // 0.0-1.0, probability of choosing UP
  minShares: number;
  maxShares: number;
  chatLines: string[]; // pool of chat messages
  tradeDelay: { min: number; max: number }; // ms delay range after market opens before betting
}

const BOTS: Bot[] = [
  {
    id: '0x7a3B9c4D2e1F8a6C5d0E9b4A7c3D1e2F8a6B5c4D',
    name: 'AlphaSeeker',
    style: 'momentum',
    bias: 0.55,
    minShares: 5,
    maxShares: 50,
    tradeDelay: { min: 5000, max: 30000 },
    chatLines: [
      'BTC looking strong here, going long',
      'Momentum is clearly bullish rn',
      'Following the trend on this one',
      'Charts don\'t lie, UP it is',
      'This setup looks clean, taking the trade',
      'Volume confirms the move, I\'m in',
      'Anyone else seeing this breakout?',
      'My model says 62% UP probability',
      'Riding the wave on this market',
      'Classic continuation pattern forming',
      'Locking in profits from last round, new position incoming',
      'That last settlement was close. Recalibrating...',
      'The price action on ETH is interesting today',
      'Weather game is pure entropy lol',
      'Gold always tells the story first',
    ],
  },
  {
    id: '0x2F8c1D4e5A9b3C7d0E6f2A8B4c1D5e9F3a7B6c',
    name: 'ContrarianBot',
    style: 'contrarian',
    bias: 0.45,
    minShares: 10,
    maxShares: 80,
    tradeDelay: { min: 15000, max: 60000 },
    chatLines: [
      'Everyone\'s going UP? I\'m fading that',
      'The crowd is usually wrong at extremes',
      'Taking the other side of this trade',
      'Mean reversion incoming, watch',
      'Too much consensus = time to go against',
      'Fading the herd on this one',
      'Overbought signal on my indicators',
      'When in doubt, go against the crowd',
      'These odds are mispriced, opportunity!',
      'Classic retail trap forming here',
      'Patience pays. Waiting for the reversal.',
      'SPY always reverts. Just a matter of time.',
      'The gas market is overreacting again',
      'Contrarian strategy hit 58% last week',
      'Sometimes the best trade is the unpopular one',
    ],
  },
  {
    id: '0x9E3a5B7c1D4f8A2e6C0d9B3a7E5c1F4d8A2b6C',
    name: 'NeuralTrader',
    style: 'aggressive',
    bias: 0.5,
    minShares: 20,
    maxShares: 120,
    tradeDelay: { min: 3000, max: 20000 },
    chatLines: [
      'Running my neural net prediction... placing bet',
      'Model confidence: 73%. Going big.',
      'Deploying capital across all markets',
      'My LSTM says this is a clear setup',
      'Backtested this pattern 10k times, +EV',
      'Size the position for the edge, not the fear',
      'Full send on this market cycle',
      'The alpha is in the speed of execution',
      'Optimizing across all 9 markets simultaneously',
      'Feature importance: price momentum > volume > sentiment',
      'Training data updated. New predictions loaded.',
      'Cross-market correlation detected, adjusting positions',
      'SOL and ETH moving together, interesting...',
      'Risk-adjusted return looking great this session',
      'Sharpe ratio above 2.0 today, let\'s keep it going',
    ],
  },
  {
    id: '0x4C8d2E6f0A3b7D1c5E9a4B8c2F6d0A3e7B1c5D',
    name: 'SteadyEddie',
    style: 'conservative',
    bias: 0.52,
    minShares: 3,
    maxShares: 25,
    tradeDelay: { min: 30000, max: 90000 },
    chatLines: [
      'Small position, managing risk',
      'Not every market is worth trading',
      'Waiting for better odds before sizing up',
      'Slow and steady wins the race',
      'Risk management > everything else',
      'Only trading when I see clear edge',
      'Small bet, big patience',
      'Sometimes the best trade is the smallest one',
      'Compounding small wins over time',
      'Capital preservation first, profits second',
      'Sitting this round out, odds aren\'t great',
      'Weather market is too random for me today',
      'BTC 5-min has been my bread and butter',
      'Discipline over conviction every time',
      'Low leverage, consistent returns. That\'s the game.',
    ],
  },
  {
    id: '0x6A1e3C5d7F9b2D4a8E0c6B3f1A5d9C7e2F4a8B',
    name: 'DegenerateApe',
    style: 'random',
    bias: 0.5,
    minShares: 15,
    maxShares: 100,
    tradeDelay: { min: 2000, max: 15000 },
    chatLines: [
      'YOLO UP let\'s gooo',
      'Flipping a coin... heads = UP',
      'APE IN APE IN APE IN',
      'Who needs analysis when you have vibes',
      'Trust the gut, not the chart',
      'Randomness is the ultimate strategy',
      'Can\'t lose if you don\'t think about it',
      'Diamond hands on every position',
      'Going max size, no regrets',
      'If it goes wrong, I\'ll just double down next round',
      'That last market REKT me but we\'re back',
      'Gold going UP because gold always goes UP right?',
      'Weather in Destin? No idea but DOWN feels right',
      'My horoscope says BTC UP today so...',
      'Pure chaos strategy, 50% of the time it works every time',
    ],
  },
];

// Short address for display
function shortAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

// Random int between min and max (inclusive)
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Random float between min and max
function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Pick random element from array
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Start the bot system. Bots will:
 * 1. Get initial balances credited
 * 2. Trade on markets as they open
 * 3. Post chat messages periodically
 */
export async function startBots(
  gameRegistry: GameRegistry,
  io: SocketIO,
  addChatMessage: (sender: string, content: string, isAgent: boolean) => any,
): Promise<void> {
  console.log('[Bots] Initializing 5 trading bots...');

  // Credit each bot with starting balance (idempotent — only tops up if low)
  for (const bot of BOTS) {
    const currentBalance = await db.getBalance(bot.id);
    if (currentBalance < 100) {
      const topUp = 10000 - currentBalance;
      await db.credit(bot.id, topUp, 'bot_credit', undefined, undefined, { botName: bot.name });
      console.log(`[Bots] Credited ${bot.name} with ${topUp.toFixed(2)} ETH (balance: ${(currentBalance + topUp).toFixed(2)})`);
    }
  }

  // Listen for new markets and have bots trade
  gameRegistry.on('marketOpen', (market: Market) => {
    for (const bot of BOTS) {
      // Each bot decides whether to trade this market (80% chance)
      if (Math.random() > 0.8) continue;

      const delay = randInt(bot.tradeDelay.min, bot.tradeDelay.max);
      setTimeout(() => executeBotTrade(bot, market, gameRegistry), delay);
    }
  });

  // Listen for settlements and have bots react in chat
  gameRegistry.on('marketSettled', (market: Market) => {
    // 30% chance a bot comments on the settlement
    if (Math.random() > 0.3) return;
    const bot = pick(BOTS);
    const delay = randInt(2000, 8000);
    setTimeout(() => {
      const outcome = market.outcome;
      const gameType = market.gameType;
      const reactions = [
        `${outcome} on ${gameType}! Called it.`,
        `${gameType} settled ${outcome}. Interesting.`,
        `Wow, that ${gameType} market was close.`,
        `${outcome}! My position was right this time.`,
        `${gameType} went ${outcome}. Adjusting my model.`,
        `That ${gameType} result makes sense given the momentum.`,
        `GG on that ${gameType} round`,
      ];
      const msg = pick(reactions);
      const chatMsg = addChatMessage(shortAddr(bot.id), msg, true);
      io.emit('chatMessage', chatMsg);
    }, delay);
  });

  // Periodic chat messages (every 30-120 seconds, random bot)
  const chatLoop = () => {
    const bot = pick(BOTS);
    const msg = pick(bot.chatLines);
    const chatMsg = addChatMessage(shortAddr(bot.id), msg, true);
    io.emit('chatMessage', chatMsg);

    // Schedule next chat message
    const nextDelay = randInt(45000, 180000); // 45s to 3min
    setTimeout(chatLoop, nextDelay);
  };

  // Start chat loop after initial delay
  setTimeout(chatLoop, randInt(10000, 30000));

  console.log('[Bots] All 5 bots active and trading');
}

async function executeBotTrade(
  bot: Bot,
  market: Market,
  gameRegistry: GameRegistry,
): Promise<void> {
  try {
    // Check market is still trading
    const currentMarket = gameRegistry.getCurrentMarket(market.gameType);
    if (!currentMarket || currentMarket.id !== market.id || currentMarket.status !== 'trading') {
      return;
    }

    // Check time remaining (don't trade in last 15 seconds)
    const timeLeft = currentMarket.endTime - Date.now();
    if (timeLeft < 15000) return;

    // Determine side based on bot style
    let side: 'UP' | 'DOWN';
    switch (bot.style) {
      case 'momentum': {
        // Bias towards UP (following trend assumption)
        side = Math.random() < bot.bias ? 'UP' : 'DOWN';
        break;
      }
      case 'contrarian': {
        // Check current market stats to fade the majority
        const stats = gameRegistry.getMarketStats(market.id);
        if (stats.upShares > stats.downShares) {
          side = Math.random() < 0.7 ? 'DOWN' : 'UP'; // 70% fade
        } else if (stats.downShares > stats.upShares) {
          side = Math.random() < 0.7 ? 'UP' : 'DOWN';
        } else {
          side = Math.random() < bot.bias ? 'UP' : 'DOWN';
        }
        break;
      }
      case 'aggressive': {
        // Random but with larger sizes
        side = Math.random() < bot.bias ? 'UP' : 'DOWN';
        break;
      }
      case 'conservative': {
        // Slight UP bias, smaller positions
        side = Math.random() < bot.bias ? 'UP' : 'DOWN';
        break;
      }
      case 'random':
      default: {
        side = Math.random() < 0.5 ? 'UP' : 'DOWN';
        break;
      }
    }

    // Determine shares
    const shares = randInt(bot.minShares, bot.maxShares);

    // Determine price (probability)
    // Bots bet near fair value with some variance
    const basePrice = 0.5;
    const variance = randFloat(-0.15, 0.15);
    const price = Math.max(0.1, Math.min(0.9, basePrice + variance));

    // Place the order
    await gameRegistry.placeOrder(bot.id, market.id, side, parseFloat(price.toFixed(2)), shares);
    console.log(`[Bots] ${bot.name} bet ${shares} shares ${side} @ ${price.toFixed(2)} on ${market.gameType}`);
  } catch (err: any) {
    // Silently handle errors (insufficient balance, market closed, etc.)
    if (!err.message?.includes('Insufficient balance') && !err.message?.includes('No active market')) {
      console.error(`[Bots] ${bot.name} trade error:`, err.message);
    }
  }
}
