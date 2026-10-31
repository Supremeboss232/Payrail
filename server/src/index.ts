import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as path from 'path';
import { initDb, vaultDb, railDb, systemTenantId, executeWithTenant, createNotification } from './db';
import { createAccount, getAccounts, getTransactions, getTransactionEntries, getAccountHistory, postTransaction } from './ledger';
import { authenticateApiKey, authenticateGateway, getApiKeys, revokeApiKey, generateApiKey, authenticateJwt } from './auth';
import { getWebhookEndpoints, createWebhookEndpoint, deleteWebhookEndpoint, getWebhookLogs } from './webhooks';
import { getComplianceStatus, ensureSdnLoaded } from './compliance';
import { decryptCredentials, encryptCredentials } from './crypto';
import gatewayRouter from './gateway';
import authRouter from './auth_routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 9500;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Lightweight Rate Limiter for Auth Routes (Max 40 requests / minute per IP)
const authRateLimiter = new Map<string, { count: number; resetAt: number }>();
app.use('/v1/auth', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = authRateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    authRateLimiter.set(ip, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > 40) {
    res.status(429).json({ error: 'Too many authentication attempts. Please try again in 60 seconds.' });
    return;
  }
  next();
});

// Public System Status endpoint
app.get('/v1/system/status', (req, res) => {
  res.json({
    db_engine: railDb.isPostgres ? 'postgres' : 'sqlite',
    system_tenant_id: systemTenantId
  });
});

// Authentication Routes
app.use('/v1/auth', authRouter);

// Protect all console API routes using JWT sessions
app.use('/console', authenticateJwt);

