import { useState, useCallback, useEffect } from 'react';
import { useEthereum } from './useEthereum';
import { apiFetch } from '../services/api';

const TOKEN_KEY = 'btc-prediction-token';

export function useAuth() {
  const eth = useEthereum();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [serverAddress, setServerAddress] = useState<string | null>(() => localStorage.getItem('btc-prediction-address'));
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Auto-reconnect MetaMask on page refresh if we have a stored token.
  // This ensures on-chain balance is fetched immediately.
  useEffect(() => {
    if (token && !eth.ethAddress && !eth.connecting) {
      eth.connect().catch(() => {});
    }
  }, []);

  const signIn = useCallback(async () => {
    const addr = await eth.connect();
    if (!addr) return;

    setIsAuthenticating(true);
    try {
      // Get nonce
      const nonceRes = await apiFetch(`/auth/nonce?address=${encodeURIComponent(addr)}`);
      if (!nonceRes.ok) throw new Error('Failed to get nonce');
      const { message } = await nonceRes.json();

      // Sign with MetaMask
      const sig = await eth.signMessage(message);
      if (!sig) return;

      // Login
      const loginRes = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, message, signature: sig }),
      });
      if (!loginRes.ok) {
        const err = await loginRes.json();
        throw new Error(err.error || 'Login failed');
      }
      const { accessToken, address: srvAddress } = await loginRes.json();
      localStorage.setItem(TOKEN_KEY, accessToken);
      localStorage.setItem('btc-prediction-address', srvAddress);
      setToken(accessToken);
      setServerAddress(srvAddress);
    } catch (e) {
      console.error('Auth error:', e);
    } finally {
      setIsAuthenticating(false);
    }
  }, [eth]);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('btc-prediction-address');
    setToken(null);
    setServerAddress(null);
    eth.disconnect();
  }, [eth]);

  return {
    account: serverAddress || eth.ethAddress,
    ethAddress: eth.ethAddress,
    onChainBalance: eth.onChainBalance,
    mainnetBalance: eth.mainnetBalance,
    ethUsdPrice: eth.ethUsdPrice,
    token,
    isAuthenticated: !!token,
    isAuthenticating,
    connecting: eth.connecting,
    error: eth.error,
    signIn,
    signOut,
    depositToGame: eth.depositToGame,
    fetchOnChainBalance: eth.fetchBalance,
  };
}
