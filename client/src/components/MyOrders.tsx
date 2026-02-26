import { useState } from 'react';
import { apiFetch } from '../services/api';

interface Order {
  id: string;
  side: 'UP' | 'DOWN';
  price: number;
  shares: number;
  filled: number;
  status: string;
  createdAt: number;
}

interface Props {
  orders: Order[];
  onOrderCancelled: () => void;
}

export function MyOrders({ orders, onOrderCancelled }: Props) {
  const [cancelling, setCancelling] = useState<string | null>(null);

  const openOrders = orders.filter(o => o.status === 'open' || o.status === 'partial');

  if (openOrders.length === 0) return null;

  const handleCancel = async (orderId: string) => {
    setCancelling(orderId);
    try {
      await apiFetch('/api/order/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      onOrderCancelled();
    } catch {}
    setCancelling(null);
  };

  return (
    <div className="my-orders">
      <h3>My Open Orders</h3>
      <div className="orders-list">
        {openOrders.map(o => (
          <div key={o.id} className={`order-row ${o.side.toLowerCase()}`}>
            <span className={`order-side ${o.side.toLowerCase()}`}>{o.side}</span>
            <span className="order-detail">{o.shares} @ {o.price.toFixed(2)}</span>
            <span className="order-fill">{o.filled}/{o.shares}</span>
            <button
              className="btn btn-xs"
              onClick={() => handleCancel(o.id)}
              disabled={cancelling === o.id}
            >
              {cancelling === o.id ? '...' : 'Cancel'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
