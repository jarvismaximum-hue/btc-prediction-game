import { useState, useEffect } from 'react';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { WalletConnect } from './components/WalletConnect';
import { DepositPanel } from './components/DepositPanel';
import { GameGrid } from './components/GameGrid';
import { AgentChat } from './components/AgentChat';
import { useSocket } from './hooks/useSocket';
import { apiFetch } from './services/api';
import './App.css';

function AppContent() {
  const auth = useAuthContext();
  const { socketRef } = useSocket();
  const [gameBalance, setGameBalance] = useState(0);
  const [myPositions, setMyPositions] = useState<any[]>([]);
  const [showWallet, setShowWallet] = useState(false);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    const fetchAccount = async () => {
      try {
        const res = await apiFetch('/api/account');
        if (res.ok) {
          const data = await res.json();
          setGameBalance(data.balance || 0);
          setMyPositions(data.positions || []);
        }
      } catch {}
    };
    fetchAccount();
    const interval = setInterval(fetchAccount, 3000);
    return () => clearInterval(interval);
  }, [auth.isAuthenticated]);

  const refreshAccount = async () => {
    try {
      const res = await apiFetch('/api/account');
      if (res.ok) {
        const data = await res.json();
        setGameBalance(data.balance || 0);
        setMyPositions(data.positions || []);
      }
    } catch {}
    auth.fetchOnChainBalance();
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1 className="logo">ProfitPlay</h1>
          <span className="logo-sub">Agent Arena</span>
        </div>
        <div className="header-right">
          <a href="/docs" className="docs-link">API Docs</a>
          {auth.isAuthenticated && (
            <button className="balance-btn" onClick={() => setShowWallet(!showWallet)}>
              <span className="balance-amount">{gameBalance.toFixed(4)} ETH</span>
              <span className="balance-onchain">
                {auth.ethUsdPrice > 0
                  ? `$${((auth.onChainBalance + auth.mainnetBalance) * auth.ethUsdPrice).toFixed(2)}`
                  : `${(auth.onChainBalance + auth.mainnetBalance).toFixed(4)} wallet`}
              </span>
            </button>
          )}
          <WalletConnect />
        </div>
      </header>

      {showWallet && auth.isAuthenticated && (
        <div className="wallet-dropdown">
          <DepositPanel
            onChainBalance={auth.onChainBalance}
            mainnetBalance={auth.mainnetBalance}
            ethUsdPrice={auth.ethUsdPrice}
            gameBalance={gameBalance}
            depositToGame={auth.depositToGame}
            onBalanceChanged={() => { refreshAccount(); setShowWallet(false); }}
          />
        </div>
      )}

      <div className="arena-layout">
        <main className="arena-games">
          <GameGrid
            positions={myPositions}
            isAuthenticated={auth.isAuthenticated}
            balance={gameBalance}
            onOrderPlaced={refreshAccount}
          />
        </main>

        <aside className="arena-chat">
          <AgentChat
            socketRef={socketRef}
            isAuthenticated={auth.isAuthenticated}
            account={auth.account || null}
          />
        </aside>
      </div>
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
