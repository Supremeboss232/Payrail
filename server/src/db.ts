import { createClient } from '@libsql/client';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load env configuration
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Define database connection URLs (fall back to local SQLite files if not provided)
const vaultDbUrl = process.env.TURSO_VAULT_DATABASE_URL || `file:${path.join(__dirname, '..', 'vault.db')}`;
const vaultAuthToken = process.env.TURSO_VAULT_AUTH_TOKEN || undefined;

const railDbUrl = process.env.TURSO_RAIL_DATABASE_URL || process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, '..', 'payment-rail.db')}`;
const railAuthToken = process.env.TURSO_RAIL_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined;

// Export Vault Database Client (OLAP / Management Metadata)
export let vaultDb = createClient({
  url: vaultDbUrl,
  authToken: vaultAuthToken,
});

// Export Core Rail Database Client (OLTP / Transaction Ledger)
export let railDb = createClient({
  url: railDbUrl,
  authToken: railAuthToken,
});

/**
 * Initializes table schemas in both vaultDb and railDb databases.
 */
export async function initDb() {
  console.log('Initializing Vault Database at:', vaultDbUrl);
  console.log('Initializing Core Rail Database at:', railDbUrl);

  // 1. Verify/Fallback Vault Database Client
  try {
    await vaultDb.execute('PRAGMA foreign_keys = ON;');
  } catch (err: any) {
    if (process.env.TURSO_VAULT_DATABASE_URL) {
      console.warn('⚠️ Turso Vault cloud database unreachable. Falling back to local vault.db');
      const localPath = path.join(__dirname, '..', 'vault.db');
      vaultDb = createClient({ url: `file:${localPath}` });
      await vaultDb.execute('PRAGMA foreign_keys = ON;');
    } else {
      throw err;
    }
  }

  // 2. Verify/Fallback Core Rail Database Client
  try {
    await railDb.execute('PRAGMA foreign_keys = ON;');
  } catch (err: any) {
    if (process.env.TURSO_DATABASE_URL || process.env.TURSO_RAIL_DATABASE_URL) {
      console.warn('⚠️ Turso Core Rail cloud database unreachable. Falling back to local payment-rail.db');
      const localPath = path.join(__dirname, '..', 'payment-rail.db');
      railDb = createClient({ url: `file:${localPath}` });
      await railDb.execute('PRAGMA foreign_keys = ON;');
    } else {
      throw err;
    }
  }

  // ==========================================
  // VAULT DATABASE SCHEMAS
  // ==========================================

  // Create api_keys table
  await vaultDb.execute(`
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
  await vaultDb.execute(`
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
  await vaultDb.execute(`
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

  // ==========================================
  // CORE RAIL DATABASE SCHEMAS
  // ==========================================

  // Create tenants table
  await railDb.execute(`
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
  await railDb.execute(`
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
    await railDb.execute("ALTER TABLE accounts ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;");
  } catch (e) {}

  // Create transactions table
  await railDb.execute(`
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
    await railDb.execute("ALTER TABLE transactions ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;");
  } catch (e) {}
  try {
    await railDb.execute("ALTER TABLE transactions ADD COLUMN merkle_hash TEXT;");
  } catch (e) {}

  // Create entries table (Double-Entry Bookkeeping Line Items)
  await railDb.execute(`
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
  await railDb.execute(`
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
  await railDb.execute(`
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

  // Create synced_api_keys table (Local copy for isolated gateway key checks)
  await railDb.execute(`
    CREATE TABLE IF NOT EXISTS synced_api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      created_at TEXT NOT NULL
    );
  `);

  console.log('Vault Database & Core Rail schemas verified/created successfully.');
}
