import React from 'react';
import type { OrderBookSnapshot } from '../hooks/useSocket';

interface Props {
  orderbook: OrderBookSnapshot;
}

export function OrderBookView({ orderbook }: Props) {
  const maxShares = Math.max(
    ...orderbook.bids.map(b => b.shares),
    ...orderbook.asks.map(a => a.shares),
    1,
  );

  return (
    <div className="orderbook">
      <h3>Order Book</h3>
      <div className="orderbook-header">
        <span>Price</span>
        <span>Shares</span>
        <span>Orders</span>
      </div>

      <div className="orderbook-asks">
        {orderbook.asks.length === 0 ? (
          <div className="empty-book">No asks</div>
        ) : (
          [...orderbook.asks].reverse().map((level, i) => (
            <div key={i} className="orderbook-row ask">
              <div
                className="depth-bar ask-bar"
                style={{ width: `${(level.shares / maxShares) * 100}%` }}
              />
              <span className="price">{level.price.toFixed(2)}</span>
              <span className="shares">{level.shares.toFixed(1)}</span>
              <span className="count">{level.orderCount}</span>
            </div>
          ))
        )}
      </div>

      <div className="orderbook-spread">
        {orderbook.bids.length > 0 && orderbook.asks.length > 0 && (
          <span>Spread: {(orderbook.asks[0].price - orderbook.bids[0].price).toFixed(2)}</span>
        )}
      </div>

      <div className="orderbook-bids">
        {orderbook.bids.length === 0 ? (
          <div className="empty-book">No bids</div>
        ) : (
          orderbook.bids.map((level, i) => (
            <div key={i} className="orderbook-row bid">
              <div
                className="depth-bar bid-bar"
                style={{ width: `${(level.shares / maxShares) * 100}%` }}
              />
              <span className="price">{level.price.toFixed(2)}</span>
              <span className="shares">{level.shares.toFixed(1)}</span>
              <span className="count">{level.orderCount}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
