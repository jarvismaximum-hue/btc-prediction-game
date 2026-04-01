import { useState, useEffect } from 'react';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { WalletConnect } from './components/WalletConnect';
import { DepositPanel } from './components/DepositPanel';
import { GameGrid } from './components/GameGrid';
import { AuctionView } from './components/AuctionView';
import { AgentChat } from './components/AgentChat';
import { useSocket } from './hooks/useSocket';
import { apiFetch } from './services/api';
import './App.css';

type TabId = 'predictions' | 'auction';

const TAB_LABELS: Record<TabId, { label: string; icon: string }> = {
  predictions: { label: 'Predictions', icon: '📈' },
  auction: { label: 'Dutch Dilemma', icon: '🔥' },
};

function AppContent() {
  const auth = useAuthContext();
  const { socketRef, connected } = useSocket();
  const [gameBalance, setGameBalance] = useState(0);
  const [myPositions, setMyPositions] = useState<any[]>([]);
  const [showWallet, setShowWallet] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('predictions');

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
        <div className="header-center">
          <nav className="tab-nav">
            {(['predictions', 'auction'] as TabId[]).map(tab => (
              <button
                key={tab}
                className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                <span className="tab-icon">{TAB_LABELS[tab].icon}</span>
                {TAB_LABELS[tab].label}
              </button>
            ))}
          </nav>
        </div>
        <div className="header-right">
          <a href="/docs" className="docs-link">API Docs</a>
          {auth.isAuthenticated && (
            <button className="balance-btn" onClick={() => setShowWallet(!showWallet)}>
              <span className="balance-amount">{gameBalance.toFixed(2)} GALA</span>
              <span className="balance-onchain">
                {auth.ethUsdPrice > 0
                  ? `$${(auth.onChainBalance * auth.ethUsdPrice).toFixed(2)}`
                  : `${auth.onChainBalance.toFixed(2)} wallet`}
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
          {activeTab === 'predictions' ? (
            <GameGrid
              positions={myPositions}
              isAuthenticated={auth.isAuthenticated}
              balance={gameBalance}
              onOrderPlaced={refreshAccount}
            />
          ) : (
            <AuctionView
              isAuthenticated={auth.isAuthenticated}
              balance={gameBalance}
              onBalanceChanged={refreshAccount}
              socketRef={socketRef}
            />
          )}
        </main>

        <aside className="arena-chat">
          <AgentChat
            socketRef={socketRef}
            isAuthenticated={auth.isAuthenticated}
            account={auth.account || null}
            connected={connected}
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
