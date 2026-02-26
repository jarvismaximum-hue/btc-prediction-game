import { useState, useEffect } from 'react';
import { apiFetch } from '../services/api';

export interface GameInfo {
  type: string;
  name: string;
  description: string;
  icon: string;
  durationMs: number;
  currentMarket: {
    id: string;
    gameType: string;
    status: string;
    title: string;
    openValue: number;
    startTime: number;
    endTime: number;
  } | null;
}

interface Props {
  selectedGame: string;
  onSelectGame: (gameType: string) => void;
}

export function GameSelector({ selectedGame, onSelectGame }: Props) {
  const [games, setGames] = useState<GameInfo[]>([]);

  useEffect(() => {
    const fetchGames = async () => {
      try {
        const res = await apiFetch('/api/games');
        if (res.ok) {
          const data = await res.json();
          setGames(data);
        }
      } catch {}
    };
    fetchGames();
    const interval = setInterval(fetchGames, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="game-selector">
      {games.map(game => {
        const isActive = game.type === selectedGame;
        const market = game.currentMarket;
        const isTrading = market?.status === 'trading';
        const timeLeft = market ? Math.max(0, market.endTime - Date.now()) : 0;
        const mins = Math.floor(timeLeft / 60000);
        const secs = Math.floor((timeLeft % 60000) / 1000);

        return (
          <button
            key={game.type}
            className={`game-tab ${isActive ? 'active' : ''} ${isTrading ? 'trading' : ''}`}
            onClick={() => onSelectGame(game.type)}
          >
            <span className="game-icon">{game.icon}</span>
            <span className="game-name">{game.name}</span>
            {isTrading && (
              <span className="game-timer">{mins}:{secs.toString().padStart(2, '0')}</span>
            )}
            {!isTrading && market && (
              <span className="game-status-dot settling" />
            )}
            {!market && (
              <span className="game-status-dot waiting" />
            )}
          </button>
        );
      })}
    </div>
  );
}
