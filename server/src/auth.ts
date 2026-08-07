import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { vaultDb, railDb } from './db';

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
 * Stores in vaultDb and syncs metadata to railDb.synced_api_keys.
 */
export async function generateApiKey(name: string, tenantId: string | null = null): Promise<{ rawKey: string; key: ApiKey }> {
  const rawKeyBytes = crypto.randomBytes(24).toString('hex'); // 48 chars
  const prefix = 'sk_live_';
  const rawKey = `${prefix}${rawKeyBytes}`;
  const keyHash = hashKey(rawKey);
  const id = `key_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const createdAt = new Date().toISOString();

  // 1. Store API key in Vault Database
  await vaultDb.execute({
    sql: `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    args: [id, tenantId, keyHash, prefix, name, createdAt],
  });

  // 2. Sync Configuration Handshake to Core Rail Database
  await railDb.execute({
    sql: `INSERT INTO synced_api_keys (id, tenant_id, key_hash, prefix, name, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    args: [id, tenantId, keyHash, prefix, name, createdAt],
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
 * Updates vaultDb and syncs status update to railDb.
 */
export async function revokeApiKey(id: string): Promise<void> {
  // 1. Revoke key in Vault Database
  await vaultDb.execute({
    sql: `UPDATE api_keys SET status = 'revoked' WHERE id = ?`,
    args: [id],
  });

  // 2. Sync Revocation status update to Core Rail Database
  await railDb.execute({
    sql: `UPDATE synced_api_keys SET status = 'revoked' WHERE id = ?`,
    args: [id],
  });
}

/**
 * Retrieves all registered API keys from the Vault Database.
 */
export async function getApiKeys(tenantId?: string | null): Promise<Omit<ApiKey, 'key_hash'>[]> {
  if (tenantId) {
    const result = await vaultDb.execute({
      sql: `
        SELECT id, prefix, name, status, created_at
        FROM api_keys
        WHERE tenant_id = ?
        ORDER BY created_at DESC
      `,
      args: [tenantId],
    });
    return result.rows as unknown as Omit<ApiKey, 'key_hash'>[];
  }
  const result = await vaultDb.execute(`
    SELECT id, prefix, name, status, created_at
    FROM api_keys
    ORDER BY created_at DESC
  `);
  return result.rows as unknown as Omit<ApiKey, 'key_hash'>[];
}

/**
 * Middleware to authenticate incoming requests via Bearer token API keys.
 * Validates strictly against railDb.synced_api_keys for complete security isolation.
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
    // Validate key locally inside Core Rail DB
    const result = await railDb.execute({
      sql: `SELECT * FROM synced_api_keys WHERE key_hash = ? AND status = 'active'`,
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

import { authenticateB2BRequest } from './b2b';
export async function authenticateGateway(req: Request, res: Response, next: NextFunction): Promise<void> {
  const isB2B = req.headers['payrail-signature'] && req.headers['payrail-tenant-id'];
  if (isB2B) {
    await authenticateB2BRequest(req, res, next);
  } else {
    await authenticateApiKey(req, res, next);
  }
}

import { verifyJwt } from './auth_routes';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        username: string;
        tenantId: string | null;
        role: 'admin' | 'member';
        legalName: string;
        routingCode: string;
      };
    }
  }
}

export function authenticateJwt(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required. Access Denied.' });
    return;
  }

  const token = authHeader.substring(7).trim();
  const payload = verifyJwt(token);

  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid token. Please log in again.' });
    return;
  }

  req.user = payload;
  next();
}
