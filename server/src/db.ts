import { createClient } from '@libsql/client';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load env configuration
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dbUrl = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, '..', 'payment-rail.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

export let db = createClient({
  url: dbUrl,
  authToken,
});

export async function initDb() {
  console.log('Initializing database at:', dbUrl);

  try {
    // Enable foreign keys
    await db.execute('PRAGMA foreign_keys = ON;');
  } catch (err: any) {
    if (process.env.TURSO_DATABASE_URL) {
      console.warn('⚠️ Turso cloud database could not be reached (offline or sandbox network block).');
      console.warn('⚠️ Falling back to local SQLite file: payment-rail.db');
      const localPath = path.join(__dirname, '..', 'payment-rail.db');
      db = createClient({
        url: `file:${localPath}`,
      });
      await db.execute('PRAGMA foreign_keys = ON;');
    } else {
      throw err;
    }
  }

  // Create tenants table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      legal_name TEXT NOT NULL,
      routing_code TEXT UNIQUE NOT NULL,
      api_status TEXT NOT NULL DEFAULT 'active' CHECK(api_status IN ('active', 'suspended', 'deactivated')),
      webhook_url TEXT,
      public_key_pem TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Create accounts table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
      category TEXT NOT NULL CHECK(category IN ('bank', 'broker_cash', 'broker_asset', 'logistics', 'wallet', 'revenue', 'escrow', 'equity')),
      currency TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
    );
  `);

  // Migrate accounts to add tenant_id if it doesn't exist
  try {
    await db.execute("ALTER TABLE accounts ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;");
  } catch (e) {}

  // Create transactions table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      payment_intent_id TEXT,
      description TEXT NOT NULL,
      source_channel TEXT NOT NULL CHECK(source_channel IN ('api', 'console', 'system')),
      reference_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'posted', 'failed')),
      merkle_hash TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
    );
  `);

  // Migrate transactions to add tenant_id and merkle_hash if they don't exist
  try {
    await db.execute("ALTER TABLE transactions ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;");
  } catch (e) {}
  try {
    await db.execute("ALTER TABLE transactions ADD COLUMN merkle_hash TEXT;");
  } catch (e) {}

  // Create entries table (Double-Entry Bookkeeping Line Items)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('debit', 'credit')),
      amount INTEGER NOT NULL CHECK(amount >= 0),
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
  `);

  // Create payment_intents table (Stripe-like Gateway Flow)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('requires_payment_method', 'processing', 'succeeded', 'canceled', 'failed')),
      funding_source_id TEXT,
      destination_account_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (destination_account_id) REFERENCES accounts(id)
    );
  `);

  // Create funding_sources table (Dynamic routing options)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS funding_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('bank', 'broker', 'crypto', 'logistics')),
      account_id TEXT NOT NULL,
      priority INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
  `);

  // Create api_keys table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      created_at TEXT NOT NULL
    );
  `);

  // Create webhook_endpoints table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL, -- JSON array of event names
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
      created_at TEXT NOT NULL
    );
  `);

  // Create webhook_delivery_logs table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      response_status INTEGER,
      response_body TEXT,
      delivered_at TEXT NOT NULL,
      FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id) ON DELETE CASCADE
    );
  `);

  console.log('Database tables verified/created successfully.');
}
