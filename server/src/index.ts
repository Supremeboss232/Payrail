import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import { initDb, db } from './db';
import { createAccount, getAccounts, getTransactions, getTransactionEntries, getAccountHistory, postTransaction } from './ledger';
import { authenticateApiKey, getApiKeys, revokeApiKey, generateApiKey } from './auth';
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
app.use('/v1', authenticateApiKey, gatewayRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Seeding function
export async function seedDatabase() {
  const accountCount = await db.execute('SELECT COUNT(*) as count FROM accounts');
  const count = (accountCount.rows[0] as any).count;

  if (count > 0) {
    console.log('Database already seeded. Skipping initial seed.');
    return;
  }

  console.log('Seeding initial ledger accounts...');

  // 1. Create Merchant Destination Account
  await createAccount('acc_merchant_usd', 'Merchant Cash Drawer', 'asset', 'wallet', 'USD', 0);

  // 2. Create the 7 Online Banks (Assets with initial seeded balances)
  await createAccount('acc_bank_chase', 'Chase Business Checking', 'asset', 'bank', 'USD', 1250000); // $12,500.00
  await createAccount('acc_bank_wellsfargo', 'Wells Fargo Treasury', 'asset', 'bank', 'USD', 850000);  // $8,500.00
  await createAccount('acc_bank_revolut', 'Revolut Business Euro', 'asset', 'bank', 'EUR', 1500000); // €15,000.00
  await createAccount('acc_bank_wise', 'Wise Multi-Currency Wallet', 'asset', 'bank', 'USD', 500000);  // $5,000.00
  await createAccount('acc_bank_monzo', 'Monzo Business Reserve', 'asset', 'bank', 'GBP', 2000000); // £20,000.00
  await createAccount('acc_bank_n26', 'N26 Metal Account', 'asset', 'bank', 'EUR', 300000);  // €3,000.00
  await createAccount('acc_bank_mercury', 'Mercury Startup Checking', 'asset', 'bank', 'USD', 0);       // $0.00 (failover target)

  // 3. Create Brokers (Asset cash accounts)
  await createAccount('acc_broker_ibkr', 'Interactive Brokers Cash', 'asset', 'broker_cash', 'USD', 5000000); // $50,000.00
  await createAccount('acc_broker_robinhood', 'Robinhood Retail Cash', 'asset', 'broker_cash', 'USD', 250000); // $2,500.00

  // 4. Create Logistics accounts (Liabilities)
  await createAccount('acc_logistics_dhl', 'DHL Accounts Payable', 'liability', 'logistics', 'USD', 0);
  await createAccount('acc_logistics_fedex', 'FedEx Accounts Payable', 'liability', 'logistics', 'USD', 0);

  console.log('Seeding initial funding sources...');
  // Configure funding sources with priority rankings
  const fsSeed = [
    { id: 'fs_chase', name: 'Chase Checking', type: 'bank', accountId: 'acc_bank_chase', priority: 1 },
    { id: 'fs_wellsfargo', name: 'Wells Fargo Treasury', type: 'bank', accountId: 'acc_bank_wellsfargo', priority: 2 },
    { id: 'fs_wise', name: 'Wise Multi-Currency', type: 'bank', accountId: 'acc_bank_wise', priority: 3 },
    { id: 'fs_revolut', name: 'Revolut Business', type: 'bank', accountId: 'acc_bank_revolut', priority: 4 },
    { id: 'fs_ibkr', name: 'Interactive Brokers Cash', type: 'broker', accountId: 'acc_broker_ibkr', priority: 5 },
    { id: 'fs_robinhood', name: 'Robinhood Cash', type: 'broker', accountId: 'acc_broker_robinhood', priority: 6 },
    { id: 'fs_mercury', name: 'Mercury Startup Checking', type: 'bank', accountId: 'acc_bank_mercury', priority: 7 },
  ];

  for (const fs of fsSeed) {
    await db.execute({
      sql: `INSERT INTO funding_sources (id, name, type, account_id, priority, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      args: [fs.id, fs.name, fs.type, fs.accountId, fs.priority, new Date().toISOString()],
    });
  }

  console.log('Seeding default API Key: sk_live_dev_key_12345...');
  // Seed a default developer API key so it works out of the box
  const rawDevKey = 'sk_live_dev_key_12345';
  const hashedDevKey = crypto.createHash('sha256').update(rawDevKey).digest('hex');
  await db.execute({
    sql: `INSERT INTO api_keys (id, key_hash, prefix, name, status, created_at)
          VALUES ('key_default_dev', ?, 'sk_live_', 'Default Developer Key', 'active', ?)`,
    args: [hashedDevKey, new Date().toISOString()],
  });

  console.log('Seeding completed.');
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
