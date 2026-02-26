import { useAuthContext } from '../contexts/AuthContext';

export function WalletConnect() {
  const { account, isAuthenticated, isAuthenticating, connecting, signIn, signOut, error } = useAuthContext();

  if (isAuthenticated && account) {
    const displayAddr = `${account.slice(0, 6)}...${account.slice(-4)}`;
    return (
      <div className="wallet-connected">
        <span className="wallet-address">{displayAddr}</span>
        <button className="btn btn-sm" onClick={signOut}>Disconnect</button>
      </div>
    );
  }

  const loading = isAuthenticating || connecting;

  return (
    <div className="wallet-connect">
      <button
        className="btn btn-primary"
        onClick={() => signIn()}
        disabled={loading}
      >
        {loading ? 'Connecting...' : 'Connect Wallet'}
      </button>
      {!(window as any).ethereum && (
        <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="install-link">
          Install MetaMask
        </a>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
