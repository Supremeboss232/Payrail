import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';

export interface ApiKey {
  id: string;
  key_hash: string;
  prefix: string;
  name: string;
  status: 'active' | 'revoked';
  created_at: string;
}

/**
 * Hashes a raw API key using SHA-256.
 */
function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generates a new live API key.
 * Returns both the raw key (to show the user ONCE) and the key metadata.
 */
export async function generateApiKey(name: string): Promise<{ rawKey: string; key: ApiKey }> {
  const rawKeyBytes = crypto.randomBytes(24).toString('hex'); // 48 chars
  const prefix = 'sk_live_';
  const rawKey = `${prefix}${rawKeyBytes}`;
  const keyHash = hashKey(rawKey);
  const id = `key_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const createdAt = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO api_keys (id, key_hash, prefix, name, status, created_at)
          VALUES (?, ?, ?, ?, 'active', ?)`,
    args: [id, keyHash, prefix, name, createdAt],
  });

  const key: ApiKey = {
    id,
    key_hash: keyHash,
    prefix,
    name,
    status: 'active',
    created_at: createdAt,
  };

  return { rawKey, key };
}

/**
 * Revokes an existing API key.
 */
export async function revokeApiKey(id: string): Promise<void> {
  await db.execute({
    sql: `UPDATE api_keys SET status = 'revoked' WHERE id = ?`,
    args: [id],
  });
}

/**
 * Retrieves all registered API keys (without hashes or secret contents, just metadata).
 */
export async function getApiKeys(): Promise<Omit<ApiKey, 'key_hash'>[]> {
  const result = await db.execute(`
    SELECT id, prefix, name, status, created_at
    FROM api_keys
    ORDER BY created_at DESC
  `);
  return result.rows as unknown as Omit<ApiKey, 'key_hash'>[];
}

/**
 * Middleware to authenticate incoming requests via Bearer token API keys.
 */
export async function authenticateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'No API key provided. Include "Authorization: Bearer sk_live_..." header.',
      },
    });
    return;
  }

  const rawKey = authHeader.substring(7).trim();
  if (!rawKey.startsWith('sk_live_')) {
    res.status(401).json({
      error: {
        code: 'invalid_key',
        message: 'Invalid API key format. API key must start with "sk_live_".',
      },
    });
    return;
  }

  const keyHash = hashKey(rawKey);

  try {
    const result = await db.execute({
      sql: `SELECT * FROM api_keys WHERE key_hash = ? AND status = 'active'`,
      args: [keyHash],
    });

    if (result.rows.length === 0) {
      res.status(401).json({
        error: {
          code: 'invalid_key',
          message: 'The API key provided is invalid or has been revoked.',
        },
      });
      return;
    }

    // Attach key metadata if needed
    (req as any).apiKey = result.rows[0];
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An internal error occurred during authentication.',
      },
    });
  }
}
