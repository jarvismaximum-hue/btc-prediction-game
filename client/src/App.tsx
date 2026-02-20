import { useState, useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { PriceChart } from './components/PriceChart';
import { BettingPanel } from './components/BettingPanel';
import { OrderBookView } from './components/OrderBookView';
import { WalletConnect } from './components/WalletConnect';
import { MarketHistory } from './components/MarketHistory';
import { apiFetch } from './services/api';
import './App.css';

function AppContent() {
  const { socketRef, connected, currentPrice, priceHistory, candles, liveCandle, market, orderbook, settledMarkets } = useSocket();
  const auth = useAuthContext();
  const [balance, setBalance] = useState(0);
  const [crediting, setCrediting] = useState(false);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    const fetchBalance = async () => {
      try {
        const res = await apiFetch('/api/account');
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balance || 0);
        }
      } catch {}
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 5000);
    return () => clearInterval(interval);
  }, [auth.isAuthenticated]);

  const handleCreditBalance = async () => {
    setCrediting(true);
    try {
      const res = await apiFetch('/api/dev/credit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1000 }),
      });
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance || 0);
      }
    } catch {} finally {
      setCrediting(false);
    }
  };

  const refreshBalance = async () => {
    try {
      const res = await apiFetch('/api/account');
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance || 0);
      }
    } catch {}
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1 className="logo">BTC Predict</h1>
          <span className={`connection-status ${connected ? 'online' : 'offline'}`}>
            {connected ? 'LIVE' : 'CONNECTING...'}
          </span>
        </div>
        <div className="header-right">
          {auth.isAuthenticated && (
            <div className="balance-header">
              <span className="balance-amount">{balance.toFixed(2)} GALA</span>
              <button className="btn btn-xs" onClick={handleCreditBalance} disabled={crediting}>
                {crediting ? '...' : '+1000 (Dev)'}
              </button>
            </div>
          )}
          <WalletConnect />
        </div>
      </header>

      <main className="main-layout">
        <div className="left-panel">
          <PriceChart candles={candles} liveCandle={liveCandle} currentPrice={currentPrice} market={market} socketRef={socketRef} />
          <MarketHistory markets={settledMarkets} />
        </div>
        <div className="right-panel">
          <BettingPanel market={market} isAuthenticated={auth.isAuthenticated} balance={balance} onOrderPlaced={refreshBalance} />
          <OrderBookView orderbook={orderbook} />
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
