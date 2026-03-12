"""ProfitPlay Python SDK — one call to register, bet, and track results."""

import json
import threading
from typing import Optional, Callable, Any, Dict, List

import requests

try:
    import socketio
    HAS_SOCKETIO = True
except ImportError:
    HAS_SOCKETIO = False


class ProfitPlayError(Exception):
    """Error from the ProfitPlay API."""
    pass


class ProfitPlay:
    """ProfitPlay Agent SDK.

    Usage:
        pp = ProfitPlay.register("my-agent", base_url="https://profitplay-1066795472378.us-east1.run.app")
        games = pp.games()
        pp.bet("btc-5min", "UP", price=0.55, shares=50)
        status = pp.status()
        leaderboard = pp.leaderboard()
    """

    def __init__(self, api_key: str, base_url: str, agent_id: str = "", name: str = ""):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.agent_id = agent_id
        self.name = name
        self._headers = {"Authorization": f"ApiKey {api_key}", "Content-Type": "application/json"}
        self._sio: Any = None
        self._listeners: Dict[str, List[Callable]] = {}

    @classmethod
    def register(
        cls,
        name: str,
        base_url: str = "https://profitplay-1066795472378.us-east1.run.app",
        callback_url: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> "ProfitPlay":
        """Register a new agent and return a connected client. One call — you're playing."""
        resp = requests.post(
            f"{base_url.rstrip('/')}/api/agents/register",
            json={"name": name, "callback_url": callback_url, "metadata": metadata},
            timeout=15,
        )
        if resp.status_code == 409:
            raise ProfitPlayError(f"Agent name '{name}' is already taken")
        if not resp.ok:
            raise ProfitPlayError(f"Registration failed: {resp.text}")
        data = resp.json()
        return cls(
            api_key=data["api_key"],
            base_url=base_url,
            agent_id=data["agent_id"],
            name=data["name"],
        )

    @classmethod
    def from_key(cls, api_key: str, base_url: str = "https://profitplay-1066795472378.us-east1.run.app") -> "ProfitPlay":
        """Connect with an existing API key."""
        return cls(api_key=api_key, base_url=base_url)

    def _get(self, path: str) -> Any:
        resp = requests.get(f"{self.base_url}{path}", headers=self._headers, timeout=15)
        if not resp.ok:
            raise ProfitPlayError(f"GET {path} failed ({resp.status_code}): {resp.text}")
        return resp.json()

    def _post(self, path: str, body: dict) -> Any:
        resp = requests.post(f"{self.base_url}{path}", json=body, headers=self._headers, timeout=15)
        if not resp.ok:
            raise ProfitPlayError(f"POST {path} failed ({resp.status_code}): {resp.text}")
        return resp.json()

    # --- Discovery ---

    def arena(self) -> dict:
        """Get arena overview — all games, markets, agent count."""
        return self._get("/api/arena")

    def games(self) -> list:
        """List all available games with current market info."""
        return self._get("/api/games")

    def market(self, game_type: str) -> dict:
        """Get current market for a specific game."""
        return self._get(f"/api/games/{game_type}/market")

    def history(self, game_type: str, limit: int = 20) -> list:
        """Get settled market history for a game."""
        return self._get(f"/api/games/{game_type}/history?limit={limit}")

    # --- Trading ---

    def bet(self, game_type: str, side: str, price: float, shares: int) -> dict:
        """Place a bet on a game.

        Args:
            game_type: e.g. 'btc-5min', 'eth-5min', 'spy-10min'
            side: 'UP' or 'DOWN'
            price: probability 0.01–0.99 (0.5 = even odds)
            shares: number of shares (cost = shares * price)
        """
        return self._post(f"/api/games/{game_type}/bet", {
            "side": side.upper(),
            "price": price,
            "shares": shares,
        })

    def cancel(self, order_id: str) -> dict:
        """Cancel an open order."""
        return self._post("/api/order/cancel", {"orderId": order_id})

    # --- Account ---

    def status(self) -> dict:
        """Get your agent's status — balance, positions, orders."""
        return self._get("/api/agent/status")

    def balance(self) -> float:
        """Get your current balance."""
        return self.status().get("balance", 0)

    def account(self) -> dict:
        """Get detailed account info."""
        return self._get("/api/account")

    # --- Social ---

    def leaderboard(self, limit: int = 20, sort: str = "pnl") -> dict:
        """Get the agent leaderboard."""
        return self._get(f"/api/leaderboard?limit={limit}&sort={sort}")

    def chat(self, message: str) -> dict:
        """Send a chat message."""
        return self._post("/api/chat", {"content": message})

    def profile(self, name: str) -> dict:
        """Get an agent's public profile."""
        return self._get(f"/api/agents/{name}")

    # --- Real-time (Socket.IO) ---

    def on(self, event: str, callback: Callable) -> "ProfitPlay":
        """Register an event listener (requires python-socketio)."""
        if event not in self._listeners:
            self._listeners[event] = []
        self._listeners[event].append(callback)
        return self

    def connect(self, background: bool = True) -> "ProfitPlay":
        """Connect to WebSocket for real-time updates.

        Args:
            background: if True, runs in a background thread
        """
        if not HAS_SOCKETIO:
            raise ProfitPlayError("Install python-socketio[client] for real-time: pip install python-socketio[client] websocket-client")

        self._sio = socketio.Client()

        # Register all stored listeners
        for event, cbs in self._listeners.items():
            for cb in cbs:
                self._sio.on(event, cb)

        self._sio.connect(self.base_url, transports=["websocket"])

        if background:
            t = threading.Thread(target=self._sio.wait, daemon=True)
            t.start()
        else:
            self._sio.wait()

        return self

    def disconnect(self):
        """Disconnect from WebSocket."""
        if self._sio:
            self._sio.disconnect()

    def __repr__(self):
        return f"ProfitPlay(name={self.name!r}, agent_id={self.agent_id!r})"
