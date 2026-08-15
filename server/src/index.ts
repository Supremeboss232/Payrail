import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as path from 'path';
import { initDb, vaultDb, railDb, systemTenantId, executeWithTenant, createNotification } from './db';
import { createAccount, getAccounts, getTransactions, getTransactionEntries, getAccountHistory, postTransaction } from './ledger';
import { authenticateApiKey, authenticateGateway, getApiKeys, revokeApiKey, generateApiKey, authenticateJwt } from './auth';
import { getWebhookEndpoints, createWebhookEndpoint, deleteWebhookEndpoint, getWebhookLogs } from './webhooks';
import { getComplianceStatus } from './compliance';
import gatewayRouter from './gateway';
import authRouter from './auth_routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 9500;

app.use(cors());
app.use(express.json());

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
        const entries = await getTransactionEntries(tx.id);
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
      if (railDb.isPostgres) {
        sql += ' WHERE tenant_id = ?';
      } else {
        // Fallback SQLite doesn't have tenant_id in funding_sources, but we can filter it or mock
        sql += ' WHERE account_id IN (SELECT id FROM accounts WHERE tenant_id = ?)';
      }
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
          sql: railDb.isPostgres
            ? 'SELECT id, connector_type, status, priority FROM funding_sources WHERE tenant_id = ? ORDER BY priority ASC LIMIT 1'
            : 'SELECT id, connector_type, status, priority FROM funding_sources WHERE account_id = ? ORDER BY priority ASC LIMIT 1',
          args: [railDb.isPostgres ? tenant.id : (clearingAccount?.id || '')]
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

