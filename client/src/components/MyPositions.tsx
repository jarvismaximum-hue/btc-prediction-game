import type { Market } from '../hooks/useSocket';

interface Position {
  userId: string;
  marketId: string;
  side: 'UP' | 'DOWN';
  shares: number;
  avgPrice: number;
  pnl: number;
}

interface Props {
  positions: Position[];
  market: Market | null;
  settledMarkets: Market[];
}

export function MyPositions({ positions, market, settledMarkets }: Props) {
  // Split positions into current market and settled
  const currentPositions = market
    ? positions.filter(p => p.marketId === market.id)
    : [];

  const settledPositions = positions.filter(p => {
    if (market && p.marketId === market.id) return false; // skip current market
    return p.pnl !== 0; // settled positions have non-zero pnl
  });

  // Build a map of market outcomes for settled positions
  const marketMap = new Map<string, Market>();
  if (settledMarkets) {
    for (const m of settledMarkets) {
      marketMap.set(m.id, m);
    }
  }

  return (
    <div className="my-positions">
      {/* Active positions in current market */}
      {currentPositions.length > 0 ? (
        <>
          <h3>Active Positions</h3>
          <div className="positions-header">
            <span>Side</span>
            <span>Shares</span>
            <span>Avg Price</span>
            <span>Cost</span>
            <span>Payout</span>
            <span>P&L</span>
          </div>
          <div className="positions-list">
            {currentPositions.map((p, i) => {
              const cost = p.shares * p.avgPrice;
              const potentialPayout = p.shares;
              const potentialProfit = potentialPayout - cost;
              const isSettled = market?.status === 'settled';
              const isWinner = isSettled && market?.outcome === p.side;
              const actualPnl = isSettled ? (isWinner ? potentialProfit : -cost) : null;

              return (
                <div key={i} className={`position-row ${p.side.toLowerCase()}`}>
                  <span className={`position-side ${p.side.toLowerCase()}`}>{p.side}</span>
                  <span className="position-shares">{p.shares.toFixed(1)}</span>
                  <span className="position-avgprice">{p.avgPrice.toFixed(2)}</span>
                  <span className="position-cost">{cost.toFixed(2)}</span>
                  <span className="position-payout">
                    {isSettled
                      ? isWinner ? `${potentialPayout.toFixed(2)}` : '0.00'
                      : `${potentialPayout.toFixed(2)}`
                    }
                  </span>
                  <span className={`position-pnl ${actualPnl !== null ? (actualPnl >= 0 ? 'profit' : 'loss') : (potentialProfit >= 0 ? 'profit' : 'loss')}`}>
                    {actualPnl !== null
                      ? `${actualPnl >= 0 ? '+' : ''}${actualPnl.toFixed(2)}`
                      : `${potentialProfit >= 0 ? '+' : ''}${potentialProfit.toFixed(2)}`
                    }
                    {actualPnl === null && <span className="pnl-label"> if {p.side}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <h3>Active Positions</h3>
          <div className="positions-empty">No active positions — place a bet to start</div>
        </>
      )}

      {/* Settled positions from past markets */}
      {settledPositions.length > 0 && (
        <>
          <h3 className="settled-positions-title">Filled Positions</h3>
          <div className="positions-header settled">
            <span>Side</span>
            <span>Shares</span>
            <span>Avg Price</span>
            <span>Cost</span>
            <span>Payout</span>
            <span>P&L</span>
          </div>
          <div className="positions-list">
            {settledPositions.map((p, i) => {
              const cost = p.shares * p.avgPrice;
              const m = marketMap.get(p.marketId);
              const isWinner = m ? m.outcome === p.side : p.pnl > 0;
              const payout = isWinner ? p.shares : 0;

              return (
                <div key={`settled-${i}`} className={`position-row settled ${p.pnl >= 0 ? 'won' : 'lost'}`}>
                  <span className={`position-side ${p.side.toLowerCase()}`}>{p.side}</span>
                  <span className="position-shares">{p.shares.toFixed(1)}</span>
                  <span className="position-avgprice">{p.avgPrice.toFixed(2)}</span>
                  <span className="position-cost">{cost.toFixed(2)}</span>
                  <span className="position-payout">{payout.toFixed(2)}</span>
                  <span className={`position-pnl ${p.pnl >= 0 ? 'profit' : 'loss'}`}>
                    {p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(2)}
                    <span className="pnl-label"> {isWinner ? 'WON' : 'LOST'}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
