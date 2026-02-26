import { useState, useCallback, useEffect } from 'react';
import { BrowserProvider, formatEther, parseEther, JsonRpcProvider } from 'ethers';

const PLATFORM_WALLET = '0x522769cB379cb7DF64Da1FEe299A207107de97c1';
const BASE_CHAIN_ID = '0x2105'; // Base mainnet (chain ID 8453)
const ETH_MAINNET_RPCS = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum-rpc.publicnode.com',
];

async function ensureBase(ethereum: any): Promise<boolean> {
  const chainId = await ethereum.request({ method: 'eth_chainId' });
  if (chainId !== BASE_CHAIN_ID) {
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_CHAIN_ID }],
      });
      return true;
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: BASE_CHAIN_ID,
              chainName: 'Base',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: ['https://basescan.org'],
            }],
          });
          return true;
        } catch { return false; }
      }
      return false;
    }
  }
  return true;
}

export function useEthereum() {
  const [ethAddress, setEthAddress] = useState<string | null>(null);
  const [onChainBalance, setOnChainBalance] = useState<number>(0);
  const [mainnetBalance, setMainnetBalance] = useState<number>(0);
  const [ethUsdPrice, setEthUsdPrice] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const connect = useCallback(async (): Promise<string | null> => {
    setError(null);
    setConnecting(true);
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) { setError('MetaMask not installed'); return null; }
      const onBase = await ensureBase(ethereum);
      if (!onBase) { setError('Please switch to Base network'); return null; }
      const provider = new BrowserProvider(ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const addr = accounts[0] as string;
      setEthAddress(addr);
      ethereum.on('accountsChanged', (accts: string[]) => {
        if (accts.length > 0) setEthAddress(accts[0]);
        else { setEthAddress(null); setOnChainBalance(0); }
      });
      ethereum.on('chainChanged', () => window.location.reload());
      return addr;
    } catch (e: any) {
      setError(e.message || 'Failed to connect wallet');
      return null;
    } finally { setConnecting(false); }
  }, []);

  const disconnect = useCallback(() => {
    setEthAddress(null);
    setOnChainBalance(0);
  }, []);

  const fetchBalance = useCallback(async (): Promise<number> => {
    if (!ethAddress) return 0;
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) return 0;
      const provider = new BrowserProvider(ethereum);
      const bal = await provider.getBalance(ethAddress);
      const ethBal = parseFloat(formatEther(bal));
      setOnChainBalance(ethBal);
      setError(null);

      // Also fetch mainnet balance (try multiple RPCs)
      let mainnetFetched = false;
      for (const rpc of ETH_MAINNET_RPCS) {
        try {
          const provider = new JsonRpcProvider(rpc);
          const mainnetBal = await provider.getBalance(ethAddress);
          setMainnetBalance(parseFloat(formatEther(mainnetBal)));
          mainnetFetched = true;
          break;
        } catch (e) {
          console.warn(`[ETH] Mainnet RPC ${rpc} failed:`, e);
        }
      }
      if (!mainnetFetched) console.error('[ETH] All mainnet RPCs failed');

      return ethBal;
    } catch (e: any) {
      console.error('[ETH] Balance fetch error:', e);
      return 0;
    }
  }, [ethAddress]);

  // Fetch ETH/USD price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=ETH');
        const data = await res.json();
        const usd = parseFloat(data.data.rates.USD);
        if (usd > 0) setEthUsdPrice(usd);
      } catch (e) {
        console.error('[ETH] Price fetch error:', e);
      }
    };
    fetchPrice();
    const interval = setInterval(fetchPrice, 60000); // every 60s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!ethAddress) return;
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [ethAddress, fetchBalance]);

  /** Send native ETH from user to platform wallet */
  const depositToGame = useCallback(async (amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!ethAddress) return { success: false, error: 'Wallet not connected' };
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) return { success: false, error: 'MetaMask not found' };
      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const tx = await signer.sendTransaction({
        to: PLATFORM_WALLET,
        value: parseEther(amount.toString()),
      });
      const receipt = await tx.wait(1);
      await fetchBalance();
      return { success: true, txHash: receipt?.hash || tx.hash };
    } catch (e: any) {
      console.error('[ETH] Deposit error:', e);
      return { success: false, error: e.message || 'Transfer failed' };
    }
  }, [ethAddress, fetchBalance]);

  const signMessage = useCallback(async (message: string): Promise<string | null> => {
    if (!ethAddress) return null;
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) return null;
      const encoder = new TextEncoder();
      const bytes = encoder.encode(message);
      const hex = '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const sig = await ethereum.request({ method: 'personal_sign', params: [hex, ethAddress] }) as string;
      return sig;
    } catch (e: any) { setError(e.message); return null; }
  }, [ethAddress]);

  return { ethAddress, onChainBalance, mainnetBalance, ethUsdPrice, error, connecting, connect, disconnect, fetchBalance, depositToGame, signMessage };
}
