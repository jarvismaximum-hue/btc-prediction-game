import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Cloud SQL via Unix socket doesn't support SSL
  ssl: false,
  max: 10,
  idleTimeoutMillis: 30000,
});

/** Initialize tables */
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS balances (
      address TEXT PRIMARY KEY,
      amount NUMERIC(20,8) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      address TEXT NOT NULL,
      type TEXT NOT NULL,  -- 'deposit', 'withdraw', 'bet', 'payout', 'fee', 'credit'
      amount NUMERIC(20,8) NOT NULL,
      tx_hash TEXT,
      market_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_tx_address ON transactions(address);
    CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_hash_unique ON transactions(tx_hash) WHERE tx_hash IS NOT NULL;

    CREATE TABLE IF NOT EXISTS settled_markets (
      id TEXT PRIMARY KEY,
      open_price NUMERIC(20,2) NOT NULL,
      close_price NUMERIC(20,2) NOT NULL,
      outcome TEXT NOT NULL,
      start_time BIGINT NOT NULL,
      end_time BIGINT NOT NULL,
      settled_at BIGINT NOT NULL
    );
  `);

  // Add game_type column if it doesn't already exist (safe for re-runs)
  try {
    await pool.query(`ALTER TABLE settled_markets ADD COLUMN IF NOT EXISTS game_type TEXT DEFAULT 'btc-5min'`);
  } catch {
    // Column may already exist on databases that don't support IF NOT EXISTS for ALTER
  }

  console.log('[DB] Tables initialized');
}

/** Get user's in-game balance */
export async function getBalance(address: string): Promise<number> {
  const res = await pool.query('SELECT amount FROM balances WHERE address = $1', [address]);
  return res.rows.length > 0 ? parseFloat(res.rows[0].amount) : 0;
}

/** Credit (add to) user's balance with a transaction log entry */
export async function credit(
  address: string,
  amount: number,
  type: string,
  txHash?: string,
  marketId?: string,
  details?: Record<string, any>,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO balances (address, amount, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (address) DO UPDATE SET amount = balances.amount + $2, updated_at = NOW()`,
      [address, amount],
    );

    await client.query(
      `INSERT INTO transactions (address, type, amount, tx_hash, market_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [address, type, amount, txHash || null, marketId || null, details ? JSON.stringify(details) : null],
    );

    await client.query('COMMIT');

    const res = await client.query('SELECT amount FROM balances WHERE address = $1', [address]);
    return parseFloat(res.rows[0].amount);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Debit (subtract from) user's balance with a transaction log entry */
export async function debit(
  address: string,
  amount: number,
  type: string,
  txHash?: string,
  marketId?: string,
  details?: Record<string, any>,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check balance first
    const check = await client.query('SELECT amount FROM balances WHERE address = $1 FOR UPDATE', [address]);
    const current = check.rows.length > 0 ? parseFloat(check.rows[0].amount) : 0;
    if (current < amount) {
      throw new Error(`Insufficient balance. Have ${current.toFixed(4)}, need ${amount.toFixed(4)}`);
    }

    await client.query(
      'UPDATE balances SET amount = amount - $2, updated_at = NOW() WHERE address = $1',
      [address, amount],
    );

    await client.query(
      `INSERT INTO transactions (address, type, amount, tx_hash, market_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [address, type, -amount, txHash || null, marketId || null, details ? JSON.stringify(details) : null],
    );

    await client.query('COMMIT');

    const res = await client.query('SELECT amount FROM balances WHERE address = $1', [address]);
    return parseFloat(res.rows[0].amount);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Atomically debit multiple amounts in a single transaction (prevents race conditions) */
export async function debitMultiple(
  address: string,
  debits: Array<{ amount: number; type: string; marketId?: string; details?: Record<string, any> }>,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const totalAmount = debits.reduce((sum, d) => sum + d.amount, 0);

    // Check balance with row lock
    const check = await client.query('SELECT amount FROM balances WHERE address = $1 FOR UPDATE', [address]);
    const current = check.rows.length > 0 ? parseFloat(check.rows[0].amount) : 0;
    if (current < totalAmount) {
      throw new Error(`Insufficient balance. Have ${current.toFixed(4)}, need ${totalAmount.toFixed(4)}`);
    }

    // Debit total
    await client.query(
      'UPDATE balances SET amount = amount - $2, updated_at = NOW() WHERE address = $1',
      [address, totalAmount],
    );

    // Log each debit as a separate transaction entry
    for (const d of debits) {
      await client.query(
        `INSERT INTO transactions (address, type, amount, market_id, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [address, d.type, -d.amount, d.marketId || null, d.details ? JSON.stringify(d.details) : null],
      );
    }

    await client.query('COMMIT');

    const res = await client.query('SELECT amount FROM balances WHERE address = $1', [address]);
    return parseFloat(res.rows[0].amount);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Get transaction history for an address */
export async function getTransactions(address: string, limit = 50): Promise<any[]> {
  const res = await pool.query(
    'SELECT * FROM transactions WHERE address = $1 ORDER BY created_at DESC LIMIT $2',
    [address, limit],
  );
  return res.rows;
}

/** Save a settled market */
export async function saveSettledMarket(market: {
  id: string;
  gameType?: string;
  openPrice: number;
  closePrice: number;
  outcome: string;
  startTime: number;
  endTime: number;
  settledAt: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO settled_markets (id, game_type, open_price, close_price, outcome, start_time, end_time, settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [market.id, market.gameType || 'btc-5min', market.openPrice, market.closePrice, market.outcome, market.startTime, market.endTime, market.settledAt],
  );
}

/** Get recent settled markets, optionally filtered by game type */
export async function getRecentSettledMarkets(limit = 5, gameType?: string): Promise<any[]> {
  let query: string;
  let params: any[];
  if (gameType) {
    query = 'SELECT * FROM settled_markets WHERE game_type = $1 ORDER BY settled_at DESC LIMIT $2';
    params = [gameType, limit];
  } else {
    query = 'SELECT * FROM settled_markets ORDER BY settled_at DESC LIMIT $1';
    params = [limit];
  }
  const res = await pool.query(query, params);
  return res.rows.map((r: any) => ({
    id: r.id,
    gameType: r.game_type || 'btc-5min',
    status: 'settled' as const,
    openPrice: parseFloat(r.open_price),
    closePrice: parseFloat(r.close_price),
    outcome: r.outcome,
    startTime: parseInt(r.start_time),
    endTime: parseInt(r.end_time),
    settledAt: parseInt(r.settled_at),
  }));
}

export { pool };
