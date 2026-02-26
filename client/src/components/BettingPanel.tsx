import { useState, useEffect, useRef } from 'react';
import type { Market } from '../hooks/useSocket';
import { apiFetch } from '../services/api';

function useCountdown(endTime: number) {
  const [timeLeft, setTimeLeft] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!endTime) {
      setTimeLeft(0);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, endTime - Date.now());
      setTimeLeft(remaining);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [endTime]);

  return timeLeft;
}

interface Props {
  market: Market | null;
  isAuthenticated: boolean;
  balance: number;
  onOrderPlaced: () => void;
  selectedGame?: string;
}

export function BettingPanel({ market, isAuthenticated, balance, onOrderPlaced, selectedGame = 'btc-5min' }: Props) {
  const [side, setSide] = useState<'UP' | 'DOWN'>('UP');
  const [shares, setShares] = useState<number>(10);
  const [price, setPrice] = useState<number>(0.5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const timeLeft = useCountdown(market?.endTime || 0);
  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);
  const tenths = Math.floor((timeLeft % 1000) / 100);

  const estimatedCost = shares * price;
  // Polymarket taker fee: shares * 0.25 * (p*(1-p))^2
  const p = Math.max(0.01, Math.min(0.99, price));
  const takerFee = shares * 0.25 * Math.pow(p * (1 - p), 2);
  const platformFee = estimatedCost * 0.05;
  const totalCost = estimatedCost + takerFee + platformFee;

  const handleSubmit = async () => {
    if (!isAuthenticated || !market || market.status !== 'trading') return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch(`/api/games/${selectedGame}/bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side, price, shares }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(`Order placed! ${data.order?.status || 'open'}`);
      onOrderPlaced();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const canTrade = isAuthenticated && market?.status === 'trading' && balance >= totalCost;

  return (
    <div className="betting-panel">
      <div className="panel-header">
        <h3>Place Bet</h3>
        {market && (
          <div className={`market-status ${market.status}`}>
            {market.status === 'trading' && (
              <span className="countdown">{minutes}:{seconds.toString().padStart(2, '0')}.{tenths}</span>
            )}
            <span className="status-badge">{market.status.toUpperCase()}</span>
          </div>
        )}
      </div>

      {market && market.status === 'trading' && (
        <div className="target-price">
          {(market as any).title || `Target: ${((market as any).openValue ?? (market as any).openPrice)?.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
        </div>
      )}

      <div className="side-selector">
        <button
          className={`side-btn up ${side === 'UP' ? 'active' : ''}`}
          onClick={() => setSide('UP')}
        >
          UP
        </button>
        <button
          className={`side-btn down ${side === 'DOWN' ? 'active' : ''}`}
          onClick={() => setSide('DOWN')}
        >
          DOWN
        </button>
      </div>

      <div className="input-group">
        <label>Shares</label>
        <input
          type="number"
          min={1}
          max={10000}
          value={shares}
          onChange={e => setShares(Math.max(1, parseInt(e.target.value) || 1))}
        />
      </div>

      <div className="input-group">
        <label>Price (probability: {(price * 100).toFixed(0)}%)</label>
        <input
          type="range"
          min={0.01}
          max={0.99}
          step={0.01}
          value={price}
          onChange={e => setPrice(parseFloat(e.target.value))}
        />
        <div className="price-display">{price.toFixed(4)} ETH/share</div>
      </div>

      <div className="cost-breakdown">
        <div className="cost-row">
          <span>Cost</span>
          <span>{estimatedCost.toFixed(6)} ETH</span>
        </div>
        <div className="cost-row">
          <span>Taker Fee</span>
          <span>{takerFee.toFixed(6)} ETH</span>
        </div>
        <div className="cost-row">
          <span>Platform Fee (5%)</span>
          <span>{platformFee.toFixed(6)} ETH</span>
        </div>
        <div className="cost-row total">
          <span>Total</span>
          <span>{totalCost.toFixed(6)} ETH</span>
        </div>
        <div className="cost-row potential">
          <span>Potential Payout</span>
          <span className="payout">{shares.toFixed(6)} ETH</span>
        </div>
      </div>

      <button
        className={`btn btn-lg ${side === 'UP' ? 'btn-up' : 'btn-down'}`}
        onClick={handleSubmit}
        disabled={!canTrade || submitting}
      >
        {!isAuthenticated
          ? 'Connect Wallet to Bet'
          : submitting
          ? 'Placing...'
          : market?.status !== 'trading'
          ? 'Market Closed'
          : balance <= 0
          ? 'Deposit ETH to Bet'
          : balance < totalCost
          ? 'Insufficient Balance'
          : `Bet ${side} - ${totalCost.toFixed(6)} ETH`}
      </button>

      {error && <div className="error-text">{error}</div>}
      {success && <div className="success-text">{success}</div>}

      <div className="balance-display">
        Balance: <strong>{balance.toFixed(6)} ETH</strong>
      </div>
    </div>
  );
}
