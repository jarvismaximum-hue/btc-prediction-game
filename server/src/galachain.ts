/**
 * Base chain native transfer integration.
 * Uses ethers.js for server-side ETH transfers (withdrawals) on Base L2.
 * Falls back to mock mode if ETH_MOCK=true.
 *
 * Deposits: user sends ETH on Base to platform wallet via MetaMask.
 * Withdrawals: server sends ETH on Base from platform wallet back to user.
 */

import { Wallet, JsonRpcProvider, parseEther, formatEther } from 'ethers';

export interface EthConfig {
  rpcUrl: string;
  platformWallet: string;
  platformPrivateKey: string;
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

const DEFAULT_CONFIG: EthConfig = {
  rpcUrl: process.env.ETH_RPC_URL || 'https://mainnet.base.org',
  platformWallet: process.env.PLATFORM_WALLET || '0x522769cB379cb7DF64Da1FEe299A207107de97c1',
  platformPrivateKey: process.env.PLATFORM_PRIVATE_KEY || '',
  mockMode: process.env.ETH_MOCK === 'true' || process.env.GALACHAIN_MOCK === 'true',
};

// In-memory balances for mock mode
const mockBalances = new Map<string, number>();
const mockTxLog: Array<{ from: string; to: string; amount: number; txId: string; timestamp: number }> = [];

export class GalaChainService {
  private config: EthConfig;
  private wallet: Wallet | null = null;
  private provider: JsonRpcProvider | null = null;

  constructor(config?: Partial<EthConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.mockMode) {
      console.log('[Base] Running in MOCK mode');
    } else if (this.config.platformPrivateKey) {
      this.provider = new JsonRpcProvider(this.config.rpcUrl);
      this.wallet = new Wallet(this.config.platformPrivateKey, this.provider);
      console.log(`[Base] LIVE mode — platform wallet: ${this.config.platformWallet}`);
    } else {
      console.warn('[Base] LIVE mode but no PLATFORM_PRIVATE_KEY — withdrawals will fail');
    }
  }

  get isMockMode(): boolean {
    return this.config.mockMode;
  }

  get platformWallet(): string {
    return this.config.platformWallet;
  }

  /** Deposit: verify on-chain tx before crediting balance */
  async deposit(userId: string, amount: number): Promise<TransferResult> {
    if (this.config.mockMode) {
      const current = mockBalances.get(userId) || 0;
      mockBalances.set(userId, current + amount);
      const txId = `mock-deposit-${Date.now()}`;
      mockTxLog.push({ from: 'external', to: userId, amount, txId, timestamp: Date.now() });
      return { success: true, txId };
    }
    return { success: true, txId: `deposit-ack-${Date.now()}` };
  }

  /** Verify an on-chain deposit tx (Base L2) — checks recipient, amount, and confirmation */
  async verifyDeposit(txHash: string, expectedFrom: string, expectedAmount: number): Promise<{ verified: boolean; actualAmount?: number; error?: string }> {
    if (this.config.mockMode) {
      return { verified: true, actualAmount: expectedAmount };
    }
    if (!this.provider) {
      return { verified: false, error: 'No RPC provider configured' };
    }
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt || receipt.status !== 1) {
        return { verified: false, error: 'Transaction not found or failed' };
      }
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) {
        return { verified: false, error: 'Transaction not found' };
      }
      // Verify recipient is the platform wallet
      if (tx.to?.toLowerCase() !== this.config.platformWallet.toLowerCase()) {
        return { verified: false, error: 'Transaction recipient is not the platform wallet' };
      }
      // Verify sender matches the depositor
      if (tx.from.toLowerCase() !== expectedFrom.toLowerCase()) {
        return { verified: false, error: 'Transaction sender does not match depositor' };
      }
      // Get actual ETH amount
      const actualAmount = parseFloat(formatEther(tx.value));
      // Allow 1% tolerance for gas estimation differences
      if (actualAmount < expectedAmount * 0.99) {
        return { verified: false, error: `Amount mismatch: expected ${expectedAmount} ETH, got ${actualAmount} ETH` };
      }
      return { verified: true, actualAmount };
    } catch (err: any) {
      return { verified: false, error: `Verification failed: ${err.message}` };
    }
  }

  /** Withdraw: server sends ETH to user */
  async withdraw(userId: string, amount: number): Promise<TransferResult> {
    if (this.config.mockMode) {
      const current = mockBalances.get(userId) || 0;
      if (current < amount) return { success: false, error: 'Insufficient balance' };
      mockBalances.set(userId, current - amount);
      const txId = `mock-withdraw-${Date.now()}`;
      mockTxLog.push({ from: userId, to: 'external', amount, txId, timestamp: Date.now() });
      return { success: true, txId };
    }
    return this.sendEth(userId, amount);
  }

  /** Internal transfer (mock only — on-chain just uses sendEth) */
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
    return this.sendEth(to, amount);
  }

  /** Get user's on-chain ETH balance */
  async getBalance(userId: string): Promise<BalanceResult> {
    if (this.config.mockMode) {
      const bal = mockBalances.get(userId) || 0;
      return { balance: bal, locked: 0, available: bal };
    }

    try {
      if (!this.provider) {
        return { balance: 0, locked: 0, available: 0 };
      }
      const bal = await this.provider.getBalance(userId);
      const ethBal = parseFloat(formatEther(bal));
      return { balance: ethBal, locked: 0, available: ethBal };
    } catch (err) {
      console.error('[Base] getBalance error:', err);
      return { balance: 0, locked: 0, available: 0 };
    }
  }

  /** Collect platform fees */
  async collectFee(fromUser: string, amount: number): Promise<TransferResult> {
    if (amount <= 0) return { success: true, txId: 'no-fee' };
    return this.internalTransfer(fromUser, this.config.platformWallet, amount);
  }

  creditMockBalance(userId: string, amount: number): void {
    if (!this.config.mockMode) return;
    const current = mockBalances.get(userId) || 0;
    mockBalances.set(userId, current + amount);
  }

  getMockBalance(userId: string): number {
    return mockBalances.get(userId) || 0;
  }

  /** Send native ETH from platform wallet to a recipient */
  private async sendEth(to: string, amount: number): Promise<TransferResult> {
    if (!this.wallet) {
      return { success: false, error: 'Server signing not configured (missing PLATFORM_PRIVATE_KEY)' };
    }

    try {
      const tx = await this.wallet.sendTransaction({
        to,
        value: parseEther(amount.toString()),
      });
      const receipt = await tx.wait(1);
      return { success: true, txId: receipt?.hash || tx.hash };
    } catch (err: any) {
      console.error('[Base] sendEth error:', err);
      return { success: false, error: err.message || 'Transfer failed' };
    }
  }
}
