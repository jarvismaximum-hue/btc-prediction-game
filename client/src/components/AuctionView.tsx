import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../services/api';
import { AuctionPriceChart } from './AuctionPriceChart';
import type { Socket } from 'socket.io-client';

/* ── Types ────────────────────────────────────────────────────── */

type AuctionPhase = 'PENDING' | 'AUCTION' | 'BURN' | 'SETTLEMENT' | 'COMPLETED';

interface AuctionGame {
  id: string;
  name: string;
  tokenSymbol: string;
  phase: AuctionPhase;
  totalSupply: number;
  remainingSupply: number;
  auctionStartPrice: number;
  auctionFloorPrice: number;
  auctionStartedAt: number | null;
  auctionEndsAt: number | null;
  burnStartedAt: number | null;
  burnEndsAt: number | null;
  potAmount: number;
  platformFeeRate: number;
  totalTokensBurned: number;
  priceHistory: { timestamp: number; price: number }[];
  currentPrice?: number;
  currentBurnFee?: number;
}

interface AuctionTransaction {
  id: string;
  gameId: string;
  address: string;
  type: 'BUY' | 'BURN' | 'SETTLEMENT_BURN';
  tokenAmount: number;
  ethAmount: number;
  pricePerToken: number;
  fee: number;
  timestamp: number;
}

interface GameDetail {
  game: AuctionGame;
  currentPrice: number;
  currentBurnFee: number;
  userTokenBalance: number;
  totalRemainingTokens: number;
}

interface Props {
  isAuthenticated: boolean;
  balance: number;
  onBalanceChanged: () => void;
  socketRef: React.RefObject<Socket | null>;
}

/* ── Phase sort order ─────────────────────────────────────────── */

const PHASE_ORDER: Record<AuctionPhase, number> = {
  AUCTION: 0,
  BURN: 1,
  SETTLEMENT: 2,
  PENDING: 3,
  COMPLETED: 4,
};

/* ── Phase badge colors ───────────────────────────────────────── */

function phaseBadgeStyle(phase: AuctionPhase): React.CSSProperties {
  switch (phase) {
    case 'AUCTION':
      return { background: 'rgba(0,212,170,0.15)', color: 'var(--green)' };
    case 'BURN':
      return { background: 'rgba(255,165,0,0.15)', color: '#ffa500' };
    case 'SETTLEMENT':
      return { background: 'rgba(255,215,0,0.15)', color: 'var(--gold)' };
    case 'COMPLETED':
      return { background: 'rgba(100,116,139,0.15)', color: 'var(--text-muted)' };
    case 'PENDING':
    default:
      return { background: 'rgba(59,130,246,0.15)', color: 'var(--blue)' };
  }
}

