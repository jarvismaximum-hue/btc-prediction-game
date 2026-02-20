/**
 * GalaChain integration for GALA token transfers.
 * Uses @gala-chain/connect for wallet operations and @gala-chain/api for DTOs.
 * Falls back to mock mode if GalaChain is unavailable.
 */

export interface GalaConfig {
  channelName: string;
  chaincodeName: string;
  contractName: string;
  apiUrl: string;
  platformWallet: string; // address where platform fees are collected
  mockMode: boolean;
}

export interface TransferResult {
  success: boolean;
  txId?: string;
  error?: string;
}

export interface BalanceResult {
  balance: number;
  locked: number;
  available: number;
}

const DEFAULT_CONFIG: GalaConfig = {
  channelName: 'product-channel',
  chaincodeName: 'basic-product',
  contractName: 'GalaChainToken',
  apiUrl: process.env.GALACHAIN_API_URL || 'https://gateway.galachain.com',
  platformWallet: process.env.PLATFORM_WALLET || '',
  mockMode: process.env.GALACHAIN_MOCK !== 'false', // default to mock
};

// In-memory balances for mock mode
const mockBalances = new Map<string, number>();
const mockTxLog: Array<{ from: string; to: string; amount: number; txId: string; timestamp: number }> = [];

export class GalaChainService {
  private config: GalaConfig;

  constructor(config?: Partial<GalaConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.mockMode) {
      console.log('[GalaChain] Running in MOCK mode');
    }
  }

  get isMockMode(): boolean {
    return this.config.mockMode;
  }

  get platformWallet(): string {
    return this.config.platformWallet;
  }

  /** Deposit GALA into user's game balance (mock: just credit) */
  async deposit(userId: string, amount: number): Promise<TransferResult> {
    if (this.config.mockMode) {
      const current = mockBalances.get(userId) || 0;
      mockBalances.set(userId, current + amount);
      const txId = `mock-deposit-${Date.now()}`;
      mockTxLog.push({ from: 'external', to: userId, amount, txId, timestamp: Date.now() });
      return { success: true, txId };
    }
    return this.transferToken(userId, this.config.platformWallet, amount, 'deposit');
  }

  /** Withdraw GALA from user's game balance */
  async withdraw(userId: string, amount: number): Promise<TransferResult> {
    if (this.config.mockMode) {
      const current = mockBalances.get(userId) || 0;
      if (current < amount) return { success: false, error: 'Insufficient balance' };
      mockBalances.set(userId, current - amount);
      const txId = `mock-withdraw-${Date.now()}`;
      mockTxLog.push({ from: userId, to: 'external', amount, txId, timestamp: Date.now() });
      return { success: true, txId };
    }
    return this.transferToken(this.config.platformWallet, userId, amount, 'withdraw');
  }

  /** Internal transfer between game wallets */
  async internalTransfer(from: string, to: string, amount: number): Promise<TransferResult> {
    if (this.config.mockMode) {
      const fromBal = mockBalances.get(from) || 0;
      if (fromBal < amount) return { success: false, error: 'Insufficient balance' };
      mockBalances.set(from, fromBal - amount);
      mockBalances.set(to, (mockBalances.get(to) || 0) + amount);
      const txId = `mock-transfer-${Date.now()}`;
      mockTxLog.push({ from, to, amount, txId, timestamp: Date.now() });
      return { success: true, txId };
    }
    return this.transferToken(from, to, amount, 'internal');
  }

  /** Get user's GALA balance */
  async getBalance(userId: string): Promise<BalanceResult> {
    if (this.config.mockMode) {
      const bal = mockBalances.get(userId) || 0;
      return { balance: bal, locked: 0, available: bal };
    }

    try {
      const response = await fetch(`${this.config.apiUrl}/api/${this.config.channelName}/${this.config.chaincodeName}/FetchBalances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: userId,
          collection: 'GALA',
          category: 'Unit',
          type: 'none',
          additionalKey: 'none',
        }),
      });
      const data: any = await response.json();
      if (data.Data && data.Data.length > 0) {
        const total = data.Data.reduce((sum: number, b: any) => sum + parseFloat(b.quantity || '0'), 0);
        const locked = data.Data.reduce((sum: number, b: any) => sum + parseFloat(b.lockedHolds?.[0]?.quantity || '0'), 0);
        return { balance: total, locked, available: total - locked };
      }
      return { balance: 0, locked: 0, available: 0 };
    } catch (err) {
      console.error('[GalaChain] FetchBalances error:', err);
      return { balance: 0, locked: 0, available: 0 };
    }
  }

  /** Collect platform fees to the designated wallet */
  async collectFee(fromUser: string, amount: number): Promise<TransferResult> {
    if (amount <= 0) return { success: true, txId: 'no-fee' };
    return this.internalTransfer(fromUser, 'platform-fees', amount);
  }

  /** Give mock balance for testing */
  creditMockBalance(userId: string, amount: number): void {
    if (!this.config.mockMode) return;
    const current = mockBalances.get(userId) || 0;
    mockBalances.set(userId, current + amount);
  }

  getMockBalance(userId: string): number {
    return mockBalances.get(userId) || 0;
  }

  private async transferToken(from: string, to: string, amount: number, type: string): Promise<TransferResult> {
    try {
      const response = await fetch(`${this.config.apiUrl}/api/${this.config.channelName}/${this.config.chaincodeName}/TransferToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to,
          tokenInstance: {
            collection: 'GALA',
            category: 'Unit',
            type: 'none',
            additionalKey: 'none',
            instance: '0',
          },
          quantity: amount.toString(),
        }),
      });
      const data: any = await response.json();
      if (data.Status === 1) {
        return { success: true, txId: data.Hash || `tx-${Date.now()}` };
      }
      return { success: false, error: data.Message || 'Transfer failed' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
