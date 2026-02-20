import { useSyncExternalStore } from 'react';

export interface EIP6963ProviderInfo {
  rdns: string;
  uuid: string;
  name: string;
  icon: string;
}

export interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

let providers: EIP6963ProviderDetail[] = [];

const store = {
  value: () => providers,
  subscribe: (callback: () => void) => {
    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent).detail as EIP6963ProviderDetail;
      if (providers.some(p => p.info.uuid === detail.info.uuid)) return;
      providers = [...providers, detail];
      callback();
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  },
};

export function useSyncProviders(): EIP6963ProviderDetail[] {
  return useSyncExternalStore(store.subscribe, store.value, store.value);
}
