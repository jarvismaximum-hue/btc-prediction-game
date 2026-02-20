import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { verifyMessage, getAddress } from 'ethers';

const JWT_SECRET = process.env.JWT_SECRET || 'btc-prediction-game-dev-secret-change-in-production';
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Nonce store (use Redis in production)
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

// Cleanup expired nonces periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of nonceStore.entries()) {
    if (val.expiresAt < now) nonceStore.delete(key);
  }
}, 60_000);

function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

function buildAuthMessage(address: string, nonce: string): string {
  return [
    'Sign in to BTC Prediction Game',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
    '',
    'Sign this message to authenticate.',
  ].join('\n');
}

function normalizeAddress(addr: string): string {
  const raw = addr.startsWith('eth|') ? `0x${addr.slice(4)}` : addr;
  return getAddress(raw); // checksum
}

export function createAuthRouter(): Router {
  const router = Router();

  // GET /auth/nonce?address=0x...
  router.get('/auth/nonce', (req: Request, res: Response) => {
    const address = req.query.address as string;
    if (!address) {
      return res.status(400).json({ error: 'Missing address' });
    }

    let normalized: string;
    try {
      normalized = normalizeAddress(address);
    } catch {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    const nonce = generateNonce();
    const message = buildAuthMessage(normalized, nonce);
    nonceStore.set(normalized.toLowerCase(), { nonce, expiresAt: Date.now() + NONCE_TTL_MS });

    return res.json({ nonce, message });
  });

  // POST /auth/login { address, message, signature }
  router.post('/auth/login', (req: Request, res: Response) => {
    const { address, message, signature } = req.body;
    if (!address || !message || !signature) {
      return res.status(400).json({ error: 'address, message, and signature required' });
    }

    let normalized: string;
    try {
      normalized = normalizeAddress(address);
    } catch {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    // Validate signature format
    if (!signature.startsWith('0x') || signature.length !== 132) {
      return res.status(400).json({ error: 'Invalid signature format' });
    }

    // Check nonce
    const key = normalized.toLowerCase();
    const stored = nonceStore.get(key);
    if (!stored || stored.expiresAt < Date.now()) {
      return res.status(401).json({ error: 'Nonce expired or not found' });
    }
    if (!message.includes(stored.nonce)) {
      return res.status(401).json({ error: 'Invalid nonce in message' });
    }

    // Verify signature
    try {
      const recovered = verifyMessage(message, signature);
      if (recovered.toLowerCase() !== normalized.toLowerCase()) {
        return res.status(401).json({ error: 'Signature verification failed' });
      }
    } catch {
      return res.status(401).json({ error: 'Signature verification failed' });
    }

    // Consume nonce
    nonceStore.delete(key);

    // Issue JWT
    const token = jwt.sign(
      { sub: normalized, address: normalized },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    return res.json({ accessToken: token, address: normalized });
  });

  return router;
}

/** JWT auth middleware */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
