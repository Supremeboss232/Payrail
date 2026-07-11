import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as path from 'path';
import { initDb, db } from './db';
import { createAccount, getAccounts, getTransactions, getTransactionEntries, getAccountHistory, postTransaction } from './ledger';
import { authenticateApiKey, authenticateGateway, getApiKeys, revokeApiKey, generateApiKey } from './auth';
import { getWebhookEndpoints, createWebhookEndpoint, deleteWebhookEndpoint, getWebhookLogs } from './webhooks';
import gatewayRouter from './gateway';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 9500;

app.use(cors());
app.use(express.json());

// Console API Endpoints (For local Dashboard visualization and control)
app.get('/console/accounts', async (req, res) => {
  try {
    const accounts = await getAccounts();
    res.json(accounts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/console/accounts', async (req, res) => {
  const { id, name, type, category, currency, initialBalance = 0 } = req.body;
  try {
    const account = await createAccount(
      id,
      name,
      type,
      category,
      currency,
      parseInt(initialBalance)
    );
    res.status(201).json(account);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/console/accounts/:id/history', async (req, res) => {
  try {
    const history = await getAccountHistory(req.params.id);
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/console/transactions', async (req, res) => {
  try {
    const txs = await getTransactions();
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
    const result = await db.execute('SELECT * FROM funding_sources ORDER BY priority ASC');
    res.status(200).json(result.rows);
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
    const accResult = await db.execute({
      sql: 'SELECT id FROM accounts WHERE id = ?',
      args: [account_id],
    });
    if (accResult.rows.length === 0) {
      res.status(400).json({ error: `Account ${account_id} not found.` });
      return;
    }
    await db.execute({
      sql: `INSERT INTO funding_sources (id, name, type, account_id, priority, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      args: [id, name, type, account_id, priority, createdAt],
    });
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
      await db.execute({
        sql: 'UPDATE funding_sources SET priority = ? WHERE id = ?',
        args: [priority, id],
      });
    }
    if (status !== undefined) {
      await db.execute({
        sql: 'UPDATE funding_sources SET status = ? WHERE id = ?',
        args: [status, id],
      });
    }
    const updated = await db.execute({
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
    const keys = await getApiKeys();
    res.json(keys);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/console/api_keys', async (req, res) => {
  try {
    const { name } = req.body;
    const result = await generateApiKey(name || 'Custom Console Key');
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
    const endpoints = await getWebhookEndpoints();
    res.json(endpoints);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/console/webhook_endpoints', async (req, res) => {
  try {
    const { url, events } = req.body;
    const endpoint = await createWebhookEndpoint(url, events);
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
    const logs = await getWebhookLogs();
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Seed API endpoint for easy resetting/triggering
app.post('/console/seed_funds', async (req, res) => {
  const { accountId, amount, currency } = req.body;
  try {
    const systemEquity = `acc_system_equity_${currency.toLowerCase()}`;
    await db.execute({
      sql: `INSERT OR IGNORE INTO accounts (id, name, type, category, currency, balance, status, created_at)
            VALUES (?, ?, 'equity', 'equity', ?, 0, 'active', ?)`,
      args: [systemEquity, `System Capital Equity (${currency.toUpperCase()})`, currency.toUpperCase(), new Date().toISOString()],
    });

    await postTransaction(
      `Console manual deposit to ${accountId}`,
      'console',
      [
        { accountId, type: 'debit', amount, currency },
        { accountId: systemEquity, type: 'credit', amount, currency },
      ]
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
    await db.execute({
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
  const accountCount = await db.execute('SELECT COUNT(*) as count FROM accounts');
  const count = (accountCount.rows[0] as any).count;

  if (count > 0) {
    console.log('Database already initialized. Skipping seed.');
    return;
  }

  console.log('Initializing database schema defaults...');

  // 1. Create Merchant Destination Account (baseline destination)
  await createAccount('acc_merchant_usd', 'Merchant Cash Drawer', 'asset', 'wallet', 'USD', 0);

  console.log('Seeding default API Key: sk_live_dev_key_12345...');
  // Seed a default developer API key so the API playground works out of the box
  const rawDevKey = 'sk_live_dev_key_12345';
  const hashedDevKey = crypto.createHash('sha256').update(rawDevKey).digest('hex');
  await db.execute({
    sql: `INSERT INTO api_keys (id, key_hash, prefix, name, status, created_at)
          VALUES ('key_default_dev', ?, 'sk_live_', 'Default Developer Key', 'active', ?)`,
    args: [hashedDevKey, new Date().toISOString()],
  });

  console.log('Database initialization completed.');
}

// Start Server
async function start() {
  try {
    await initDb();
    await seedDatabase();
    app.listen(PORT, () => {
      console.log(`=============================================================`);
      console.log(`  PAYMENT RAIL CORE SERVER STARTED ON http://localhost:${PORT}`);
      console.log(`  Default API Key available: sk_live_dev_key_12345`);
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
