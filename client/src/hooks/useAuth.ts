import { useState, useCallback } from 'react';
import { useMetaMask } from './useMetaMask';
import type { EIP6963ProviderDetail } from './useSyncProviders';
import { apiFetch } from '../services/api';

const TOKEN_KEY = 'btc-prediction-token';

export function useAuth() {
  const metamask = useMetaMask();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const signIn = useCallback(async (providerDetail?: EIP6963ProviderDetail) => {
    let addr: string | null;
    if (providerDetail) {
      addr = await metamask.connect(providerDetail);
    } else {
      addr = await metamask.connectLegacy();
    }
    if (!addr) return;

    setIsAuthenticating(true);
    try {
      // Get nonce
      const nonceRes = await apiFetch(`/auth/nonce?address=${encodeURIComponent(addr)}`);
      if (!nonceRes.ok) throw new Error('Failed to get nonce');
      const { message } = await nonceRes.json();

      // Sign
      const sig = await metamask.signMessage(message);
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
      const { accessToken } = await loginRes.json();
      localStorage.setItem(TOKEN_KEY, accessToken);
      setToken(accessToken);
    } catch (e) {
      console.error('Auth error:', e);
    } finally {
      setIsAuthenticating(false);
    }
  }, [metamask]);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    metamask.disconnect();
  }, [metamask]);

  return {
    ...metamask,
    token,
    isAuthenticated: !!token,
    isAuthenticating,
    signIn,
    signOut,
  };
}
