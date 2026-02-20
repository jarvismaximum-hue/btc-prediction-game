import { useState, useCallback } from 'react';
import { useSyncProviders, type EIP6963ProviderDetail, type EIP1193Provider } from './useSyncProviders';

function toHexString(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function useMetaMask() {
  const providers = useSyncProviders();
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (providerDetail: EIP6963ProviderDetail) => {
    setError(null);
    try {
      const accounts = await providerDetail.provider.request({
        method: 'eth_requestAccounts',
        params: [],
      }) as string[];
      if (accounts?.[0]) {
        setAccount(accounts[0]);
        setProvider(providerDetail.provider);
        return accounts[0];
      }
    } catch (e) {
      setError((e as Error).message);
    }
    return null;
  }, []);

  const connectLegacy = useCallback(async () => {
    setError(null);
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setError('MetaMask not installed');
      return null;
    }
    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      if (accounts?.[0]) {
        setAccount(accounts[0]);
        setProvider(ethereum);
        return accounts[0];
      }
    } catch (e) {
      setError((e as Error).message);
    }
    return null;
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setProvider(null);
  }, []);

  const signMessage = useCallback(async (message: string): Promise<string | null> => {
    if (!provider || !account) return null;
    try {
      const sig = await provider.request({
        method: 'personal_sign',
        params: [toHexString(message), account],
      }) as string;
      return sig;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [provider, account]);

  return { providers, account, provider, error, connect, connectLegacy, disconnect, signMessage };
}
