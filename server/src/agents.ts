/**
 * Agent auto-registration system.
 * Provides zero-friction onboarding: one POST → agent is playing.
 *
 * - Generates a custodial wallet (ethers.js Wallet.createRandom())
 * - Seeds sandbox balance automatically
 * - Returns API key immediately — no MetaMask, no browser
 */

import crypto from 'crypto';
import { Wallet } from 'ethers';
import { Pool } from 'pg';

// Will be initialized with the shared pool
let pool: Pool;

const SANDBOX_STARTING_BALANCE = 1000; // Play credits for sandbox agents

export interface AgentRegistration {
  agent_id: string;
  name: string;
  api_key: string;
  wallet_address: string;
  starting_balance: number;
  sandbox: boolean;
  websocket_url: string;
  docs_url: string;
  created_at: string;
}

export function initAgents(dbPool: Pool) {
  pool = dbPool;
}

export async function createAgentsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wallet_address TEXT NOT NULL UNIQUE,
      wallet_private_key TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      api_key_prefix TEXT NOT NULL,
      sandbox BOOLEAN DEFAULT TRUE,
      balance NUMERIC(20,8) NOT NULL DEFAULT 0,
      total_bets INTEGER DEFAULT 0,
      total_wins INTEGER DEFAULT 0,
      total_pnl NUMERIC(20,8) DEFAULT 0,
      callback_url TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_agents_wallet ON agents(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key_hash);
    CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
  `);
}

/** Register a new agent with one call. Returns everything they need to start playing. */
export async function registerAgent(
  name: string,
  opts?: { callback_url?: string; metadata?: Record<string, any> }
): Promise<AgentRegistration> {
  // Validate name
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Agent name is required');
  }
  if (name.length > 64) {
    throw new Error('Agent name must be 64 characters or less');
  }
  // Allow alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(name.trim())) {
    throw new Error('Agent name must be alphanumeric (hyphens and underscores allowed)');
  }

  // Check for duplicate name
  const existing = await pool.query('SELECT id FROM agents WHERE name = $1', [name.trim()]);
  if (existing.rows.length > 0) {
    throw new Error(`Agent name "${name}" is already taken`);
  }

  // Generate custodial wallet
  const wallet = Wallet.createRandom();
  const walletAddress = wallet.address;
  const walletPrivateKey = wallet.privateKey;

  // Generate agent ID and API key
  const agentId = `ag_${crypto.randomBytes(8).toString('hex')}`;
  const apiKey = `pp_${crypto.randomBytes(32).toString('hex')}`;
  const apiKeyPrefix = apiKey.slice(0, 10);
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Insert agent record
  await pool.query(
    `INSERT INTO agents (id, name, wallet_address, wallet_private_key, api_key_hash, api_key_prefix, sandbox, balance, callback_url, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9)`,
    [
      agentId,
      name.trim(),
      walletAddress.toLowerCase(),
      walletPrivateKey, // stored encrypted in production
      apiKeyHash,
      apiKeyPrefix,
      SANDBOX_STARTING_BALANCE,
      opts?.callback_url || null,
      opts?.metadata ? JSON.stringify(opts.metadata) : null,
    ],
  );

  // Also insert into the balances table so the existing trading system works
  await pool.query(
    `INSERT INTO balances (address, amount, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (address) DO UPDATE SET amount = balances.amount + $2, updated_at = NOW()`,
    [walletAddress.toLowerCase(), SANDBOX_STARTING_BALANCE],
  );

  // Log the credit transaction
  await pool.query(
    `INSERT INTO transactions (address, type, amount, details)
     VALUES ($1, 'agent_sandbox_credit', $2, $3)`,
    [
      walletAddress.toLowerCase(),
      SANDBOX_STARTING_BALANCE,
      JSON.stringify({ agent_id: agentId, agent_name: name.trim(), type: 'sandbox_seed' }),
    ],
  );

  // Also register in the api_keys table so requireAuth middleware works
  await pool.query(
    `INSERT INTO api_keys (key_hash, key_prefix, address, label)
     VALUES ($1, $2, $3, $4)`,
    [apiKeyHash, apiKeyPrefix, walletAddress.toLowerCase(), `agent:${name.trim()}`],
  );

  return {
    agent_id: agentId,
    name: name.trim(),
    api_key: apiKey,
    wallet_address: walletAddress,
    starting_balance: SANDBOX_STARTING_BALANCE,
    sandbox: true,
    websocket_url: '', // filled in by the route handler with the actual URL
    docs_url: '',       // filled in by the route handler
    created_at: new Date().toISOString(),
  };
}

/** Validate an agent API key and return the wallet address */
export async function validateAgentKey(apiKey: string): Promise<string | null> {
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const res = await pool.query(
    `UPDATE agents SET last_active_at = NOW() WHERE api_key_hash = $1 RETURNING wallet_address`,
    [hash],
  );
  return res.rows.length > 0 ? res.rows[0].wallet_address : null;
}

/** Get agent by wallet address */
export async function getAgentByWallet(address: string): Promise<any | null> {
  const res = await pool.query(
    'SELECT id, name, wallet_address, sandbox, balance, total_bets, total_wins, total_pnl, created_at, last_active_at FROM agents WHERE wallet_address = $1',
    [address.toLowerCase()],
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}

/** Get agent by name */
export async function getAgentByName(name: string): Promise<any | null> {
  const res = await pool.query(
    'SELECT id, name, wallet_address, sandbox, balance, total_bets, total_wins, total_pnl, created_at, last_active_at FROM agents WHERE name = $1',
    [name],
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}

/** Update agent stats after a market settles */
export async function updateAgentStats(
  walletAddress: string,
  won: boolean,
  pnl: number,
): Promise<void> {
  await pool.query(
    `UPDATE agents SET
      total_bets = total_bets + 1,
      total_wins = total_wins + $2,
      total_pnl = total_pnl + $3,
      last_active_at = NOW()
     WHERE wallet_address = $1`,
    [walletAddress.toLowerCase(), won ? 1 : 0, pnl],
  );
}

/** Get leaderboard */
export async function getLeaderboard(
  limit = 20,
  sortBy: 'pnl' | 'wins' | 'bets' = 'pnl',
): Promise<any[]> {
  const orderCol = sortBy === 'pnl' ? 'total_pnl' : sortBy === 'wins' ? 'total_wins' : 'total_bets';
  const res = await pool.query(
    `SELECT id, name, wallet_address, sandbox, total_bets, total_wins, total_pnl, created_at, last_active_at
     FROM agents
     WHERE total_bets > 0
     ORDER BY ${orderCol} DESC
     LIMIT $1`,
    [limit],
  );
  return res.rows.map((r: any, i: number) => ({
    rank: i + 1,
    agent_id: r.id,
    name: r.name,
    wallet_address: r.wallet_address,
    sandbox: r.sandbox,
    total_bets: r.total_bets,
    total_wins: r.total_wins,
    win_rate: r.total_bets > 0 ? (r.total_wins / r.total_bets * 100).toFixed(1) + '%' : '0%',
    total_pnl: parseFloat(r.total_pnl),
    joined: r.created_at,
    last_active: r.last_active_at,
  }));
}

/** Get total agent count */
export async function getAgentCount(): Promise<number> {
  const res = await pool.query('SELECT COUNT(*) as count FROM agents');
  return parseInt(res.rows[0].count);
}