app.post('/console/funding_sources', async (req, res) => {
  const { name, type, account_id, priority = 0 } = req.body;
  if (!name || !type || !account_id) {
    res.status(400).json({ error: 'name, type, and account_id are required.' });
    return;
  }
  const id = `fs_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const createdAt = new Date().toISOString();
  try {
    const tenantId = (req.user?.role === 'member' && req.user.tenantId) ? req.user.tenantId : systemTenantId;
    const accResult = await railDb.execute({
      sql: 'SELECT id FROM accounts WHERE id = ?',
      args: [account_id],
    });
    if (accResult.rows.length === 0) {
      res.status(400).json({ error: `Account ${account_id} not found.` });
      return;
    }
    if (railDb.isPostgres) {
      await railDb.execute({
        sql: `INSERT INTO funding_sources (id, tenant_id, name, type, account_id, priority, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
        args: [id, tenantId, name, type, account_id, priority, createdAt],
      });
    } else {
      await railDb.execute({
        sql: `INSERT INTO funding_sources (id, name, type, account_id, priority, status, created_at)
              VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        args: [id, name, type, account_id, priority, createdAt],
      });
    }
    res.status(201).json({ id, name, type, account_id, priority, status: 'active', created_at: createdAt });
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
  const { accountId, amount, currency } = req.body;
  try {
    const tenantId = (req.user?.role === 'member' && req.user.tenantId) ? req.user.tenantId : systemTenantId;
    const systemEquity = `acc_system_equity_${currency.toLowerCase()}`;
    
    if (railDb.isPostgres) {
      await railDb.execute({
        sql: `INSERT OR IGNORE INTO accounts (id, tenant_id, name, type, category, currency, balance, status, created_at)
              VALUES (?, ?, ?, 'equity', 'equity', ?, 0, 'active', ?)`,
        args: [systemEquity, tenantId, `System Capital Equity (${currency.toUpperCase()})`, currency.toUpperCase(), new Date().toISOString()],
      });
    } else {
      await railDb.execute({
        sql: `INSERT OR IGNORE INTO accounts (id, name, type, category, currency, balance, status, created_at)
              VALUES (?, ?, 'equity', 'equity', ?, 0, 'active', ?)`,
        args: [systemEquity, `System Capital Equity (${currency.toUpperCase()})`, currency.toUpperCase(), new Date().toISOString()],
      });
    }

    const tx = await postTransaction(
      `Console treasury liquidity deposit to ${accountId}`,
      'console',
      [
        { accountId, type: 'debit', amount, currency },
        { accountId: systemEquity, type: 'credit', amount, currency },
      ],
      `dep_${accountId}_${Date.now()}`,
      null,
      tenantId
    );
    await createNotification(
      tenantId,
      'Treasury Liquidity Deposited',
      `Direct treasury liquidity deposit of $${(amount / 100).toFixed(2)} ${currency.toUpperCase()} deposited to account ${accountId}.`,
      'success'
    );
    res.json({ success: true, message: 'Treasury liquidity deposited successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /v1/fx/rates ─────────────────────────────────────────────────────────
// Returns live currency exchange rates from Fixer.io
const fxRateCache: { rates: any; base: string; timestamp: number } = { rates: null, base: '', timestamp: 0 };
const FX_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

app.get('/v1/fx/rates', async (req, res) => {
  const base = (req.query.base as string || 'USD').toUpperCase();
  const symbols = req.query.symbols as string | undefined;
  const apiKey = process.env.FIXER_IO_API_KEY;

  if (!apiKey) {
    res.status(503).json({
      status: 'pending_configuration',
      message: 'FX rates require a Fixer.io API key. Set FIXER_IO_API_KEY in your .env file.',
      provider: 'Fixer.io',
      signup_url: 'https://fixer.io/product'
    });
    return;
  }

  // Serve from cache if fresh
  if (fxRateCache.rates && fxRateCache.base === base && Date.now() - fxRateCache.timestamp < FX_CACHE_TTL_MS) {
    const cached = symbols
      ? Object.fromEntries(symbols.split(',').map(s => [s.trim().toUpperCase(), fxRateCache.rates[s.trim().toUpperCase()]]).filter(([, v]) => v !== undefined))
      : fxRateCache.rates;
    res.json({ base, rates: cached, source: 'fixer.io', cached: true, timestamp: new Date(fxRateCache.timestamp).toISOString() });
    return;
  }

  try {
    const symbolParam = symbols ? `&symbols=${symbols}` : '';
    const response = await fetch(`https://data.fixer.io/api/latest?access_key=${apiKey}&base=${base}${symbolParam}`);
    const data = await response.json() as any;

    if (!data.success) {
      res.status(502).json({ error: `Fixer.io error: ${data.error?.info || 'Unknown'}` });
      return;
    }

    fxRateCache.rates = data.rates;
    fxRateCache.base = base;
    fxRateCache.timestamp = Date.now();

    res.json({
      base: data.base,
      rates: data.rates,
      source: 'fixer.io',
      cached: false,
      timestamp: new Date(data.timestamp * 1000).toISOString()
    });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to fetch FX rates: ${err.message}` });
  }
});

// ── GET /v1/crypto/status ─────────────────────────────────────────────────────
// Returns live block number from configured RPC node
app.get('/v1/crypto/status', async (req, res) => {
  const rpcUrl = process.env.CRYPTO_RPC_URL;

  if (!rpcUrl) {
    res.status(503).json({
      status: 'pending_configuration',
      message: 'Crypto rail requires a Web3 RPC URL. Set CRYPTO_RPC_URL in your .env file.',
      providers: ['Alchemy (https://www.alchemy.com)', 'Infura (https://infura.io)', 'QuickNode (https://www.quicknode.com)']
    });
    return;
  }

  try {
    const start = Date.now();
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(5000)
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
  const hasCryptoRpc = !!process.env.CRYPTO_RPC_URL;
  const hasMarqeta = !!process.env.MARQETA_BASE_URL;
  const hasAchSponsor = !!process.env.ACH_ROUTING_NUMBER;
  const hasEquifax = !!process.env.EQUIFAX_CLIENT_ID;
  const complianceInfo = getComplianceStatus();

  res.json({
    timestamp: new Date().toISOString(),
    providers: {
      fx_rates: {
        name: 'FX Exchange Rates',
        status: hasFixerKey ? 'active' : 'pending_configuration',
        engine: 'Fixer.io',
        configured: hasFixerKey,
        setup_url: 'https://fixer.io/product',
        cost: '$14/month'
      },
      email_otp: {
        name: 'Email OTP / Transactional Email',
        status: hasSendGrid ? 'active' : 'pending_configuration',
        engine: 'SendGrid',
        configured: hasSendGrid,
        setup_url: 'https://sendgrid.com',
        cost: 'Free tier available'
      },
      aml_screening: {
        name: 'AML / OFAC Compliance Screening',
        status: 'active',
        engine: hasComplyAdvantage ? 'ComplyAdvantage' : 'OFAC Local SDN List (Free)',
        configured: true,
        sdn_entries_cached: complianceInfo.sdnEntriesCached,
        last_refreshed: complianceInfo.lastRefreshed,
        upgrade_url: 'https://complyadvantage.com',
      },
      crypto_rails: {
        name: 'Crypto / Web3 Payment Rail',
        status: hasCryptoRpc ? 'active' : 'pending_configuration',
        engine: 'EVM / Ethers.js',
        configured: hasCryptoRpc,
        setup_url: 'https://www.alchemy.com',
        cost: 'Free tier available'
      },
      card_issuance: {
        name: 'Card Issuance',
        status: hasMarqeta ? 'active' : 'contract_required',
        engine: hasMarqeta ? 'Marqeta' : null,
        configured: hasMarqeta,
        setup_url: 'https://www.marqeta.com',
        cost: '$10K–$50K setup + interchange',
        timeline: '3–6 months after contract signing'
      },
      ach_wire: {
        name: 'ACH / Wire Payment Rails',
        status: hasAchSponsor ? 'active' : 'sponsorship_required',
        engine: hasAchSponsor ? 'Fed ACH' : null,
        configured: hasAchSponsor,
        setup_url: 'https://www.federalreserve.gov/paymentsystems/fedach_frservices.htm',
        cost: 'Requires Federal Reserve sponsorship agreement'
      },
      credit_bureau: {
        name: 'Credit Bureau Soft Pull',
        status: hasEquifax ? 'active' : 'contract_required',
        engine: hasEquifax ? 'Equifax' : null,
        configured: hasEquifax,
        setup_url: 'https://developer.equifax.com',
        cost: 'Enterprise contract required'
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
    }
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
      const resetUrl = `${process.env.APP_BASE_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
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
    } else {
      // No SendGrid — log token for debugging in non-production
      console.log(`[Auth] SENDGRID_API_KEY not set. Reset token for ${username}: ${token}`);
    }

    res.json({ success: true, message: 'If that username exists, a reset link has been sent.' });
  } catch (err: any) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Internal error processing password reset.' });
  }
});

