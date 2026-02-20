import { useAuthContext } from '../contexts/AuthContext';

export function WalletConnect() {
  const { account, providers, isAuthenticated, isAuthenticating, signIn, signOut, error } = useAuthContext();

  if (isAuthenticated && account) {
    return (
      <div className="wallet-connected">
        <span className="wallet-address">
          {account.slice(0, 6)}...{account.slice(-4)}
        </span>
        <button className="btn btn-sm" onClick={signOut}>Disconnect</button>
      </div>
    );
  }

  return (
    <div className="wallet-connect">
      {providers.length > 0 ? (
        providers.map(p => (
          <button
            key={p.info.uuid}
            className="btn btn-primary"
            onClick={() => signIn(p)}
            disabled={isAuthenticating}
          >
            <img src={p.info.icon} alt="" width={20} height={20} />
            {isAuthenticating ? 'Signing in...' : `Connect ${p.info.name}`}
          </button>
        ))
      ) : (
        <>
          <button
            className="btn btn-primary"
            onClick={() => signIn()}
            disabled={isAuthenticating}
          >
            {isAuthenticating ? 'Signing in...' : 'Connect MetaMask'}
          </button>
          {!(window as any).ethereum && (
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="install-link">
              Install MetaMask
            </a>
          )}
        </>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
