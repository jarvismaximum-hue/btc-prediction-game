import React from 'react';
import type { Market } from '../hooks/useSocket';

interface Props {
  markets: Market[];
}

export function MarketHistory({ markets }: Props) {
  if (markets.length === 0) {
    return (
      <div className="market-history">
        <h3>Recent Markets</h3>
        <div className="empty-book">No settled markets yet</div>
      </div>
    );
  }

  return (
    <div className="market-history">
      <h3>Recent Markets</h3>
      <div className="history-list">
        {markets.map(m => (
          <div key={m.id} className={`history-item ${m.outcome?.toLowerCase()}`}>
            <div className="history-outcome">
              <span className={`outcome-badge ${m.outcome?.toLowerCase()}`}>
                {m.outcome}
              </span>
            </div>
            <div className="history-prices">
              <span>Open: ${m.openPrice.toFixed(2)}</span>
              <span>Close: ${m.closePrice.toFixed(2)}</span>
            </div>
            <div className="history-diff">
              {m.closePrice >= m.openPrice ? '+' : ''}
              {(m.closePrice - m.openPrice).toFixed(2)}
            </div>
            <div className="history-time">
              {new Date(m.settledAt || m.endTime).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
