import { useState } from 'react';
import { apiFetch } from '../services/api';

interface Props {
  onChainBalance: number;
  mainnetBalance?: number;
  ethUsdPrice: number;
  gameBalance: number;
  depositToGame: (amount: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  onBalanceChanged: () => void;
}

export function DepositPanel({ onChainBalance, ethUsdPrice, gameBalance, depositToGame, onBalanceChanged }: Props) {
  const [amount, setAmount] = useState<number>(10);
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleDeposit = async () => {
    if (amount <= 0 || amount > onChainBalance) return;
    setDepositing(true);
    setError(null);
    setSuccess(null);

    try {
      // Transfer GALA from user wallet to platform wallet via GalaChain
      const result = await depositToGame(amount);
      if (!result.success) {
        setError(result.error || 'Deposit failed');
        return;
      }

      // Notify server that deposit was made so it credits in-game balance
      const res = await apiFetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, txHash: result.txHash }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Server failed to credit deposit');
        return;
      }

      setSuccess(`Deposited ${amount} GALA`);
      onBalanceChanged();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    if (amount <= 0 || amount > gameBalance) return;
    setWithdrawing(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Withdrawal failed');
        return;
      }

      setSuccess(`Withdrew ${amount} GALA`);
      onBalanceChanged();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWithdrawing(false);
    }
  };

  const busy = depositing || withdrawing;

  return (
    <div className="deposit-panel">
      <div className="panel-header">
        <h3>Wallet</h3>
      </div>
      {gameBalance <= 0 && (
        <div className="deposit-prompt">
          Deposit GALA from your wallet to start playing
        </div>
      )}
      <div className="wallet-balances">
        <div className="balance-row">
          <span>GalaChain (deposit-ready)</span>
          <span>{onChainBalance.toFixed(2)} GALA{ethUsdPrice > 0 ? ` ($${(onChainBalance * ethUsdPrice).toFixed(2)})` : ''}</span>
        </div>
        <div className="balance-row">
          <span>In-game</span>
          <span>{gameBalance.toFixed(2)} GALA{ethUsdPrice > 0 ? ` ($${(gameBalance * ethUsdPrice).toFixed(2)})` : ''}</span>
        </div>
      </div>
      <div className="input-group">
        <label>Amount (GALA)</label>
        <input
          type="number"
          min={1}
          step={1}
          value={amount}
          onChange={e => setAmount(Math.max(0, parseFloat(e.target.value) || 0))}
          disabled={busy}
        />
      </div>
      <div className="deposit-actions">
        <button
          className="btn btn-deposit"
          onClick={handleDeposit}
          disabled={busy || amount <= 0 || amount > onChainBalance}
        >
          {depositing ? 'Depositing...' : 'Deposit'}
        </button>
        <button
          className="btn btn-withdraw"
          onClick={handleWithdraw}
          disabled={busy || amount <= 0 || amount > gameBalance}
        >
          {withdrawing ? 'Withdrawing...' : 'Withdraw'}
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
      {success && <div className="success-text">{success}</div>}
    </div>
  );
}
