import { useState, useCallback, useEffect } from 'react';
import { useGalaChain } from './useGalaChain';
import { apiFetch } from '../services/api';

const TOKEN_KEY = 'btc-prediction-token';

export function useAuth() {
  const gala = useGalaChain();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [serverAddress, setServerAddress] = useState<string | null>(() => localStorage.getItem('btc-prediction-address'));
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Auto-reconnect wallet on page refresh if we have a stored token.
  useEffect(() => {
    if (token && !gala.ethAddress && !gala.connecting) {
      gala.connect().catch(() => {});
    }
  }, []);

  const signIn = useCallback(async () => {
    const addr = await gala.connect();
    if (!addr) return;

    setIsAuthenticating(true);
    try {
      // Get nonce (using 0x address)
      const nonceRes = await apiFetch(`/auth/nonce?address=${encodeURIComponent(addr)}`);
      if (!nonceRes.ok) throw new Error('Failed to get nonce');
      const { message } = await nonceRes.json();

      // Sign with MetaMask
      const sig = await gala.signMessage(message);
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
  }, [gala]);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('btc-prediction-address');
    setToken(null);
    setServerAddress(null);
    gala.disconnect();
  }, [gala]);

  return {
    account: serverAddress || gala.ethAddress,
    ethAddress: gala.ethAddress,
    onChainBalance: gala.onChainBalance,
    mainnetBalance: 0, // Not applicable for GalaChain
    ethUsdPrice: gala.galaUsdPrice,
    token,
    isAuthenticated: !!token,
    isAuthenticating,
    connecting: gala.connecting,
    error: gala.error,
    signIn,
    signOut,
    depositToGame: gala.depositToGame,
    fetchOnChainBalance: gala.fetchBalance,
  };
}
