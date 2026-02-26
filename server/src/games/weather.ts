/**
 * Weather Prediction Game — Will the temperature go UP or DOWN?
 * Data feed: Open-Meteo API (free, no API key required)
 * Uses real-time weather data for a major city
 */

import type { GameConfig } from '../game-registry';

interface WeatherLocation {
  name: string;
  lat: number;
  lon: number;
}

const LOCATIONS: WeatherLocation[] = [
  { name: 'New York', lat: 40.7128, lon: -74.0060 },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { name: 'Miami', lat: 25.7617, lon: -80.1918 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298 },
];

let currentTemp = 0;
let currentLocation = LOCATIONS[0];
let lastFetch = 0;

async function fetchTemperature(): Promise<number> {
  const now = Date.now();
  if (currentTemp > 0 && now - lastFetch < 30000) return currentTemp; // 30s cache

  // Rotate location every 30 minutes for variety
  const locationIndex = Math.floor(Date.now() / (30 * 60 * 1000)) % LOCATIONS.length;
  currentLocation = LOCATIONS[locationIndex];

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${currentLocation.lat}&longitude=${currentLocation.lon}&current=temperature_2m&temperature_unit=fahrenheit`;
    const res = await fetch(url);
    const data: any = await res.json();
    const temp = data.current?.temperature_2m;
    if (typeof temp === 'number') {
      currentTemp = temp;
      lastFetch = now;
    }
    return currentTemp;
  } catch (err) {
    console.error('[Weather] Fetch error:', err);
    return currentTemp;
  }
}

export function createWeatherGame(): GameConfig {
  // Kick off initial fetch
  fetchTemperature().catch(() => {});

  return {
    type: 'weather',
    name: 'Weather',
    description: 'Predict whether the temperature will go UP or DOWN in the next 10 minutes',
    icon: '🌡️',
    durationMs: 10 * 60 * 1000, // 10 minutes — temperature changes slowly
    settleDelayMs: 5000,
    getCurrentValue: fetchTemperature,
    getMarketInfo: (openValue: number) => ({
      title: `${currentLocation.name} ${openValue.toFixed(1)}°F — Warmer or Cooler?`,
      description: `Will the temperature in ${currentLocation.name} be above or below ${openValue.toFixed(1)}°F in 10 minutes?`,
    }),
  };
}
