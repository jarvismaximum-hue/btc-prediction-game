import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../services/api';

interface GameMarket {
  id: string;
  gameType: string;
  status: string;
  title: string;
  description: string;
  openValue: number;
  startTime: number;
  endTime: number;
  timeLeftMs: number;
}

interface GameInfo {
  type: string;
  name: string;
  description: string;
  icon: string;
  durationMs: number;
  currentMarket: GameMarket | null;
}

interface Position {
  userId: string;
  marketId: string;
  gameType?: string;
  side: 'UP' | 'DOWN';
  shares: number;
  avgPrice: number;
  pnl: number;
}

interface Props {
  positions: Position[];
  isAuthenticated: boolean;
  balance: number;
  onOrderPlaced: () => void;
}

function CountdownTimer({ endTime }: { endTime: number }) {
  const [timeLeft, setTimeLeft] = useState(Math.max(0, endTime - Date.now()));
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, endTime - Date.now());
      setTimeLeft(remaining);
      if (remaining > 0) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [endTime]);

  const mins = Math.floor(timeLeft / 60000);
  const secs = Math.floor((timeLeft % 60000) / 1000);
  const tenths = Math.floor((timeLeft % 1000) / 100);

  return (
    <span className="grid-countdown">
      {mins}:{secs.toString().padStart(2, '0')}<span className="grid-countdown-tenths">.{tenths}</span>
    </span>
  );
}

function BetForm({ game, balance, onOrderPlaced }: { game: GameInfo; balance: number; onOrderPlaced: () => void }) {
  const [side, setSide] = useState<'UP' | 'DOWN'>('UP');
  const [shares, setShares] = useState(10);
  const [price, setPrice] = useState(0.5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const cost = shares * price;
  const p = Math.max(0.01, Math.min(0.99, price));
  const takerFee = shares * 0.25 * Math.pow(p * (1 - p), 2);
  const platformFee = cost * 0.05;
  const totalCost = cost + takerFee + platformFee;

  const handleSubmit = async () => {
    if (!game.currentMarket || game.currentMarket.status !== 'trading') return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch(`/api/games/${game.type}/bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side, price, shares }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess('Placed!');
      onOrderPlaced();
      setTimeout(() => setSuccess(null), 2000);
    } catch (e: any) {
      setError(e.message);
      setTimeout(() => setError(null), 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const canTrade = game.currentMarket?.status === 'trading' && balance >= totalCost;

  return (
    <div className="grid-bet-form" onClick={e => e.stopPropagation()}>
      <div className="grid-side-selector">
        <button className={`grid-side-btn up ${side === 'UP' ? 'active' : ''}`} onClick={() => setSide('UP')}>UP</button>
        <button className={`grid-side-btn down ${side === 'DOWN' ? 'active' : ''}`} onClick={() => setSide('DOWN')}>DOWN</button>
      </div>
      <div className="grid-bet-inputs">
        <div className="grid-input-group">
          <label>Shares</label>
          <input type="number" min={1} max={10000} value={shares} onChange={e => setShares(Math.max(1, parseInt(e.target.value) || 1))} />
        </div>
        <div className="grid-input-group">
          <label>Price ({(price * 100).toFixed(0)}%)</label>
          <input type="range" min={0.01} max={0.99} step={0.01} value={price} onChange={e => setPrice(parseFloat(e.target.value))} />
        </div>
      </div>
      <div className="grid-bet-cost">
        <span>Total: {totalCost.toFixed(4)} ETH</span>
        <span className="grid-bet-payout">Win: {shares.toFixed(4)} ETH</span>
      </div>
      <button
        className={`grid-bet-submit ${side === 'UP' ? 'up' : 'down'}`}
        onClick={handleSubmit}
        disabled={!canTrade || submitting}
      >
        {submitting ? '...' : balance < totalCost ? 'Low Balance' : `${side} ${totalCost.toFixed(4)}`}
      </button>
      {error && <div className="grid-bet-error">{error}</div>}
      {success && <div className="grid-bet-success">{success}</div>}
    </div>
  );
}

export function GameGrid({ positions, isAuthenticated, balance, onOrderPlaced }: Props) {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  useEffect(() => {
    const fetchGames = async () => {
      try {
        const res = await apiFetch('/api/games');
        if (res.ok) setGames(await res.json());
      } catch {}
    };
    fetchGames();
    const interval = setInterval(fetchGames, 2000);
    return () => clearInterval(interval);
  }, []);

  const getPositionsForGame = (gameType: string, marketId?: string) => {
    return positions.filter(p => {
      if (p.gameType) return p.gameType === gameType;
      if (marketId) return p.marketId === marketId;
      return false;
    });
  };

  return (
    <div className="game-grid">
      {games.map(game => {
        const market = game.currentMarket;
        const isTrading = market?.status === 'trading';
        const isSettling = market?.status === 'settling';
        const gamePositions = getPositionsForGame(game.type, market?.id);
        const isExpanded = expandedGame === game.type;
        const hasPosition = gamePositions.length > 0;

        return (
          <div
            key={game.type}
            className={`game-card ${isTrading ? 'trading' : ''} ${isSettling ? 'settling' : ''} ${isExpanded ? 'expanded' : ''} ${hasPosition ? 'has-position' : ''}`}
            onClick={() => setExpandedGame(isExpanded ? null : game.type)}
          >
            <div className="game-card-header">
              <div className="game-card-icon">{game.icon}</div>
              <div className="game-card-info">
                <div className="game-card-name">{game.name}</div>
                {market && (
                  <div className={`game-card-status ${market.status}`}>
                    {market.status.toUpperCase()}
                  </div>
                )}
              </div>
              {isTrading && market && (
                <CountdownTimer endTime={market.endTime} />
              )}
              {isSettling && (
                <span className="grid-settling-indicator">Settling...</span>
              )}
              {!market && (
                <span className="grid-waiting-indicator">Waiting</span>
              )}
            </div>

            {market && (
              <div className="game-card-market">
                <div className="game-card-target">
                  {market.title || `Open: ${market.openValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
                </div>
              </div>
            )}

            {hasPosition && (
              <div className="game-card-positions">
                {gamePositions.map((pos, i) => {
                  const cost = pos.shares * pos.avgPrice;
                  return (
                    <div key={i} className={`game-card-position ${pos.side.toLowerCase()}`}>
                      <span className="pos-side">{pos.side}</span>
                      <span className="pos-shares">{pos.shares.toFixed(1)} shares</span>
                      <span className="pos-cost">{cost.toFixed(4)} ETH</span>
                    </div>
                  );
                })}
              </div>
            )}

            {isExpanded && isAuthenticated && isTrading && (
              <BetForm game={game} balance={balance} onOrderPlaced={onOrderPlaced} />
            )}
          </div>
        );
      })}
    </div>
  );
}