/* ── CountdownTimer (requestAnimationFrame) ───────────────────── */

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

  if (timeLeft <= 0) return <span className="auction-countdown">0:00</span>;

  const mins = Math.floor(timeLeft / 60000);
  const secs = Math.floor((timeLeft % 60000) / 1000);
  const tenths = Math.floor((timeLeft % 1000) / 100);

  return (
    <span className="auction-countdown">
      {mins}:{secs.toString().padStart(2, '0')}
      <span className="auction-countdown-tenths">.{tenths}</span>
    </span>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function formatAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatEth(val: number, decimals = 4): string {
  return val.toFixed(decimals);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

/* ── Main Component ───────────────────────────────────────────── */

export function AuctionView({ isAuthenticated, balance, onBalanceChanged, socketRef }: Props) {
  /* -- State: game list -- */
  const [games, setGames] = useState<AuctionGame[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  /* -- State: selected game detail -- */
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [transactions, setTransactions] = useState<AuctionTransaction[]>([]);

  /* -- State: buy form -- */
  const [buyAmount, setBuyAmount] = useState('');
  const [buySubmitting, setBuySubmitting] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buySuccess, setBuySuccess] = useState<string | null>(null);

  /* -- State: burn form -- */
  const [burnAmount, setBurnAmount] = useState('');
  const [burnSubmitting, setBurnSubmitting] = useState(false);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [burnSuccess, setBurnSuccess] = useState<string | null>(null);

  /* ─── Fetch game list ──────────────────────────────────────── */
  useEffect(() => {
    const fetchGames = async () => {
      try {
        const res = await apiFetch('/api/auctions');
        if (res.ok) {
          const data: AuctionGame[] = await res.json();
          data.sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]);
          setGames(data);
        }
      } catch { /* ignore */ }
    };
    fetchGames();
    const interval = setInterval(fetchGames, 2000);
    return () => clearInterval(interval);
  }, []);

  /* ─── Fetch selected game detail + transactions ────────────── */
  useEffect(() => {
    if (!selectedGameId) {
      setDetail(null);
      setTransactions([]);
      return;
    }
    const fetchDetail = async () => {
      try {
        const [detailRes, txRes] = await Promise.all([
          apiFetch(`/api/auctions/${selectedGameId}`),
          apiFetch(`/api/auctions/${selectedGameId}/transactions`),
        ]);
        if (detailRes.ok) setDetail(await detailRes.json());
        if (txRes.ok) {
          const txs: AuctionTransaction[] = await txRes.json();
          setTransactions(txs.slice(0, 20));
        }
      } catch { /* ignore */ }
    };
    fetchDetail();
    const interval = setInterval(fetchDetail, 2000);
    return () => clearInterval(interval);
  }, [selectedGameId]);

  /* ─── Socket listeners ─────────────────────────────────────── */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleUpdate = (data: any) => {
      if (data && data.id) {
        setGames(prev =>
          prev.map(g => (g.id === data.id ? { ...g, ...data } : g))
        );
        if (data.id === selectedGameId) {
          setDetail(prev => prev ? { ...prev, game: { ...prev.game, ...data } } : prev);
        }
      }
    };

    const handleBuyTx = (tx: AuctionTransaction) => {
      if (tx.gameId === selectedGameId) {
        setTransactions(prev => [tx, ...prev].slice(0, 20));
      }
    };

    const handleBurnTx = (tx: AuctionTransaction) => {
      if (tx.gameId === selectedGameId) {
        setTransactions(prev => [tx, ...prev].slice(0, 20));
      }
    };

    const handlePot = (data: { gameId: string; potAmount: number }) => {
      setGames(prev =>
        prev.map(g => (g.id === data.gameId ? { ...g, potAmount: data.potAmount } : g))
      );
      if (data.gameId === selectedGameId) {
        setDetail(prev =>
          prev ? { ...prev, game: { ...prev.game, potAmount: data.potAmount } } : prev
        );
      }
    };

    const handlePrice = (data: { gameId: string; currentPrice: number }) => {
      if (data.gameId === selectedGameId) {
        setDetail(prev =>
          prev ? { ...prev, currentPrice: data.currentPrice } : prev
        );
      }
      setGames(prev =>
        prev.map(g => (g.id === data.gameId ? { ...g, currentPrice: data.currentPrice } : g))
      );
    };

    const handlePhaseChange = (data: { gameId: string; phase: AuctionPhase }) => {
      setGames(prev => {
        const updated = prev.map(g =>
          g.id === data.gameId ? { ...g, phase: data.phase } : g
        );
        updated.sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]);
        return updated;
      });
      if (data.gameId === selectedGameId) {
        setDetail(prev =>
          prev ? { ...prev, game: { ...prev.game, phase: data.phase } } : prev
        );
      }
    };

    socket.on('auction:update', handleUpdate);
    socket.on('auction:buy', handleBuyTx);
    socket.on('auction:burn', handleBurnTx);
    socket.on('auction:pot', handlePot);
    socket.on('auction:price', handlePrice);
    socket.on('auction:phaseChange', handlePhaseChange);

    return () => {
      socket.off('auction:update', handleUpdate);
      socket.off('auction:buy', handleBuyTx);
      socket.off('auction:burn', handleBurnTx);
      socket.off('auction:pot', handlePot);
      socket.off('auction:price', handlePrice);
      socket.off('auction:phaseChange', handlePhaseChange);
    };
  }, [socketRef, selectedGameId]);

  /* ─── Buy handler ──────────────────────────────────────────── */
  const handleBuy = useCallback(async () => {
    if (!selectedGameId || !buyAmount) return;
    const amount = parseFloat(buyAmount);
    if (isNaN(amount) || amount <= 0) {
      setBuyError('Enter a valid amount');
      return;
    }
    setBuySubmitting(true);
    setBuyError(null);
    setBuySuccess(null);
    try {
      const res = await apiFetch('/api/auctions/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: selectedGameId, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Buy failed');
      setBuySuccess('Purchase successful!');
      setBuyAmount('');
      onBalanceChanged();
      setTimeout(() => setBuySuccess(null), 3000);
    } catch (e: any) {
      setBuyError(e.message);
      setTimeout(() => setBuyError(null), 4000);
    } finally {
      setBuySubmitting(false);
    }
  }, [selectedGameId, buyAmount, onBalanceChanged]);

  /* ─── Burn handler ─────────────────────────────────────────── */
  const handleBurn = useCallback(async () => {
    if (!selectedGameId || !burnAmount) return;
    const tokenAmount = parseFloat(burnAmount);
    if (isNaN(tokenAmount) || tokenAmount <= 0) {
      setBurnError('Enter a valid amount');
      return;
    }
    setBurnSubmitting(true);
    setBurnError(null);
    setBurnSuccess(null);
    try {
      const res = await apiFetch('/api/auctions/burn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: selectedGameId, tokenAmount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Burn failed');
      setBurnSuccess('Tokens burned!');
      setBurnAmount('');
      onBalanceChanged();
      setTimeout(() => setBurnSuccess(null), 3000);
    } catch (e: any) {
      setBurnError(e.message);
      setTimeout(() => setBurnError(null), 4000);
    } finally {
      setBurnSubmitting(false);
    }
  }, [selectedGameId, burnAmount, onBalanceChanged]);

  /* ─── Derived values ───────────────────────────────────────── */
  const selectedGame = detail?.game ?? games.find(g => g.id === selectedGameId) ?? null;

  const circulating = selectedGame
    ? selectedGame.totalSupply - selectedGame.remainingSupply - selectedGame.totalTokensBurned
    : 0;
  const burned = selectedGame ? selectedGame.totalTokensBurned : 0;
  const unsold = selectedGame ? selectedGame.remainingSupply : 0;
  const totalSupply = selectedGame ? selectedGame.totalSupply : 1;

  const backingPerToken =
    selectedGame && circulating > 0
      ? selectedGame.potAmount / circulating
      : 0;

  const userTokens = detail?.userTokenBalance ?? 0;
  const positionValue = userTokens * backingPerToken;
  const burnFeeRate = detail?.currentBurnFee ?? selectedGame?.currentBurnFee ?? 0;
  const netClaim = positionValue * (1 - burnFeeRate);

  const currentPrice = detail?.currentPrice ?? selectedGame?.currentPrice ?? 0;

  // Estimate tokens for buy preview
  const buyEthVal = parseFloat(buyAmount) || 0;
  const estimatedTokens = currentPrice > 0 ? buyEthVal / currentPrice : 0;

  // Burn preview
  const burnTokenVal = parseFloat(burnAmount) || 0;
  const burnClaimPreview = burnTokenVal * backingPerToken * (1 - burnFeeRate);

  /* ─── End time for countdown ───────────────────────────────── */
  const getEndTime = (game: AuctionGame): number | null => {
    if (game.phase === 'AUCTION' && game.auctionEndsAt) return game.auctionEndsAt;
    if ((game.phase === 'BURN' || game.phase === 'SETTLEMENT') && game.burnEndsAt) return game.burnEndsAt;
    return null;
  };

  /* ─── Render ───────────────────────────────────────────────── */
  return (
    <div className="auction-layout">
      {/* ── Game List Sidebar ── */}
      <div className="auction-sidebar">
        <div className="auction-sidebar-header">Auction Games</div>
        {games.length === 0 && (
          <div className="auction-empty">No auction games available</div>
        )}
        {games.map(game => {
          const endTime = getEndTime(game);
          const isSelected = game.id === selectedGameId;
          return (
            <div
              key={game.id}
              className={`auction-list-item ${isSelected ? 'selected' : ''}`}
              onClick={() => {
                setSelectedGameId(isSelected ? null : game.id);
                setBuyAmount('');
                setBurnAmount('');
                setBuyError(null);
                setBurnError(null);
              }}
            >
              <div className="auction-list-top">
                <div className="auction-list-name">
                  <span className="auction-game-name">{game.name}</span>
                  <span className="auction-token-symbol">${game.tokenSymbol}</span>
                </div>
                <span className="auction-phase-badge" style={phaseBadgeStyle(game.phase)}>
                  {game.phase}
                </span>
              </div>
              <div className="auction-list-bottom">
                <span className="auction-list-pot">
                  Pot: <span className="auction-pot-value">{formatEth(game.potAmount)} GALA</span>
                </span>
                {endTime && endTime > Date.now() && (
                  <CountdownTimer endTime={endTime} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Game Detail Panel ── */}
      <div className="auction-detail">
        {!selectedGame ? (
          <div className="auction-detail-empty">
            <div className="auction-detail-empty-icon">&#9881;</div>
            <div className="auction-detail-empty-text">Select an auction game to view details</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="auction-detail-header">
              <div>
                <span className="auction-detail-name">{selectedGame.name}</span>
                <span className="auction-detail-symbol">${selectedGame.tokenSymbol}</span>
              </div>
              <span className="auction-phase-badge" style={phaseBadgeStyle(selectedGame.phase)}>
                {selectedGame.phase}
              </span>
            </div>

            {/* Stats Row */}
            <div className="auction-stats-row">
              <div className="auction-stat">
                <div className="auction-stat-label">Pot</div>
                <div className="auction-stat-value" style={{ color: 'var(--green)' }}>
                  {formatEth(selectedGame.potAmount)} GALA
                </div>
              </div>
              <div className="auction-stat">
                <div className="auction-stat-label">Token Price</div>
                <div className="auction-stat-value">
                  {currentPrice > 0 ? `${formatEth(currentPrice, 6)} GALA` : '--'}
                </div>
              </div>
              <div className="auction-stat">
                <div className="auction-stat-label">Backing/Token</div>
                <div className="auction-stat-value" style={{ color: 'var(--blue)' }}>
                  {backingPerToken > 0 ? `${formatEth(backingPerToken, 6)} GALA` : '--'}
                </div>
              </div>
              <div className="auction-stat">
                <div className="auction-stat-label">Burn Fee</div>
                <div className="auction-stat-value" style={{ color: '#ffa500' }}>
                  {(burnFeeRate * 100).toFixed(1)}%
                </div>
              </div>
              <div className="auction-stat">
                <div className="auction-stat-label">Time Left</div>
                <div className="auction-stat-value">
                  {(() => {
                    const et = getEndTime(selectedGame);
                    if (et && et > Date.now()) return <CountdownTimer endTime={et} />;
                    if (selectedGame.phase === 'COMPLETED') return 'Ended';
                    if (selectedGame.phase === 'PENDING') return 'Not Started';
                    return '--';
                  })()}
                </div>
              </div>
            </div>

            {/* Price Chart */}
            {selectedGame.priceHistory && selectedGame.priceHistory.length > 1 && (
              <div className="auction-chart-section">
                <div className="auction-section-title">Price History</div>
                <AuctionPriceChart data={selectedGame.priceHistory} />
              </div>
            )}

            {/* Supply Bar */}
            <div className="auction-supply-section">
              <div className="auction-section-title">Token Supply</div>
              <div className="auction-supply-bar">
                <div
                  className="auction-supply-circulating"
                  style={{ width: `${(circulating / totalSupply) * 100}%` }}
                  title={`Circulating: ${circulating.toFixed(0)}`}
                />
                <div
                  className="auction-supply-burned"
                  style={{ width: `${(burned / totalSupply) * 100}%` }}
                  title={`Burned: ${burned.toFixed(0)}`}
                />
                <div
                  className="auction-supply-unsold"
                  style={{ width: `${(unsold / totalSupply) * 100}%` }}
                  title={`Unsold: ${unsold.toFixed(0)}`}
                />
              </div>
              <div className="auction-supply-labels">
                <span className="auction-supply-label" style={{ color: 'var(--green)' }}>
                  Circulating: {circulating.toFixed(0)}
                </span>
                <span className="auction-supply-label" style={{ color: '#ffa500' }}>
                  Burned: {burned.toFixed(0)}
                </span>
                <span className="auction-supply-label" style={{ color: 'var(--text-muted)' }}>
                  Unsold: {unsold.toFixed(0)}
                </span>
              </div>
            </div>

            {/* Your Position */}
            {isAuthenticated && (
              <div className="auction-position-section">
                <div className="auction-section-title">Your Position</div>
                <div className="auction-position-row">
                  <div className="auction-position-item">
                    <span className="auction-position-label">Tokens</span>
                    <span className="auction-position-value">{userTokens.toFixed(2)}</span>
                  </div>
                  <div className="auction-position-item">
                    <span className="auction-position-label">Value</span>
                    <span className="auction-position-value" style={{ color: 'var(--green)' }}>
                      {formatEth(positionValue)} GALA
                    </span>
                  </div>
                  <div className="auction-position-item">
                    <span className="auction-position-label">Net Claim</span>
                    <span className="auction-position-value" style={{ color: 'var(--gold)' }}>
                      {formatEth(netClaim)} GALA
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Action Panel */}
            {isAuthenticated && (
              <div className="auction-actions">
                {/* Buy Panel */}
                <div className={`auction-action-panel ${selectedGame.phase !== 'AUCTION' ? 'disabled' : ''}`}>
                  <div className="auction-action-title">Buy Tokens</div>
                  {selectedGame.phase !== 'AUCTION' && (
                    <div className="auction-action-disabled-msg">Available during AUCTION phase</div>
                  )}
                  <div className="auction-action-input-row">
                    <input
                      type="number"
                      className="auction-action-input"
                      placeholder="GALA amount"
                      value={buyAmount}
                      onChange={e => setBuyAmount(e.target.value)}
                      disabled={selectedGame.phase !== 'AUCTION'}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="auction-quick-btns">
                    {[0.01, 0.05, 0.1].map(v => (
                      <button
                        key={v}
                        className="auction-quick-btn"
                        onClick={() => setBuyAmount(v.toString())}
                        disabled={selectedGame.phase !== 'AUCTION'}
                      >
                        {v} GALA
                      </button>
                    ))}
                  </div>
                  {buyEthVal > 0 && currentPrice > 0 && (
                    <div className="auction-preview">
                      ~{estimatedTokens.toFixed(2)} {selectedGame.tokenSymbol} @ {formatEth(currentPrice, 6)} GALA
                    </div>
                  )}
                  <button
                    className="auction-submit-btn auction-buy-btn"
                    onClick={handleBuy}
                    disabled={selectedGame.phase !== 'AUCTION' || buySubmitting || !buyAmount || balance < buyEthVal}
                  >
                    {buySubmitting
                      ? 'Buying...'
                      : balance < buyEthVal
                        ? 'Insufficient Balance'
                        : 'Buy'}
                  </button>
                  {buyError && <div className="auction-msg-error">{buyError}</div>}
                  {buySuccess && <div className="auction-msg-success">{buySuccess}</div>}
                </div>

                {/* Burn Panel */}
                <div className={`auction-action-panel ${selectedGame.phase !== 'BURN' && selectedGame.phase !== 'SETTLEMENT' ? 'disabled' : ''}`}>
                  <div className="auction-action-title">Burn Tokens</div>
                  {selectedGame.phase !== 'BURN' && selectedGame.phase !== 'SETTLEMENT' && (
                    <div className="auction-action-disabled-msg">Available during BURN / SETTLEMENT phase</div>
                  )}
                  <div className="auction-action-input-row">
                    <input
                      type="number"
                      className="auction-action-input"
                      placeholder="Token amount"
                      value={burnAmount}
                      onChange={e => setBurnAmount(e.target.value)}
                      disabled={selectedGame.phase !== 'BURN' && selectedGame.phase !== 'SETTLEMENT'}
                      min="0"
                      step="1"
                    />
                  </div>
                  <div className="auction-quick-btns">
                    {[
                      { label: '25%', pct: 0.25 },
                      { label: '50%', pct: 0.5 },
                      { label: '100%', pct: 1 },
                    ].map(({ label, pct }) => (
                      <button
                        key={label}
                        className="auction-quick-btn"
                        onClick={() => setBurnAmount((userTokens * pct).toFixed(2))}
                        disabled={
                          (selectedGame.phase !== 'BURN' && selectedGame.phase !== 'SETTLEMENT') ||
                          userTokens <= 0
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {burnTokenVal > 0 && (
                    <div className="auction-preview">
                      Claim: {formatEth(burnClaimPreview)} GALA (fee: {(burnFeeRate * 100).toFixed(1)}%)
                    </div>
                  )}
                  <button
                    className="auction-submit-btn auction-burn-btn"
                    onClick={handleBurn}
                    disabled={
                      (selectedGame.phase !== 'BURN' && selectedGame.phase !== 'SETTLEMENT') ||
                      burnSubmitting ||
                      !burnAmount ||
                      burnTokenVal > userTokens
                    }
                  >
                    {burnSubmitting
                      ? 'Burning...'
                      : burnTokenVal > userTokens
                        ? 'Insufficient Tokens'
                        : 'Burn'}
                  </button>
                  {burnError && <div className="auction-msg-error">{burnError}</div>}
                  {burnSuccess && <div className="auction-msg-success">{burnSuccess}</div>}
                </div>
              </div>
            )}

            {/* Not authenticated prompt */}
            {!isAuthenticated && (
              <div className="auction-login-prompt">
                Connect your wallet to buy or burn tokens
              </div>
            )}

            {/* Transaction Feed */}
            <div className="auction-tx-section">
              <div className="auction-section-title">Recent Transactions</div>
              {transactions.length === 0 ? (
                <div className="auction-tx-empty">No transactions yet</div>
              ) : (
                <div className="auction-tx-list">
                  {transactions.map(tx => (
                    <div key={tx.id} className="auction-tx-row">
                      <span
                        className="auction-tx-type"
                        style={{
                          color:
                            tx.type === 'BUY'
                              ? 'var(--green)'
                              : tx.type === 'BURN'
                                ? '#ffa500'
                                : 'var(--gold)',
                        }}
                      >
                        {tx.type}
                      </span>
                      <span className="auction-tx-addr">{formatAddr(tx.address)}</span>
                      <span className="auction-tx-amount">
                        {tx.tokenAmount.toFixed(2)} tkn
                      </span>
                      <span className="auction-tx-eth">
                        {formatEth(tx.ethAmount)} GALA
                      </span>
                      <span className="auction-tx-time">{timeAgo(tx.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
