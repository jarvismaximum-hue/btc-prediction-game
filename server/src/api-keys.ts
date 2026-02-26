import crypto from 'crypto';
import { Pool } from 'pg';

// Will be initialized with the shared pool
let pool: Pool;

export function initApiKeys(dbPool: Pool) {
  pool = dbPool;
}

export async function createApiKeysTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      address TEXT NOT NULL,
      label TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked BOOLEAN DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_api_keys_address ON api_keys(address);
  `);
}

/** Generate a new API key for an address. Returns the raw key (only shown once). */
export async function generateApiKey(address: string, label?: string): Promise<{ key: string; prefix: string }> {
  const raw = `pp_${crypto.randomBytes(32).toString('hex')}`;
  const prefix = raw.slice(0, 10);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  await pool.query(
    `INSERT INTO api_keys (key_hash, key_prefix, address, label) VALUES ($1, $2, $3, $4)`,
    [hash, prefix, address.toLowerCase(), label || null],
  );

  return { key: raw, prefix };
}

/** Validate an API key and return the associated address */
export async function validateApiKey(key: string): Promise<string | null> {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const res = await pool.query(
    `UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1 AND revoked = FALSE RETURNING address`,
    [hash],
  );
  return res.rows.length > 0 ? res.rows[0].address : null;
}

/** Revoke an API key */
export async function revokeApiKey(address: string, prefix: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE api_keys SET revoked = TRUE WHERE address = $1 AND key_prefix = $2 AND revoked = FALSE`,
    [address.toLowerCase(), prefix],
  );
  return (res.rowCount ?? 0) > 0;
}

/** List API keys for an address (only shows prefix, not full key) */
export async function listApiKeys(address: string): Promise<any[]> {
  const res = await pool.query(
    `SELECT key_prefix, label, created_at, last_used_at, revoked FROM api_keys WHERE address = $1 ORDER BY created_at DESC`,
    [address.toLowerCase()],
  );
  return res.rows;
}