// Console API Endpoints (For local Dashboard visualization and control)
app.get('/console/accounts', async (req, res) => {
  try {
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    const accounts = await getAccounts(tenantId);
    res.json(accounts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/console/accounts', async (req, res) => {
  const { id, name, type, category, currency, initialBalance = 0 } = req.body;
  try {
    const tenantId = (req.user?.role === 'member' && req.user.tenantId) ? req.user.tenantId : systemTenantId;
    const account = await createAccount(
      id,
      name,
      type,
      category,
      currency,
      parseInt(initialBalance),
      tenantId
    );
    res.status(201).json(account);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/console/accounts/:id/history', async (req, res) => {
  try {
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    const history = await getAccountHistory(req.params.id, tenantId);
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/console/transactions', async (req, res) => {
  try {
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    const txs = await getTransactions(tenantId);
    const fullTxs = await Promise.all(
      txs.map(async (tx) => {
        const rawEntries = await getTransactionEntries(tx.id);
        const entries = rawEntries.map((e) => ({
          ...e,
          accountId: e.account_id,
          transactionId: e.transaction_id,
        }));
        return { ...tx, entries };
      })
    );
    res.json(fullTxs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/console/funding_sources', async (req, res) => {
  try {
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    let sql = 'SELECT * FROM funding_sources';
    const args: any[] = [];
    if (tenantId) {
      sql += ' WHERE account_id IN (SELECT id FROM accounts WHERE tenant_id = ?)';
      args.push(tenantId);
    }
    sql += ' ORDER BY priority ASC';
    const result = await railDb.execute({ sql, args });
    res.status(200).json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /console/banks ────────────────────────────────────────────────────────
// Returns all registered member banks with their clearing account balances and funding sources
app.get('/console/banks', async (req, res) => {
  try {
    const tenantsResult = await railDb.execute(
      "SELECT * FROM tenants WHERE routing_code != 'PAYRAIL_SYSTEM_BIC' ORDER BY created_at ASC"
    );

    const banks = await Promise.all(tenantsResult.rows.map(async (tenant: any) => {
      // Find their primary clearing account
      const accResult = await railDb.execute({
        sql: 'SELECT id, balance FROM accounts WHERE tenant_id = ? AND category = ? ORDER BY created_at ASC LIMIT 1',
        args: [tenant.id, 'bank']
      });
      const clearingAccount = accResult.rows[0] as any;

      // Find linked funding source
      let fundingSource = null;
      try {
        const fsResult = await railDb.execute({
          sql: 'SELECT id, connector_type, status, priority FROM funding_sources WHERE account_id = ? ORDER BY priority ASC LIMIT 1',
          args: [clearingAccount?.id || '']
        });
        if (fsResult.rows.length > 0) fundingSource = fsResult.rows[0];
      } catch {}

      return {
        id: tenant.id,
        legal_name: tenant.legal_name || tenant.name,
        routing_code: tenant.routing_code,
        api_status: tenant.api_status || 'active',
        created_at: tenant.created_at,
        clearing_account: clearingAccount?.id || null,
        clearing_balance: clearingAccount?.balance ?? null,
        funding_source: fundingSource
      };
    }));

    res.json(banks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── PATCH /console/banks/:id/status ──────────────────────────────────────────
// Enables or disables a member bank tenant
app.patch('/console/banks/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    res.status(400).json({ error: 'status must be active or inactive.' });
    return;
  }
  try {
    await railDb.execute({
      sql: 'UPDATE tenants SET api_status = ? WHERE id = ?',
      args: [status, id]
    });
    res.json({ success: true, id, status });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /console/banks/:id/test_connection ──────────────────────────────────
// Decrypts the member bank's actual stored funding source credentials and pings their live endpoint
app.post('/console/banks/:id/test_connection', async (req, res) => {
  const { id } = req.params;
  try {
    const accResult = await railDb.execute({
      sql: 'SELECT id FROM accounts WHERE tenant_id = ? AND category = ? ORDER BY created_at ASC LIMIT 1',
      args: [id, 'bank']
    });
    const clearingAccount = accResult.rows[0] as any;
    if (!clearingAccount) {
      res.json({ ok: false, latency_ms: 0, message: 'No clearing account found for this member bank.' });
      return;
    }

    const fsResult = await railDb.execute({
      sql: 'SELECT * FROM funding_sources WHERE account_id = ? ORDER BY priority ASC LIMIT 1',
      args: [clearingAccount.id]
    });
    if (fsResult.rows.length === 0) {
      res.json({ ok: false, latency_ms: 0, message: 'No outbound connector configured for this member bank.' });
      return;
    }

    const fs = fsResult.rows[0] as any;
    const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'payment-rail-master-default-key-12345';
    if (!fs.credentials_encrypted) {
      res.json({ ok: false, latency_ms: 0, message: `Connector (${fs.connector_type}) has no endpoint credentials configured yet.` });
      return;
    }

    const config = decryptCredentials(fs.credentials_encrypted, ENCRYPTION_KEY);
    if (fs.connector_type === 'web3_rpc') {
      const rpcUrl = config.rpc_url || config.url || process.env.CRYPTO_RPC_URL || 'https://ethereum-rpc.publicnode.com';
      const start = Date.now();
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: AbortSignal.timeout(8000)
      });
      const latency = Date.now() - start;
      const data = await response.json() as any;
      const blockNumber = data?.result ? parseInt(data.result, 16) : null;
      res.json({
        ok: !!blockNumber,
        latency_ms: latency,
        block_number: blockNumber,
        message: blockNumber ? `Web3 RPC node online — Block #${blockNumber.toLocaleString()} (${latency}ms)` : 'RPC node returned invalid response.'
      });
      return;
    }

    // Default: http_callback
    const targetUrl = config.url;
    if (!targetUrl) {
      res.json({ ok: false, latency_ms: 0, message: 'No callback URL found in encrypted credentials.' });
      return;
    }

    const start = Date.now();
    const response = await fetch(targetUrl, {
      method: config.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
      body: JSON.stringify(config.body_template || { test: true, source: 'payrail_connector_ping' }),
      signal: AbortSignal.timeout(8000)
    });
    const latency = Date.now() - start;
    res.json({
      ok: response.ok || response.status < 500,
      http_status: response.status,
      latency_ms: latency,
      message: `Live endpoint ${targetUrl} responded HTTP ${response.status} in ${latency}ms.`
    });
  } catch (err: any) {
    res.json({ ok: false, latency_ms: 0, message: `Connector ping failed: ${err.message}` });
  }
});

// ── GET & POST /console/settings/providers ───────────────────────────────────
// Allows Admin to view and configure live upstream provider API keys & endpoints from the UI
const CONFIGURABLE_PROVIDER_KEYS = [
  'FIXER_IO_API_KEY',
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL',
  'COMPLY_ADVANTAGE_API_KEY',
  'CRYPTO_RPC_URL',
  'CRYPTO_PRIVATE_KEY',
  'CRYPTO_CONTRACT_ADDRESS',
  'MARQETA_BASE_URL',
  'MARQETA_APP_TOKEN',
  'MARQETA_ADMIN_TOKEN',
  'ACH_ROUTING_NUMBER',
  'EQUIFAX_CLIENT_ID',
  'EQUIFAX_CLIENT_SECRET'
];

app.get('/console/settings/providers', async (req, res) => {
  const configured: Record<string, { is_set: boolean; masked_value: string }> = {};
  for (const key of CONFIGURABLE_PROVIDER_KEYS) {
    const val = process.env[key] || '';
    configured[key] = {
      is_set: val.length > 0,
      masked_value: val.length > 8 ? `${val.slice(0, 4)}••••••••${val.slice(-4)}` : (val.length > 0 ? '••••••••' : '')
    };
  }
  res.json({ keys: configured });
});

app.post('/console/settings/providers', async (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Only clearinghouse administrators can update provider settings.' });
    return;
  }
  const updates = req.body || {};
  const now = new Date().toISOString();
  const updatedKeys: string[] = [];

  try {
    for (const key of CONFIGURABLE_PROVIDER_KEYS) {
      if (updates[key] !== undefined) {
        const val = String(updates[key]).trim();
        if (val === '') {
          delete process.env[key];
          await vaultDb.execute({ sql: 'DELETE FROM system_settings WHERE key = ?', args: [key] });
        } else {
          process.env[key] = val;
          await vaultDb.execute({
            sql: `INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)`,
            args: [key, val, now]
          });
          await vaultDb.execute({
            sql: `UPDATE system_settings SET value = ?, updated_at = ? WHERE key = ?`,
            args: [val, now, key]
          });
        }
        updatedKeys.push(key);
      }
    }
    res.json({ success: true, updated_keys: updatedKeys, message: 'Live provider credentials updated and applied immediately.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/console/funding_sources', async (req, res) => {
  const { name, type, account_id, priority = 0, connector_type = 'http_callback', credentials } = req.body;
  if (!name || !type || !account_id) {
    res.status(400).json({ error: 'name, type, and account_id are required.' });
    return;
  }
  const id = `fs_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const createdAt = new Date().toISOString();
  try {
    const accResult = await railDb.execute({
      sql: 'SELECT id FROM accounts WHERE id = ?',
      args: [account_id],
    });
    if (accResult.rows.length === 0) {
      res.status(400).json({ error: `Account ${account_id} not found.` });
      return;
    }
    const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'payment-rail-master-default-key-12345';
    const encCreds = (credentials && typeof credentials === 'object' && Object.keys(credentials).length > 0)
      ? encryptCredentials(credentials, ENCRYPTION_KEY)
      : null;

    await railDb.execute({
      sql: `INSERT INTO funding_sources (id, name, type, account_id, priority, status, connector_type, credentials_encrypted, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      args: [id, name, type, account_id, priority, connector_type, encCreds, createdAt],
    });
    res.status(201).json({ id, name, type, account_id, priority, status: 'active', connector_type, created_at: createdAt });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/console/funding_sources/:id/swap', async (req, res) => {
  const { id } = req.params;
  const { priority, status } = req.body;
  try {
    if (priority !== undefined) {
      await railDb.execute({
        sql: 'UPDATE funding_sources SET priority = ? WHERE id = ?',
        args: [priority, id],
      });
    }
    if (status !== undefined) {
      await railDb.execute({
        sql: 'UPDATE funding_sources SET status = ? WHERE id = ?',
        args: [status, id],
      });
    }
    const updated = await railDb.execute({
      sql: 'SELECT * FROM funding_sources WHERE id = ?',
      args: [id],
    });
    res.status(200).json(updated.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/console/api_keys', async (req, res) => {
  try {
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    const keys = await getApiKeys(tenantId);
    res.json(keys);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/console/api_keys', async (req, res) => {
  try {
    const { name } = req.body;
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    const result = await generateApiKey(name || 'Custom Console Key', tenantId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/console/api_keys/:id', async (req, res) => {
  try {
    await revokeApiKey(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/console/webhook_endpoints', async (req, res) => {
  try {
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    const endpoints = await getWebhookEndpoints(tenantId);
    res.json(endpoints);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/console/webhook_endpoints', async (req, res) => {
  try {
    const { url, events } = req.body;
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    const endpoint = await createWebhookEndpoint(url, events, tenantId);
    res.json(endpoint);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/console/webhook_endpoints/:id', async (req, res) => {
  try {
    await deleteWebhookEndpoint(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/console/webhook_logs', async (req, res) => {
  try {
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    const logs = await getWebhookLogs(tenantId);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/console/notifications', async (req, res) => {
  try {
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    let sql = 'SELECT * FROM notifications';
    const args: any[] = [];
    if (tenantId) {
      if (railDb.isPostgres) {
        const result = await executeWithTenant(
          tenantId,
          'SELECT * FROM notifications WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50',
          [tenantId]
        );
        res.json(result.rows);
        return;
      } else {
        sql += ' WHERE tenant_id = ?';
        args.push(tenantId);
      }
    } else if (railDb.isPostgres) {
      const result = await executeWithTenant(
        systemTenantId,
        'SELECT * FROM notifications WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50',
        [systemTenantId]
      );
      res.json(result.rows);
      return;
    }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const result = await railDb.execute({ sql, args });
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/console/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    if (railDb.isPostgres) {
      const activeTenantId = tenantId || systemTenantId;
      await executeWithTenant(
        activeTenantId,
        'UPDATE notifications SET read = 1 WHERE id = $1 AND tenant_id = $2',
        [id, activeTenantId]
      );
    } else {
      let sql = 'UPDATE notifications SET read = 1 WHERE id = ?';
      const args: any[] = [id];
      await railDb.execute({ sql, args });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/console/notifications/read_all', async (req, res) => {
  try {
    const tenantId = req.user?.role === 'member' ? (req.user.tenantId || undefined) : undefined;
    if (railDb.isPostgres) {
      const activeTenantId = tenantId || systemTenantId;
      await executeWithTenant(
        activeTenantId,
        'UPDATE notifications SET read = 1 WHERE tenant_id = $1',
        [activeTenantId]
      );
    } else {
      await railDb.execute({
        sql: 'UPDATE notifications SET read = 1',
        args: []
      });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Seed API endpoint for easy resetting/triggering
app.post('/console/seed_funds', async (req, res) => {
  const { accountId, amount, currency = 'USD' } = req.body;
  try {
    const tenantId = (req.user?.role === 'member' && req.user.tenantId) ? req.user.tenantId : systemTenantId;
    const systemEquity = `acc_system_equity_${currency.toLowerCase()}`;
    
    await railDb.execute({
      sql: `INSERT OR IGNORE INTO accounts (id, tenant_id, name, type, category, currency, balance, status, created_at)
            VALUES (?, ?, ?, 'equity', 'equity', ?, 0, 'active', ?)`,
      args: [systemEquity, tenantId, `System Capital Equity (${currency.toUpperCase()})`, currency.toUpperCase(), new Date().toISOString()],
    });

    await postTransaction(
      `Console treasury liquidity deposit to ${accountId}`,
      'console',
      [
        { accountId, type: 'debit', amount: Number(amount), currency: currency.toUpperCase() },
        { accountId: systemEquity, type: 'credit', amount: Number(amount), currency: currency.toUpperCase() },
      ],
      `dep_${accountId}_${Date.now()}`,
      null,
      tenantId
    );
    await createNotification(
      tenantId,
      'Treasury Liquidity Deposited',
      `Direct treasury liquidity deposit of $${(Number(amount) / 100).toFixed(2)} ${currency.toUpperCase()} deposited to account ${accountId}.`,
      'success'
    );
    res.json({ success: true, message: 'Treasury liquidity deposited successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /v1/fx/rates ─────────────────────────────────────────────────────────
// Returns live currency exchange rates from Fixer.io or Open ExchangeRate-API (live market rates)
const fxRateCache: { rates: any; base: string; source: string; timestamp: number } = { rates: null, base: '', source: '', timestamp: 0 };
const FX_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const OFFLINE_FX_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.9215,
  GBP: 0.7885,
  JPY: 151.45,
  CAD: 1.3620,
  CHF: 0.8840,
  AUD: 1.5280,
  SGD: 1.3450,
  HKD: 7.8210,
  NGN: 1580.00,
  GHS: 15.65,
  ZAR: 18.42,
  KES: 129.00,
  AED: 3.6725,
  INR: 83.45
};

app.get('/v1/fx/rates', async (req, res) => {
  const base = (req.query.base as string || 'USD').toUpperCase();
  const symbols = req.query.symbols as string | undefined;
  const apiKey = process.env.FIXER_IO_API_KEY;

  // Serve from cache if fresh
  if (fxRateCache.rates && fxRateCache.base === base && Date.now() - fxRateCache.timestamp < FX_CACHE_TTL_MS) {
    const cached = symbols
      ? Object.fromEntries(symbols.split(',').map(s => [s.trim().toUpperCase(), fxRateCache.rates[s.trim().toUpperCase()]]).filter(([, v]) => v !== undefined))
      : fxRateCache.rates;
    res.json({ base, rates: cached, source: fxRateCache.source, cached: true, timestamp: new Date(fxRateCache.timestamp).toISOString() });
    return;
  }

  // 1. If Fixer.io API key is configured, query Fixer.io first
  if (apiKey) {
    try {
      const symbolParam = symbols ? `&symbols=${symbols}` : '';
      const response = await fetch(`https://data.fixer.io/api/latest?access_key=${apiKey}&base=${base}${symbolParam}`, {
        signal: AbortSignal.timeout(6000)
      });
      const data = await response.json() as any;

      if (data.success && data.rates) {
        fxRateCache.rates = data.rates;
        fxRateCache.base = base;
        fxRateCache.source = 'fixer.io (Live)';
        fxRateCache.timestamp = Date.now();

        res.json({
          base: data.base,
          rates: data.rates,
          source: 'fixer.io (Live)',
          cached: false,
          timestamp: new Date(data.timestamp * 1000).toISOString()
        });
        return;
      }
    } catch (err: any) {
      console.warn('[FX] Fixer.io request failed, falling back to live Open ExchangeRate-API:', err.message);
    }
  }

  // 2. Live Public Market Rates via Open ExchangeRate-API (160+ currencies, no API key required)
  try {
    const openRes = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
      signal: AbortSignal.timeout(6000)
    });
    const openData = await openRes.json() as any;
    if (openData && openData.result === 'success' && openData.rates) {
      fxRateCache.rates = openData.rates;
      fxRateCache.base = base;
      fxRateCache.source = 'open.er-api.com (Live Market Feed)';
      fxRateCache.timestamp = Date.now();

      const filtered = symbols
        ? Object.fromEntries(symbols.split(',').map(s => [s.trim().toUpperCase(), openData.rates[s.trim().toUpperCase()]]).filter(([, v]) => v !== undefined))
        : openData.rates;

      res.json({
        base,
        rates: filtered,
        source: 'open.er-api.com (Live Market Feed)',
        cached: false,
        timestamp: openData.time_last_update_utc ? new Date(openData.time_last_update_utc).toISOString() : new Date().toISOString()
      });
      return;
    }
  } catch (err: any) {
    console.warn('[FX] Live Open ExchangeRate-API unreachable, using offline reference rates:', err.message);
  }

  // 3. Offline emergency fallback only when server has no internet connectivity
  const baseRate = OFFLINE_FX_RATES[base] || 1.0;
  const computedRates: Record<string, number> = {};
  for (const [curr, r] of Object.entries(OFFLINE_FX_RATES)) {
    computedRates[curr] = parseFloat((r / baseRate).toFixed(6));
  }
  const filtered = symbols
    ? Object.fromEntries(symbols.split(',').map(s => [s.trim().toUpperCase(), computedRates[s.trim().toUpperCase()] ?? 1.0]))
    : computedRates;
  res.json({
    base,
    rates: filtered,
    source: 'offline_emergency_fallback',
    cached: true,
    timestamp: new Date().toISOString()
  });
});

// ── GET /v1/crypto/status ─────────────────────────────────────────────────────
// Returns live block number from configured RPC node (defaults to public Ethereum Mainnet RPC)
app.get('/v1/crypto/status', async (req, res) => {
  const rpcUrl = process.env.CRYPTO_RPC_URL || 'https://ethereum-rpc.publicnode.com';

  try {
    const start = Date.now();
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(6000)
    });
    const data = await response.json() as any;
    const blockNumber = data?.result ? parseInt(data.result, 16) : null;
    const latencyMs = Date.now() - start;

    res.json({
      status: blockNumber ? 'connected' : 'degraded',
      block_number: blockNumber,
      latency_ms: latencyMs,
      rpc_url: rpcUrl.replace(/\/[a-zA-Z0-9]{20,}/, '/***'),
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(502).json({ status: 'unreachable', error: err.message });
  }
});

// ── GET /v1/providers/status ──────────────────────────────────────────────────
// Aggregate status for all 9 provider integrations
app.get('/v1/providers/status', async (req, res) => {
  const hasFixerKey = !!process.env.FIXER_IO_API_KEY;
  const hasSendGrid = !!process.env.SENDGRID_API_KEY;
  const hasComplyAdvantage = !!process.env.COMPLY_ADVANTAGE_API_KEY;
  const hasCustomCryptoRpc = !!process.env.CRYPTO_RPC_URL;
  const hasMarqeta = !!process.env.MARQETA_BASE_URL;
  const hasAchSponsor = !!process.env.ACH_ROUTING_NUMBER;
  const hasEquifax = !!process.env.EQUIFAX_CLIENT_ID;
  const complianceInfo = getComplianceStatus();

  const providers = {
    fx_rates: {
      name: 'FX Exchange Rates',
      status: 'active',
      engine: hasFixerKey ? 'Fixer.io Live' : 'Open ExchangeRate-API (Live Market Feed — 160+ Currencies)',
      configured: true,
      setup_url: 'https://fixer.io/product',
      cost: 'Live Free Market Feed / $14/mo Fixer Pro'
    },
    email_otp: {
      name: 'Email OTP / Transactional Email',
      status: 'active',
      engine: hasSendGrid ? 'SendGrid Live' : 'Payrail In-Network OTP Engine',
      configured: true,
      setup_url: 'https://sendgrid.com',
      cost: 'Free tier available'
    },
    aml_screening: {
      name: 'AML / OFAC Compliance Screening',
      status: 'active',
      engine: hasComplyAdvantage ? 'ComplyAdvantage Live' : 'U.S. Treasury OFAC SDN List (Live Federal Feed)',
      configured: true,
      sdn_entries_cached: complianceInfo.sdnEntriesCached,
      last_refreshed: complianceInfo.lastRefreshed,
      upgrade_url: 'https://complyadvantage.com',
    },
    crypto_rails: {
      name: 'Crypto / Web3 Payment Rail',
      status: 'active',
      engine: hasCustomCryptoRpc ? `Custom EVM RPC (${process.env.CRYPTO_RPC_URL?.replace(/\/[a-zA-Z0-9]{20,}/, '/***')})` : 'Ethereum Mainnet PublicNode RPC (Live Ethers.js)',
      configured: true,
      setup_url: 'https://www.alchemy.com',
      cost: 'Live Public RPC / Custom Alchemy Node'
    },
    card_issuance: {
      name: 'Card Issuance',
      status: 'active',
      engine: hasMarqeta ? 'Marqeta Card Issuing Platform' : 'Payrail Ledger Card Network (Luhn + AES-256 Vault)',
      configured: true,
      setup_url: 'https://www.marqeta.com',
      cost: 'Active in-network / Marqeta optional',
      timeline: 'Instant live ledger issuance'
    },
    ach_wire: {
      name: 'ACH / Wire Payment Rails',
      status: 'active',
      engine: hasAchSponsor ? `Fed ACH (${process.env.ACH_ROUTING_NUMBER})` : 'Payrail NACHA / ISO 20022 Clearing Engine',
      configured: true,
      setup_url: 'https://www.federalreserve.gov/paymentsystems/fedach_frservices.htm',
      cost: 'Included in Payrail Clearinghouse'
    },
    credit_bureau: {
      name: 'Credit Bureau Soft Pull',
      status: 'active',
      engine: hasEquifax ? 'Equifax Consumer Credit API' : 'Payrail Ledger-Backed Credit Bureau',
      configured: true,
      setup_url: 'https://developer.equifax.com',
      cost: 'Included in Payrail Clearinghouse'
    },
    password_reset: {
      name: 'Password Reset',
      status: 'active',
      engine: 'DB-backed token store',
      configured: true
    },
    security_questions: {
      name: 'Security Questions',
      status: 'active',
      engine: 'DB-backed (SHA-256 hashed answers)',
      configured: true
    }
  };

  res.json({
    timestamp: new Date().toISOString(),
    providers,
    services: providers
  });
});

// ── Public / Optionally Authenticated Services Catalog ────────────────────────
// Exposed before authenticateGateway so UI tabs can load catalog with or without Gateway Key
app.get('/v1/services/catalog', async (req, res) => {
  const hasFixerKey = !!process.env.FIXER_IO_API_KEY;
  const hasSendGrid = !!process.env.SENDGRID_API_KEY;
  const hasComplyAdvantage = !!process.env.COMPLY_ADVANTAGE_API_KEY;
  const hasCustomCryptoRpc = !!process.env.CRYPTO_RPC_URL;
  const hasMarqeta = !!process.env.MARQETA_BASE_URL;
  const hasAch = !!process.env.ACH_ROUTING_NUMBER;
  const hasEquifax = !!process.env.EQUIFAX_CLIENT_ID;
  const complianceInfo = getComplianceStatus();

  const services = [
    {
      id: 'fx_conversion',
      name: 'FX Currency Conversion & Live Rates',
      description: 'Real-time market exchange rates across 160+ currencies and instant cross-currency conversion.',
      category: 'payments',
      status: 'available',
      endpoint: 'POST /v1/fx/convert',
      docs_endpoint: 'GET /v1/fx/rates',
      cost_model: 'Included in Payrail membership',
      upstream_provider: hasFixerKey ? 'Fixer.io Live' : 'Open ExchangeRate-API (Live Market Feed)',
      engine: hasFixerKey ? 'Fixer.io (170+ currencies)' : 'Open ExchangeRate-API (Live Market Feed — 160+ currencies)',
      upgrade_note: !hasFixerKey ? 'Using live Open ExchangeRate-API market feed. Configure FIXER_IO_API_KEY in Provider Settings for Fixer Pro.' : null
    },
    {
      id: 'aml_screening',
      name: 'AML / OFAC Sanctions Screening',
      description: 'Screen counterparties against the U.S. Treasury OFAC SDN list, PEP lists, and global sanctions.',
      category: 'compliance',
      status: 'available',
      endpoint: 'POST /v1/compliance/screen',
      cost_model: 'Included in Payrail membership',
      upstream_provider: hasComplyAdvantage ? 'ComplyAdvantage (Live)' : `U.S. Treasury OFAC SDN (${complianceInfo.sdnEntriesCached.toLocaleString()} entries)`,
      engine: hasComplyAdvantage ? 'ComplyAdvantage (Live)' : `U.S. Treasury OFAC SDN (${complianceInfo.sdnEntriesCached.toLocaleString()} entries cached)`
    },
    {
      id: 'otp_verification',
      name: 'Transactional OTP & Email Verification',
      description: 'Generate and verify single-use 6-digit OTP codes with 10-minute TTL and brute-force lockouts.',
      category: 'identity',
      status: 'available',
      endpoint: 'POST /v1/otp/send',
      verify_endpoint: 'POST /v1/otp/verify',
      cost_model: 'Included in Payrail membership',
      upstream_provider: hasSendGrid ? 'SendGrid Transactional Email' : 'Payrail In-Network OTP Engine',
      engine: hasSendGrid ? 'SendGrid Transactional Email' : 'Payrail In-Network OTP Engine',
      upgrade_note: !hasSendGrid ? 'Configure SENDGRID_API_KEY in Provider Settings to enable external email delivery.' : null
    },
    {
      id: 'card_issuance',
      name: 'Virtual & Physical Card Issuance',
      description: 'Issue Luhn-valid virtual and physical debit cards backed by real ledger accounts with spend controls.',
      category: 'cards',
      status: 'available',
      endpoint: 'POST /v1/cards/issue',
      manage_endpoint: 'GET /v1/cards | POST /v1/cards/:id/freeze | POST /v1/cards/:id/cancel',
      cost_model: 'Included in Payrail membership',
      upstream_provider: hasMarqeta ? 'Marqeta Card Issuing Platform' : 'Payrail Internal Card Network (Luhn + AES-256 Vault)',
      engine: hasMarqeta ? 'Marqeta Card Issuing Platform' : 'Payrail Internal Card Network (Luhn + AES-256 Vault)'
    },
    {
      id: 'ach_wire',
      name: 'ACH, Domestic Wire & SWIFT Transfers',
      description: 'Originate ACH debits/credits and wire transfers with double-entry ledger settlement.',
      category: 'payments',
      status: 'available',
      endpoint: 'POST /v1/ach/transfer',
      cost_model: 'Included in Payrail membership',
      upstream_provider: hasAch ? `Federal Reserve FedACH (${process.env.ACH_ROUTING_NUMBER})` : 'Payrail NACHA / ISO 20022 Clearing Engine',
      engine: hasAch ? `Federal Reserve FedACH (${process.env.ACH_ROUTING_NUMBER})` : 'Payrail NACHA / ISO 20022 Clearing Engine'
    },
    {
      id: 'crypto_wallets',
      name: 'Crypto & Stablecoin Payment Rail',
      description: 'Live Ethereum Mainnet JSON-RPC connectivity and ERC-20 stablecoin (USDC/USDT) on-chain settlement.',
      category: 'crypto',
      status: 'available',
      endpoint: 'POST /v1/crypto/transfer',
      status_endpoint: 'GET /v1/crypto/status',
      cost_model: 'Network gas fees',
      upstream_provider: hasCustomCryptoRpc ? 'Custom EVM Web3 RPC' : 'Ethereum Mainnet PublicNode RPC',
      engine: hasCustomCryptoRpc ? 'Custom EVM / Ethers.js (USDC, USDT, ETH)' : 'Ethereum Mainnet PublicNode RPC (Live Block Feed)'
    },
    {
      id: 'credit_bureau',
      name: 'Credit Bureau Soft Pull & Risk Scoring',
      description: 'Real-time credit scoring (300–850) derived from live ledger payment history, settlement velocity, and account age.',
      category: 'identity',
      status: 'available',
      endpoint: 'POST /v1/credit/soft_pull',
      cost_model: 'Included in Payrail membership',
      upstream_provider: hasEquifax ? 'Equifax Consumer Credit API' : 'Payrail Ledger-Backed Credit Bureau',
      engine: hasEquifax ? 'Equifax Consumer Credit API' : 'Payrail Ledger-Backed Credit Bureau'
    },
    {
      id: 'settlement_clearing',
      name: 'Interbank Net Settlement & ISO 20022 Messaging',
      description: 'Multilateral Deferred Net Settlement (DNS) across member banks with pacs.008, pacs.009, and camt.053 XML.',
      category: 'settlement',
      status: 'available',
      endpoint: 'POST /v1/settlements/dns_sweep',
      cost_model: 'Included in Payrail membership',
      upstream_provider: 'Payrail Double-Entry Ledger + ISO 20022',
      engine: 'Payrail Double-Entry Ledger + ISO 20022 (pacs.008 / pacs.009 / camt.053)'
    },
    {
      id: 'payment_intents',
      name: 'Payment Intents & Multi-Rail Orchestration',
      description: 'Create and confirm payment intents with automatic funding source waterfall routing and OFAC screening.',
      category: 'payments',
      status: 'available',
      endpoint: 'POST /v1/payment_intents',
      confirm_endpoint: 'POST /v1/payment_intents/:id/confirm',
      cost_model: 'Included in Payrail membership',
      upstream_provider: 'Payrail Priority Waterfall Router',
      engine: 'Payrail Priority Waterfall Router (Bank → Wallet → Crypto)'
    },
    {
      id: 'partner_registration',
      name: 'Partner Self-Service Registration',
      description: 'Any private or institutional firm can register, generate an ECDSA keypair + API key, and onboard immediately.',
      category: 'platform',
      status: 'available',
      endpoint: 'POST /v1/partners/register',
      profile_endpoint: 'GET /v1/partners/me',
      cost_model: 'Included in Payrail membership',
      upstream_provider: 'Payrail BaaS Onboarding Engine',
      engine: 'Payrail BaaS Onboarding Engine'
    }
  ];

  res.json({
    platform: 'Payrail Clearinghouse & BaaS Gateway',
    version: '2.0',
    tenant_id: 'system',
    tenant_name: 'Payrail Clearinghouse Network',
    total_services: services.length,
    available_services: services.filter(s => s.status === 'available').length,
    active_services: services.filter(s => s.status === 'available').length,
    services,
    catalog: services
  });
});

// ── POST /v1/auth/forgot_password ─────────────────────────────────────────────
// Generates a reset token, stores it in DB, and emails link via SendGrid
app.post('/v1/auth/forgot_password', async (req, res) => {
  const { username } = req.body;
  if (!username) {
    res.status(400).json({ error: 'username is required.' });
    return;
  }

  try {
    const userResult = await vaultDb.execute({
      sql: 'SELECT id FROM users WHERE username = ?',
      args: [username]
    });

    // Always return 200 to prevent user enumeration attacks
    if (userResult.rows.length === 0) {
      res.json({ success: true, message: 'If that username exists, a reset link has been sent.' });
      return;
    }

    const user = userResult.rows[0] as any;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await vaultDb.execute({
      sql: `INSERT OR IGNORE INTO password_reset_tokens (token, user_id, expires_at, used, created_at)
            VALUES (?, ?, ?, 0, ?)`,
      args: [token, user.id, expiresAt, new Date().toISOString()]
    });

    // Send via SendGrid if configured
    const sendGridKey = process.env.SENDGRID_API_KEY;
    if (sendGridKey) {
      const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@payrail.io';
      const resetUrl = `${process.env.APP_BASE_URL || 'http://127.0.0.90:9000'}/reset-password?token=${token}`;
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sendGridKey}`
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: username.includes('@') ? username : `${username}@payrail.io` }] }],
          from: { email: fromEmail, name: 'Payrail Security' },
          subject: 'Your Payrail Password Reset Link',
          content: [{
            type: 'text/plain',
            value: `Reset your password here (expires in 1 hour):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`
          }]
        })
      });
      console.log(`[Auth] Password reset email sent to ${username}`);
      res.json({ success: true, message: 'If that username exists, a reset link has been sent.' });
    } else {
      console.log(`[Auth] SENDGRID_API_KEY not set. Reset token for ${username}: ${token}`);
      res.json({
        success: true,
        message: 'Reset token generated (in-network development delivery).',
        reset_token_dev: token,
        expires_at: expiresAt
      });
    }
  } catch (err: any) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Internal error processing password reset.' });
  }
});

// ── POST /v1/auth/reset_password ──────────────────────────────────────────────
// Validates DB token or security-question JWT and updates the hashed password
app.post('/v1/auth/reset_password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    res.status(400).json({ error: 'token and new_password are required.' });
    return;
  }
  if (new_password.length < 8) {
    res.status(400).json({ error: 'new_password must be at least 8 characters.' });
    return;
  }

  try {
    const { hashPassword } = await import('./db');
    const newHash = hashPassword(new_password);

    // Check if token is a signed JWT from security question verification
    if (token.includes('.')) {
      const { verifyJwt } = await import('./auth_routes');
      const payload = verifyJwt(token);
      if (!payload || payload.purpose !== 'password_reset' || !payload.userId) {
        res.status(400).json({ error: 'Invalid or expired security question reset token.' });
        return;
      }
      await vaultDb.execute({
        sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
        args: [newHash, payload.userId]
      });
      res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
      return;
    }

    const tokenResult = await vaultDb.execute({
      sql: 'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0',
      args: [token]
    });

    if (tokenResult.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or already-used reset token.' });
      return;
    }

    const resetToken = tokenResult.rows[0] as any;
    if (new Date(resetToken.expires_at) < new Date()) {
      res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
      return;
    }

    await vaultDb.execute({
      sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
      args: [newHash, resetToken.user_id]
    });

    await vaultDb.execute({
      sql: 'UPDATE password_reset_tokens SET used = 1 WHERE token = ?',
      args: [token]
    });

    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (err: any) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal error resetting password.' });
  }
});

// ── POST /console/auth/setup_security_questions ───────────────────────────────
// Stores hashed security question + answer for the authenticated user
app.post('/console/auth/setup_security_questions', async (req, res) => {
  const { question, answer } = req.body;
  const userId = req.user?.userId;

  if (!question || !answer || !userId) {
    res.status(400).json({ error: 'question, answer, and a valid session are required.' });
    return;
  }

  try {
    const questionHash = crypto.createHash('sha256').update(question.trim().toLowerCase()).digest('hex');
    const answerHash = crypto.createHash('sha256').update(answer.trim().toLowerCase()).digest('hex');
    const updatedAt = new Date().toISOString();

    await vaultDb.execute({
      sql: `INSERT OR IGNORE INTO security_questions (user_id, question_hash, answer_hash, updated_at)
            VALUES (?, ?, ?, ?)`,
      args: [userId, questionHash, answerHash, updatedAt]
    });

    // Also update if already exists
    await vaultDb.execute({
      sql: 'UPDATE security_questions SET question_hash = ?, answer_hash = ?, updated_at = ? WHERE user_id = ?',
      args: [questionHash, answerHash, updatedAt, userId]
    });

    res.json({ success: true, message: 'Security question saved.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /v1/auth/verify_security_question ─────────────────────────────────────
// Validates answer to security question (used in step-2 password reset flow)
app.post('/v1/auth/verify_security_question', async (req, res) => {
  const { username, answer } = req.body;
  if (!username || !answer) {
    res.status(400).json({ error: 'username and answer are required.' });
    return;
  }

  try {
    const userResult = await vaultDb.execute({
      sql: 'SELECT id FROM users WHERE username = ?',
      args: [username]
    });

    if (userResult.rows.length === 0) {
      res.status(401).json({ error: 'Verification failed.' });
      return;
    }

    const userId = (userResult.rows[0] as any).id;
    const answerHash = crypto.createHash('sha256').update(answer.trim().toLowerCase()).digest('hex');

    const sqResult = await vaultDb.execute({
      sql: 'SELECT * FROM security_questions WHERE user_id = ? AND answer_hash = ?',
      args: [userId, answerHash]
    });

    if (sqResult.rows.length === 0) {
      res.status(401).json({ error: 'Verification failed. Incorrect answer.' });
      return;
    }

    // Issue a short-lived token scoped only for password reset
    const { signJwt } = await import('./auth_routes');
    const resetJwt = signJwt({ userId, purpose: 'password_reset' }, 900); // 15 min
    res.json({ success: true, reset_token: resetJwt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public partner registration route & pre-onboarding connection test
app.post('/v1/banks/test_connection', async (req, res) => {
  const { connector_type, url, method, headers: reqHeaders, body_template } = req.body;
  if (!connector_type) {
    res.status(400).json({ error: 'connector_type is required.' });
    return;
  }
  if (connector_type === 'http_callback') {
    if (!url) {
      res.status(400).json({ error: 'url is required for http_callback connector.' });
      return;
    }
    try {
      const start = Date.now();
      const response = await fetch(url, {
        method: method || 'POST',
        headers: { 'Content-Type': 'application/json', ...(reqHeaders || {}) },
        body: JSON.stringify(body_template || { test: true, source: 'payrail_connection_test' }),
        signal: AbortSignal.timeout(8000)
      });
      const latency = Date.now() - start;
      res.json({
        ok: response.ok || response.status < 500,
        http_status: response.status,
        latency_ms: latency,
        message: response.ok
          ? `Endpoint reachable. HTTP ${response.status} in ${latency}ms.`
          : `Endpoint returned HTTP ${response.status} in ${latency}ms.`
      });
    } catch (e: any) {
      res.json({ ok: false, latency_ms: 8000, message: `Connection failed: ${e.message}` });
    }
    return;
  }
  if (connector_type === 'web3_rpc') {
    if (!url) {
      res.status(400).json({ error: 'url (RPC node URL) is required for web3_rpc connector.' });
      return;
    }
    try {
      const start = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: AbortSignal.timeout(8000)
      });
      const latency = Date.now() - start;
      const data = await response.json() as any;
      const blockNumber = data?.result ? parseInt(data.result, 16) : null;
      res.json({
        ok: !!blockNumber,
        latency_ms: latency,
        block_number: blockNumber,
        message: blockNumber
          ? `RPC node reachable. Current block: #${blockNumber.toLocaleString()} (${latency}ms).`
          : 'RPC node responded with unexpected format.'
      });
    } catch (e: any) {
      res.json({ ok: false, latency_ms: 8000, message: `RPC connection failed: ${e.message}` });
    }
    return;
  }
  res.status(400).json({ error: `Unknown connector_type: ${connector_type}.` });
});

app.post('/v1/partners/register', async (req, res) => {
  const {
    legal_name, bic_code, contact_email, country = 'US',
    firm_type = 'private', services_requested = [], public_key_pem
  } = req.body;

  if (!legal_name || !contact_email) {
    res.status(400).json({ error: 'legal_name and contact_email are required.' });
    return;
  }

  try {
    const { v4: uuidv4 } = await import('uuid');
    const tenantId = uuidv4();
    const routingCode = (bic_code || `PAYR${legal_name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}XX`).toUpperCase();
    const now = new Date().toISOString();

    await railDb.execute({
      sql: `INSERT OR IGNORE INTO tenants
              (id, legal_name, routing_code, public_key_pem, api_status, created_at)
            VALUES (?, ?, ?, ?, 'active', ?)`,
      args: [tenantId, legal_name, routingCode, public_key_pem || contact_email, now]
    });

    const clearingAccountId = `acc_clearing_${routingCode.toLowerCase()}`;
    await railDb.execute({
      sql: `INSERT OR IGNORE INTO accounts (id, tenant_id, name, type, category, currency, balance, status, created_at)
            VALUES (?, ?, ?, 'asset', 'bank', 'USD', 0, 'active', ?)`,
      args: [clearingAccountId, tenantId, `${legal_name} Primary Clearing`, now]
    });

    const fsId = `fs_${routingCode.toLowerCase()}`;
    await railDb.execute({
      sql: `INSERT OR IGNORE INTO funding_sources (id, name, type, account_id, priority, status, connector_type, created_at)
            VALUES (?, ?, 'bank', ?, 1, 'active', 'http_callback', ?)`,
      args: [fsId, `${legal_name} Core Connector`, clearingAccountId, now]
    });

    const allServices = [
      'fx_conversion', 'aml_screening', 'otp_verification', 'card_issuance',
      'ach_wire', 'crypto_wallets', 'credit_bureau', 'settlement_clearing', 'payment_intents'
    ];
    const serviceList = services_requested.length > 0 ? services_requested : allServices;
    for (const svcId of serviceList) {
      await railDb.execute({
        sql: `INSERT OR IGNORE INTO partner_services (tenant_id, service_id, status, activated_at)
              VALUES (?, ?, 'active', ?)`,
        args: [tenantId, svcId, now]
      });
    }

    const { generateApiKey } = await import('./auth');
    const apiKeyResult = await generateApiKey(`${legal_name} Default Key`, tenantId);

    await createNotification(
      systemTenantId,
      'New Partner Registered',
      `${legal_name} (${country}, ${firm_type}) joined the Payrail network. ${serviceList.length} services activated.`,
      'success'
    );

    res.status(201).json({
      success: true,
      partner: {
        tenant_id: tenantId,
        legal_name,
        routing_code: routingCode,
        clearing_account_id: clearingAccountId,
        country,
        firm_type,
        status: 'active',
        joined_at: now
      },
      api_key: {
        key: apiKeyResult.rawKey,
        prefix: apiKeyResult.key.prefix,
        note: 'Store this key securely — it will not be shown again. Use it as: Authorization: Bearer <key>'
      },
      services_activated: serviceList,
      welcome_message: `Welcome to the Payrail network, ${legal_name}! You now have access to ${serviceList.length} financial services. Call GET /v1/services/catalog to explore what's available.`
    });
  } catch (err: any) {
    res.status(500).json({ error: `Partner registration failed: ${err.message}` });
  }
});

// Secure Stripe-like Gateway Router
app.use('/v1', authenticateGateway, gatewayRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend static assets in production
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// Fallback all other routes to index.html for React SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Seeding function
export async function seedDatabase() {
  const now = new Date().toISOString();
  // Seed default platform API key if not exists (used by clearinghouse console)
  const rawDevKey = 'sk_live_dev_key_12345';
  const hashedDevKey = crypto.createHash('sha256').update(rawDevKey).digest('hex');

  // Seed into vault (no tenant context needed)
  await vaultDb.execute({
    sql: `INSERT OR IGNORE INTO api_keys (id, key_hash, prefix, name, status, created_at)
          VALUES ('key_default_dev', ?, 'sk_live_', 'Platform Clearinghouse Key', 'active', ?)`,
    args: [hashedDevKey, now],
  });

  if (!railDb.isPostgres) {
    await railDb.execute({
      sql: `INSERT OR IGNORE INTO synced_api_keys (id, tenant_id, key_hash, prefix, name, status, created_at)
            VALUES ('key_default_dev', ?, ?, 'sk_live_', 'Platform Clearinghouse Key', 'active', ?)`,
      args: [systemTenantId, hashedDevKey, now],
    });
  } else {
    // On Nile Postgres, primary key columns cannot be NULL. Seed with systemTenantId.
    await railDb.execute({
      sql: `INSERT INTO synced_api_keys (id, tenant_id, key_hash, prefix, name, status, created_at)
            VALUES ('key_default_dev', ?, ?, 'sk_live_', 'Platform Clearinghouse Key', 'active', ?)
            ON CONFLICT (id, tenant_id) DO NOTHING`,
      args: [systemTenantId, hashedDevKey, now],
    });
  }

  // Seed default system settlement & merchant accounts so immediate API tests work out of the box
  await railDb.execute({
    sql: `INSERT OR IGNORE INTO accounts (id, tenant_id, name, type, category, currency, balance, status, created_at)
          VALUES ('acc_merchant_usd', ?, 'Merchant Settlement Wallet (USD)', 'asset', 'wallet', 'USD', 0, 'active', ?)`,
    args: [systemTenantId, now],
  });

  await railDb.execute({
    sql: `INSERT OR IGNORE INTO accounts (id, tenant_id, name, type, category, currency, balance, status, created_at)
          VALUES ('acc_system_equity_usd', ?, 'System Capital Equity (USD)', 'equity', 'equity', 'USD', 0, 'active', ?)`,
    args: [systemTenantId, now],
  });

  console.log('Database initialization completed.');
}

// Start Server
async function start() {
  try {
    await initDb();
    await seedDatabase();
    // Warm up live U.S. Treasury OFAC SDN list in background on startup
    ensureSdnLoaded().catch(() => {});
    const HOST = process.env.HOST || '0.0.0.0';
    app.listen(parseInt(PORT as string), HOST, () => {
      console.log(`=============================================================`);
      console.log(`  PAYMENT RAIL CORE SERVER STARTED ON http://${HOST}:${PORT}`);
      console.log(`=============================================================`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
