import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as path from 'path';
import { initDb, vaultDb, railDb, systemTenantId, executeWithTenant, createNotification } from './db';
import { createAccount, getAccounts, getTransactions, getTransactionEntries, getAccountHistory, postTransaction } from './ledger';
import { authenticateApiKey, authenticateGateway, getApiKeys, revokeApiKey, generateApiKey, authenticateJwt } from './auth';
import { getWebhookEndpoints, createWebhookEndpoint, deleteWebhookEndpoint, getWebhookLogs } from './webhooks';
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
      `Console manual deposit to ${accountId}`,
      'console',
      [
        { accountId, type: 'debit', amount, currency },
        { accountId: systemEquity, type: 'credit', amount, currency },
      ],
      `seed_${accountId}_${Date.now()}`,
      null,
      tenantId
    );
    await createNotification(
      tenantId,
      'Mock Funds Injected',
      `Successfully deposited $${(amount / 100).toFixed(2)} ${currency.toUpperCase()} to account ${accountId}.`,
      'success'
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Simulate Logistics Shipment Invoicing (creating a liability)
app.post('/console/simulate_logistics_invoice', async (req, res) => {
  const { providerId, amount, description } = req.body; // e.g. acc_logistics_dhl
  try {
    // Expense increases (debit), Accounts Payable increases (credit)
    const expenseAccount = 'acc_expense_logistics';
    await railDb.execute({
      sql: `INSERT OR IGNORE INTO accounts (id, name, type, category, currency, balance, status, created_at)
            VALUES (?, 'Logistics Costs Expense', 'expense', 'logistics', 'USD', 0, 'active', ?)`,
      args: [expenseAccount, new Date().toISOString()],
    });

    const tx = await postTransaction(
      description || `Logistics Invoice received from DHL`,
      'system',
      [
        { accountId: expenseAccount, type: 'debit', amount, currency: 'USD' },
        { accountId: providerId, type: 'credit', amount, currency: 'USD' },
      ]
    );

    res.json({ success: true, transaction: tx });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Clear Logistics Liability (Pay invoice from a bank account)
app.post('/console/pay_logistics_invoice', async (req, res) => {
  const { providerId, bankAccountId, amount } = req.body;
  try {
    // Accounts Payable decreases (debit), Bank Asset decreases (credit)
    const tx = await postTransaction(
      `Pay logistics invoice to DHL via Bank Account`,
      'console',
      [
        { accountId: providerId, type: 'debit', amount, currency: 'USD' },
        { accountId: bankAccountId, type: 'credit', amount, currency: 'USD' },
      ]
    );
    res.json({ success: true, transaction: tx });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