// ── POST /v1/auth/reset_password ──────────────────────────────────────────────
// Validates DB token and updates the hashed password
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

    const { hashPassword } = await import('./db');
    const newHash = hashPassword(new_password);

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
  // Seed default platform API key if not exists (used by clearinghouse console)
  const rawDevKey = 'sk_live_dev_key_12345';
  const hashedDevKey = crypto.createHash('sha256').update(rawDevKey).digest('hex');

  // Seed into vault (no tenant context needed)
  await vaultDb.execute({
    sql: `INSERT OR IGNORE INTO api_keys (id, key_hash, prefix, name, status, created_at)
          VALUES ('key_default_dev', ?, 'sk_live_', 'Platform Clearinghouse Key', 'active', ?)`,
    args: [hashedDevKey, new Date().toISOString()],
  });

  if (!railDb.isPostgres) {
    await railDb.execute({
      sql: `INSERT OR IGNORE INTO synced_api_keys (id, key_hash, prefix, name, status, created_at)
            VALUES ('key_default_dev', ?, 'sk_live_', 'Platform Clearinghouse Key', 'active', ?)`,
      args: [hashedDevKey, new Date().toISOString()],
    });
  } else {
    // On Nile Postgres, primary key columns cannot be NULL. Seed with systemTenantId.
    await railDb.execute({
      sql: `INSERT INTO synced_api_keys (id, tenant_id, key_hash, prefix, name, status, created_at)
            VALUES ('key_default_dev', ?, ?, 'sk_live_', 'Platform Clearinghouse Key', 'active', ?)
            ON CONFLICT (id, tenant_id) DO NOTHING`,
      args: [systemTenantId, hashedDevKey, new Date().toISOString()],
    });
  }

  console.log('Database initialization completed.');
}

// Start Server
async function start() {
  try {
    await initDb();
    await seedDatabase();
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
