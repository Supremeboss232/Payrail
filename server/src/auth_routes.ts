import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { vaultDb, railDb, hashPassword } from './db';
import { createAccount } from './ledger';
import { encryptCredentials } from './crypto';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'payrail-jwt-super-secret-key-12345';

// Base64URL Encoding helpers
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString();
}

// Sign JWT Token
export function signJwt(payload: any, expiresInSeconds = 86400): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(signatureInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${signatureInput}.${signature}`;
}

// Verify JWT Token
export function verifyJwt(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(signatureInput)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    if (signature !== expectedSignature) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // Token expired
    }
    return payload;
  } catch {
    return null;
  }
}

// Helper to generate Secp256k1 keys
function generateSecp256k1KeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey
  };
}

/**
 * POST /v1/auth/register
 * Onboards a new member bank, generates ECDSA keypair, clearing accounts, and admin user
 */
router.post('/register', async (req: Request, res: Response) => {
  const { legal_name, routing_code, username, password, connector_type, connector_config } = req.body;

  if (!legal_name || !routing_code || !username || !password) {
    res.status(400).json({ error: 'legal_name, routing_code, username, and password are required.' });
    return;
  }

  try {
    // 1. Check if user already exists in Vault
    const checkUser = await vaultDb.execute({
      sql: 'SELECT id FROM users WHERE username = ?',
      args: [username]
    });
    if (checkUser.rows.length > 0) {
      res.status(409).json({ error: `Username ${username} is already registered.` });
      return;
    }

    // 2. Generate Secp256k1 ECDSA Keypair for the tenant
    const { publicKeyPem, privateKeyPem } = generateSecp256k1KeyPair();
    const tenantId = uuidv4();
    const createdAt = new Date().toISOString();

    // 3. Create Tenant in Core Database
    if (railDb.isPostgres) {
      await railDb.execute({
        sql: `INSERT INTO tenants (id, name, legal_name, routing_code, api_status, public_key_pem, created_at)
              VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        args: [tenantId, legal_name, legal_name, routing_code, publicKeyPem, createdAt]
      });
    } else {
      await railDb.execute({
        sql: `INSERT INTO tenants (id, legal_name, routing_code, api_status, public_key_pem, created_at)
              VALUES (?, ?, ?, 'active', ?, ?)`,
        args: [tenantId, legal_name, routing_code, publicKeyPem, createdAt]
      });
    }

    // 4. Create default USD Clearing Account for this member bank
    const cleanBic = routing_code.toLowerCase().replace(/[^a-z0-9]/g, '');
    const clearingAccountId = `acc_clearing_${cleanBic}`;
    await createAccount(
      clearingAccountId,
      `${legal_name} Base Clearing Account`,
      'asset',
      'bank',
      'USD',
      0, // Initial balance
      tenantId
    );

    // 5. Create Member Administrator User in Vault Database
    const passwordHash = hashPassword(password);
    const userId = `user_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    await vaultDb.execute({
      sql: `INSERT INTO users (id, tenant_id, username, password_hash, role, created_at)
            VALUES (?, ?, ?, ?, 'member', ?)`,
      args: [userId, tenantId, username, passwordHash, createdAt]
    });

    // 6. Auto-create linked funding source if connector config provided
    let fundingSourceId: string | null = null;
    if (connector_type && connector_type !== 'none') {
      const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'payment-rail-master-default-key-12345';
      fundingSourceId = `fs_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
      const fsCreatedAt = new Date().toISOString();

      await railDb.execute({
        sql: `INSERT INTO funding_sources (id, name, type, account_id, priority, status, connector_type, created_at)
              VALUES (?, ?, 'bank', ?, 1, 'active', ?, ?)
              ON CONFLICT (id) DO NOTHING`,
        args: [fundingSourceId, `${legal_name} Primary Reserves`, clearingAccountId, connector_type, fsCreatedAt]
      });

      if (connector_config && typeof connector_config === 'object') {
        const encrypted = encryptCredentials(connector_config, ENCRYPTION_KEY);
        await railDb.execute({
          sql: 'UPDATE funding_sources SET credentials_encrypted = ? WHERE id = ?',
          args: [encrypted, fundingSourceId]
        });
      }
    }

    // 7. Return response with Private Key PEM (Client needs to save this for signing requests!)
    res.status(201).json({
      success: true,
      tenant: {
        id: tenantId,
        legal_name,
        routing_code,
        clearing_account: clearingAccountId,
        funding_source_id: fundingSourceId,
        connector_type: connector_type || 'none',
      },
      private_key_pem: privateKeyPem,
      public_key_pem: publicKeyPem
    });
  } catch (err: any) {
    console.error('B2B Register Error:', err);
    res.status(500).json({ error: err.message || 'Internal registration failure.' });
  }
});

/**
 * POST /v1/auth/login
 * Validates user credentials and returns scoped JWT token
 */
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required.' });
    return;
  }

  try {
    const passwordHash = hashPassword(password);
    const userResult = await vaultDb.execute({
      sql: 'SELECT * FROM users WHERE username = ? AND password_hash = ?',
      args: [username, passwordHash]
    });

    if (userResult.rows.length === 0) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const user = userResult.rows[0] as any;
    let legalName = 'Clearinghouse Administrator';
    let routingCode = 'PAYRAIL_SYSTEM_BIC';

    // If it's a member bank user, fetch their tenant details from the Core database
    if (user.role === 'member' && user.tenant_id) {
      const tenantResult = await railDb.execute({
        sql: 'SELECT * FROM tenants WHERE id = ?',
        args: [user.tenant_id]
      });
      if (tenantResult.rows.length > 0) {
        const tenant = tenantResult.rows[0] as any;
        legalName = tenant.legal_name || tenant.name;
        routingCode = tenant.routing_code;
      }
    }

    // Sign scoped JWT
    const token = signJwt({
      userId: user.id,
      username: user.username,
      tenantId: user.tenant_id,
      role: user.role,
      legalName,
      routingCode
    });

    res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        tenant_id: user.tenant_id,
        role: user.role,
        legal_name: legalName,
        routing_code: routingCode
      }
    });
  } catch (err: any) {
    console.error('B2B Login Error:', err);
    res.status(500).json({ error: 'Internal login failure.' });
  }
});

// Helper endpoint for the API playground and UI simulator to sign payloads using client private keys
router.post('/sign_payload', (req, res) => {
  const { privateKeyPem, payload } = req.body;
  if (!privateKeyPem || !payload) {
    res.status(400).json({ error: 'privateKeyPem and payload are required.' });
    return;
  }
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify(payload);
    const dataToSign = `${timestamp}.${rawBody}`;

    const sign = crypto.createSign('SHA256');
    sign.update(dataToSign);
    const signature = sign.sign(privateKeyPem, 'hex');

    res.json({ timestamp, signature });
  } catch (e: any) {
    console.error('Signing Helper Error:', e);
    res.status(400).json({ error: `Signing failed: ${e.message}` });
  }
});

export default router;
