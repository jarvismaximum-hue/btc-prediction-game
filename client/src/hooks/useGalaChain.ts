import { useState, useCallback, useRef, useEffect } from 'react';
import { BrowserConnectClient, TokenApi } from '@gala-chain/connect';
import BigNumber from 'bignumber.js';

const TOKEN_API_URL = 'https://gateway-mainnet.galachain.com/api/asset/token-contract';

const GALA_TOKEN = {
  collection: 'GALA',
  category: 'Unit',
  type: 'none',
  additionalKey: 'none',
  instance: new BigNumber(0),
};

export function useGalaChain() {
  const clientRef = useRef<BrowserConnectClient | null>(null);
  const tokenApiRef = useRef<TokenApi | null>(null);
  const [galaAddress, setGalaAddress] = useState<string | null>(null);
  const [ethAddress, setEthAddress] = useState<string | null>(null);
  const [onChainBalance, setOnChainBalance] = useState<number>(0);
  const [galaUsdPrice, setGalaUsdPrice] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async (): Promise<string | null> => {
    setError(null);
    setConnecting(true);
    try {
      const client = new BrowserConnectClient();
      const addr = await client.connect();
      clientRef.current = client;

      // addr is the GalaChain address (eth|...)
      setGalaAddress(addr);
      // Derive the 0x address for auth signing
      const ethAddr = addr.startsWith('eth|') ? `0x${addr.slice(4)}` : addr;
      setEthAddress(ethAddr);

      // Set up TokenApi
      const api = new TokenApi(TOKEN_API_URL, client);
      tokenApiRef.current = api;

      // Listen for account changes
      client.on('accountChanged', (account: string[] | string | null) => {
        if (Array.isArray(account) && account.length > 0) {
          setGalaAddress(account[0]);
          const newEth = account[0].startsWith('eth|') ? `0x${account[0].slice(4)}` : account[0];
          setEthAddress(newEth);
        } else {
          setGalaAddress(null);
          setEthAddress(null);
        }
      });

      return ethAddr;
    } catch (e: any) {
      setError(e.message || 'Failed to connect wallet');
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current = null;
    tokenApiRef.current = null;
    setGalaAddress(null);
    setEthAddress(null);
    setOnChainBalance(0);
  }, []);

  const fetchBalance = useCallback(async (): Promise<number> => {
    if (!tokenApiRef.current || !galaAddress) return 0;
    try {
      const result = await tokenApiRef.current.FetchBalances({
        owner: galaAddress as any,
      });
      const data = (result as any)?.Data || [];
      const total = data.reduce((sum: number, b: any) => {
        return sum + parseFloat(b.quantity || '0');
      }, 0);
      setOnChainBalance(total);
      return total;
    } catch (e) {
      console.error('[GalaChain] FetchBalances error:', e);
      return 0;
    }
  }, [galaAddress]);

  // Poll on-chain balance
  useEffect(() => {
    if (!galaAddress || !tokenApiRef.current) return;
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [galaAddress, fetchBalance]);

  // Fetch GALA/USD price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=gala&vs_currencies=usd');
        const data = await res.json();
        const usd = data?.gala?.usd;
        if (usd > 0) setGalaUsdPrice(usd);
      } catch (e) {
        console.error('[GalaChain] Price fetch error:', e);
      }
    };
    fetchPrice();
    const interval = setInterval(fetchPrice, 60000);
    return () => clearInterval(interval);
  }, []);

  /** Transfer GALA from user to platform wallet (deposit for gameplay) */
  const depositToGame = useCallback(async (amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!tokenApiRef.current || !galaAddress) {
      return { success: false, error: 'Wallet not connected' };
    }

    // Fetch platform wallet from server
    let platformWallet: string;
    try {
      const res = await fetch('/api/platform');
      const data = await res.json();
      // Convert 0x to eth| format for GalaChain
      const addr = data.platformWallet;
      platformWallet = addr.startsWith('0x') ? `eth|${addr.slice(2)}` : addr;
    } catch {
      return { success: false, error: 'Failed to fetch platform wallet' };
    }

    try {
      const uniqueKey = `profitplay-deposit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await tokenApiRef.current.TransferToken({
        from: galaAddress as any,
        to: platformWallet as any,
        tokenInstance: GALA_TOKEN,
        quantity: new BigNumber(amount),
        uniqueKey,
      });
      // Refresh balance after deposit
      await fetchBalance();
      return { success: true, txHash: uniqueKey };
    } catch (e: any) {
      console.error('[GalaChain] TransferToken error:', e);
      return { success: false, error: e.message || 'Transfer failed' };
    }
  }, [galaAddress, fetchBalance]);

  /** Sign a message using MetaMask (for auth) */
  const signMessage = useCallback(async (message: string): Promise<string | null> => {
    if (!ethAddress) return null;
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) return null;
      const encoder = new TextEncoder();
      const bytes = encoder.encode(message);
      const hex = '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const sig = await ethereum.request({
        method: 'personal_sign',
        params: [hex, ethAddress],
      }) as string;
      return sig;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [ethAddress]);

  return {
    ethAddress,
    galaAddress,
    onChainBalance,
    galaUsdPrice,
    error,
    connecting,
    connect,
    disconnect,
    fetchBalance,
    depositToGame,
    signMessage,
  };
}
