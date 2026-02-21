const API_BASE = import.meta.env.VITE_API_URL || '';

export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('btc-prediction-token');
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...options?.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export function getApiBase(): string {
  return API_BASE;
}
