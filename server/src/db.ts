import { createClient as createLibsqlClient } from '@libsql/client';
import { Pool, PoolClient } from 'pg';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'payrail-salt-12345').digest('hex');
}

// Load env configuration
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dbDir = process.env.SQLITE_DB_DIR || path.join(__dirname, '..');

// Read database URLs
const vaultDbUrl = process.env.TURSO_VAULT_DATABASE_URL || `file:${path.join(dbDir, 'vault.db')}`;
const vaultAuthToken = process.env.TURSO_VAULT_AUTH_TOKEN || undefined;

const railDbUrl = process.env.POSTGRES_URL || process.env.NILEDB_URL || process.env.TURSO_RAIL_DATABASE_URL || process.env.TURSO_DATABASE_URL || `file:${path.join(dbDir, 'payment-rail.db')}`;
const railAuthToken = process.env.TURSO_RAIL_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined;

// Type definition for abstract database client
export interface DbClient {
  isPostgres: boolean;
  execute(query: string | { sql: string; args?: any[] }, args?: any[]): Promise<{ rows: any[] }>;
  transaction(mode?: 'read' | 'write'): Promise<DbTransaction>;
}

export interface DbTransaction {
  execute(query: string | { sql: string; args?: any[] }, args?: any[]): Promise<{ rows: any[] }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): void;
}

// PostgreSQL Query Translator
function translateToPg(sql: string, args: any[] = []): { sql: string; args: any[] } {
  let pgSql = sql;

  // 1. Handle SQLite dialect differences (INSERT OR IGNORE)
  if (pgSql.includes('INSERT OR IGNORE INTO')) {
    pgSql = pgSql.replace(/INSERT OR IGNORE INTO (\w+)/g, 'INSERT INTO $1');
    if (pgSql.includes('accounts')) {
      pgSql += ' ON CONFLICT (id, tenant_id) DO NOTHING';
    } else if (pgSql.includes('transactions')) {
      pgSql += ' ON CONFLICT (id, tenant_id) DO NOTHING';
    } else if (pgSql.includes('api_keys')) {
      pgSql += ' ON CONFLICT (id) DO NOTHING';
    } else if (pgSql.includes('synced_api_keys')) {
      pgSql += ' ON CONFLICT (id, tenant_id) DO NOTHING';
    } else if (pgSql.includes('tenants')) {
      pgSql += ' ON CONFLICT (id) DO NOTHING';
    } else if (pgSql.includes('notifications')) {
      pgSql += ' ON CONFLICT (id, tenant_id) DO NOTHING';
    }
  }

  // 2. Map SQLite parameter "?" to PostgreSQL positional "$1", "$2"
  let paramIndex = 1;
  pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

  return { sql: pgSql, args };
}

// Concrete LibSQL/SQLite Adapter
class LibsqlDbClient implements DbClient {
  isPostgres = false;
  constructor(private client: any) {}

  async execute(query: string | { sql: string; args?: any[] }, args?: any[]): Promise<{ rows: any[] }> {
    let sqlString = typeof query === 'string' ? query : query.sql;
    let queryArgs = typeof query === 'string' ? args || [] : query.args || [];
    
    // LibSQL execute method accepts object { sql, args }
    const res = await this.client.execute({ sql: sqlString, args: queryArgs });
    return { rows: res.rows };
  }

  async transaction(mode: 'read' | 'write' = 'write'): Promise<DbTransaction> {
    const tx = await this.client.transaction(mode);
    return {
      execute: async (query, args) => {
        let sqlString = typeof query === 'string' ? query : query.sql;
        let queryArgs = typeof query === 'string' ? args || [] : query.args || [];
        const res = await tx.execute({ sql: sqlString, args: queryArgs });
        return { rows: res.rows };
      },
      commit: async () => {
        await tx.commit();
      },
      rollback: async () => {
        await tx.rollback();
      },
      close: () => {
        try {
          tx.close();
        } catch (e) {}
      }
    };
  }
}

// Concrete PostgreSQL Adapter
class PgDbClient implements DbClient {
  isPostgres = true;
  constructor(private pool: Pool) {}

  async execute(query: string | { sql: string; args?: any[] }, args?: any[]): Promise<{ rows: any[] }> {
    const rawSql = typeof query === 'string' ? query : query.sql;
    const rawArgs = typeof query === 'string' ? args || [] : query.args || [];
    const translated = translateToPg(rawSql, rawArgs);

    try {
      const res = await this.pool.query(translated.sql, translated.args);
      return { rows: res.rows };
    } catch (err: any) {
      const isNetworkErr = 
        err.code === 'ENOTFOUND' || 
        err.code === 'ECONNREFUSED' || 
        err.code === 'ETIMEDOUT' || 
        err.message.includes('Connection terminated') ||
        err.message.includes('timeout exceeded') ||
        err.message.includes('getaddrinfo');
        
      if (isNetworkErr) {
        console.warn(`⚠️ PostgreSQL query runtime failure: ${err.message}`);
        console.warn('⚠️ Dynamically failing over to local SQLite database engine.');
        
        const sqliteUrl = `file:${path.join(dbDir, 'payment-rail.db')}`;
        railDb = new LibsqlDbClient(createLibsqlClient({ url: sqliteUrl }));
        systemTenantId = '00000000-0000-0000-0000-000000000000';

        const vaultSqliteUrl = `file:${path.join(dbDir, 'vault.db')}`;
        vaultDb = new LibsqlDbClient(createLibsqlClient({ url: vaultSqliteUrl }));
        
        if ((this as any) === vaultDb) {
          return vaultDb.execute(query, args);
        } else {
          return railDb.execute(query, args);
        }
      }
      throw err;
    }
  }

  async transaction(): Promise<DbTransaction> {
    const client = await this.pool.connect();
    let released = false;
    await client.query('BEGIN');
    return {
      execute: async (query, args) => {
        const rawSql = typeof query === 'string' ? query : query.sql;
        const rawArgs = typeof query === 'string' ? args || [] : query.args || [];
        const translated = translateToPg(rawSql, rawArgs);
        const res = await client.query(translated.sql, translated.args);
        return { rows: res.rows };
      },
      commit: async () => {
        if (!released) {
          try {
            await client.query('COMMIT');
          } finally {
            released = true;
            client.release();
          }
        }
      },
      rollback: async () => {
        if (!released) {
          try {
            await client.query('ROLLBACK');
          } finally {
            released = true;
            client.release();
          }
        }
      },
      close: () => {
        if (!released) {
          released = true;
          client.release();
        }
      }
    };
  }
}

// Global Clients
export let vaultDb: DbClient;
export let railDb: DbClient;
export let systemTenantId = '00000000-0000-0000-0000-000000000000';

export let pgPool: Pool | null = null;

/**
 * Execute a SQL query with Nile tenant context set on a dedicated connection.
 * This is required for writes to tenant-aware tables in Nile Postgres.
 */
export async function executeWithTenant(
  tenantId: string,
  sql: string,
  args: any[] = []
): Promise<{ rows: any[] }> {
  if (!pgPool) throw new Error('Postgres pool not initialized');
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL nile.tenant_id = '${tenantId}'`);
    const res = await client.query(sql, args);
    await client.query('COMMIT');
    return { rows: res.rows };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create a persistent notification (in-app alert).
 * Scopes automatically for Postgres (Nile) or SQLite fallback.
 */
export async function createNotification(
  tenantId: string | null,
  title: string,
  message: string,
  type: 'info' | 'success' | 'warning' | 'error'
): Promise<void> {
  const id = `notif_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const createdAt = new Date().toISOString();
  const activeTenantId = tenantId || systemTenantId;

  try {
    if (railDb.isPostgres) {
      await executeWithTenant(
        activeTenantId,
        `INSERT INTO notifications (id, tenant_id, title, message, type, read, created_at)
         VALUES ($1, $2, $3, $4, $5, 0, $6)`,
        [id, activeTenantId, title, message, type, createdAt]
      );
    } else {
      await railDb.execute({
        sql: `INSERT OR IGNORE INTO notifications (id, title, message, type, read, created_at)
              VALUES (?, ?, ?, ?, 0, ?)`,
        args: [id, title, message, type, createdAt],
      });
    }
  } catch (err: any) {
    console.error('⚠️ createNotification failure:', err.message);
  }
}

// Instantiate client connections
if (vaultDbUrl.startsWith('postgres://') || vaultDbUrl.startsWith('postgresql://')) {
  vaultDb = new PgDbClient(new Pool({ connectionString: vaultDbUrl }));
} else {
  vaultDb = new LibsqlDbClient(createLibsqlClient({ url: vaultDbUrl, authToken: vaultAuthToken }));
}

if (railDbUrl.startsWith('postgres://') || railDbUrl.startsWith('postgresql://')) {
  pgPool = new Pool({ connectionString: railDbUrl, connectionTimeoutMillis: 30000 });
  railDb = new PgDbClient(pgPool);
} else {
  railDb = new LibsqlDbClient(createLibsqlClient({ url: railDbUrl, authToken: railAuthToken }));
}

/**
 * Initializes table schemas in both vaultDb and railDb databases.
 */
export async function initDb() {
  console.log('Initializing Vault Database client...');
  console.log('Initializing Core Rail Database client...');

  // Fallback check for PostgreSQL connection
  if (railDb.isPostgres && pgPool) {
    try {
      await pgPool.query('SELECT 1');
      console.log('✓ Successfully connected to PostgreSQL/Nile database.');
    } catch (e: any) {
      console.warn(`⚠️ PostgreSQL connection failed: ${e.message}`);
      console.warn('⚠️ Falling back to local SQLite database fallback engine.');
      
      const sqliteUrl = `file:${path.join(dbDir, 'payment-rail.db')}`;
      railDb = new LibsqlDbClient(createLibsqlClient({ url: sqliteUrl }));
      systemTenantId = '00000000-0000-0000-0000-000000000000';
    }
  }

  // Setup SQLite settings if applicable
  if (!vaultDb.isPostgres) {
    try {
      await vaultDb.execute('PRAGMA foreign_keys = ON;');
    } catch (e) {
      console.warn('⚠️ Vault SQLite Client PRAGMA setup failed. Continuing...');
    }
  }

  if (!railDb.isPostgres) {
    try {
      await railDb.execute('PRAGMA foreign_keys = ON;');
    } catch (e) {
      console.warn('⚠️ Core Rail SQLite Client PRAGMA setup failed. Continuing...');
    }
  }

  // ==========================================
  // VAULT DATABASE SCHEMAS
  // ==========================================

  // Create api_keys table
  await vaultDb.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT, -- NULL for system keys
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );
  `);

  // Create webhook_endpoints table
  await vaultDb.execute(`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      tenant_id TEXT, -- NULL for system webhooks
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL, -- JSON array of event names
      status TEXT NOT NULL DEFAULT 'active',
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
      delivered_at TEXT NOT NULL
    );
  `);

  // Create users table
  await vaultDb.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT, -- NULL for global clearinghouse admins
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', -- 'admin' or 'member'
      created_at TEXT NOT NULL
    );
  `);

  // Seed default Admin user in VaultDb if not exists
  const adminHash = hashPassword('admin123');
  await vaultDb.execute({
    sql: `INSERT OR IGNORE INTO users (id, tenant_id, username, password_hash, role, created_at)
          VALUES ('user_admin_clearinghouse', NULL, 'admin', ?, 'admin', ?)`,
    args: [adminHash, new Date().toISOString()]
  });

  // ==========================================
  // CORE RAIL DATABASE SCHEMAS
  // ==========================================

  // Create tenants table
  if (railDb.isPostgres) {
    // In Nile, the 'tenants' table is built-in. We add our custom B2B fields to it.
    await railDb.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_name TEXT;');
    await railDb.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS routing_code TEXT;');
    await railDb.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS api_status TEXT;');
    await railDb.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_url TEXT;');
    await railDb.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS public_key_pem TEXT;');
    await railDb.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_at TEXT;');
    try {
      await railDb.execute('ALTER TABLE tenants ADD CONSTRAINT tenants_routing_code_unique UNIQUE (routing_code);');
    } catch (e) {}
  } else {
    await railDb.execute(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        legal_name TEXT NOT NULL,
        routing_code TEXT UNIQUE NOT NULL,
        api_status TEXT NOT NULL DEFAULT 'active',
        webhook_url TEXT,
        public_key_pem TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  // Create accounts table
  await railDb.execute(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT,
      tenant_id UUID,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      currency TEXT NOT NULL,
      balance BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, tenant_id)
    );
  `);

  // Create transactions table
  await railDb.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT,
      tenant_id UUID,
      payment_intent_id TEXT,
      description TEXT NOT NULL,
      source_channel TEXT NOT NULL,
      reference_id TEXT,
      status TEXT NOT NULL,
      merkle_hash TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, tenant_id)
    );
  `);

  if (railDb.isPostgres) {
    try {
      const checkCol = await railDb.execute(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'entries' AND column_name = 'tenant_id'
      `);
      if (checkCol.rows.length === 0) {
        console.warn('⚠️ Migrating entries table to be tenant-aware. Dropping old entries table.');
        await railDb.execute('DROP TABLE IF EXISTS entries;');
      }
    } catch (e: any) {
      console.warn('Failed checking entries column:', e.message);
    }
  }

  // Create entries table (Double-Entry Bookkeeping Line Items)
  await railDb.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT,
      tenant_id UUID,
      transaction_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount BIGINT NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, tenant_id)
    );
  `);

  // Create payment_intents table (Stripe-like Gateway Flow)
  await railDb.execute(`
    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      amount BIGINT NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      funding_source_id TEXT,
      destination_account_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  // Create funding_sources table (Dynamic routing options)
  await railDb.execute(`
    CREATE TABLE IF NOT EXISTS funding_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'bank', 'broker', 'crypto'
      account_id TEXT NOT NULL,
      priority INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      connector_type TEXT NOT NULL DEFAULT 'simulation', -- 'http_callback', 'web3_rpc', 'simulation'
      credentials_encrypted TEXT, -- stores AES-256-GCM encrypted parameters
      created_at TEXT NOT NULL
    );
  `);

  if (railDb.isPostgres) {
    try {
      const checkCol = await railDb.execute(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'synced_api_keys' AND column_name = 'tenant_id'
      `);
      if (checkCol.rows.length === 0) {
        console.warn('⚠️ Migrating synced_api_keys table to be tenant-aware. Dropping old table.');
        await railDb.execute('DROP TABLE IF EXISTS synced_api_keys CASCADE;');
      }
    } catch (e: any) {
      console.warn('Failed checking synced_api_keys column:', e.message);
    }
  }

  // Create synced_api_keys table (Local copy for isolated gateway key checks)
  await railDb.execute(`
    CREATE TABLE IF NOT EXISTS synced_api_keys (
      id TEXT,
      tenant_id UUID, -- NULL for system keys
      key_hash TEXT NOT NULL,
      prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, tenant_id),
      UNIQUE (key_hash, tenant_id)
    );
  `);

  // Create notifications table (In-app alerts for operators and admins)
  await railDb.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT,
      tenant_id UUID, -- NULL for global system/admin alerts
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL, -- 'info', 'success', 'warning', 'error'
      read INTEGER NOT NULL DEFAULT 0, -- 0 = unread, 1 = read
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, tenant_id)
    );
  `);

  // Create system tenant to satisfy foreign key constraints for system-level entries/accounts
  try {
    if (railDb.isPostgres) {
      const res = await railDb.execute("SELECT id FROM tenants WHERE routing_code = 'PAYRAIL_SYSTEM_BIC' LIMIT 1;");
      if (res.rows.length > 0) {
        systemTenantId = (res.rows[0] as any).id;
      } else {
        const insertRes = await railDb.execute(`
          INSERT INTO tenants (name, legal_name, routing_code, api_status, public_key_pem, created_at)
          VALUES ('Payrail Platform Network', 'Payrail Platform Network', 'PAYRAIL_SYSTEM_BIC', 'active', 'SYSTEM_PUBLIC_KEY', ?)
          RETURNING id;
        `, [new Date().toISOString()]);
        systemTenantId = (insertRes.rows[0] as any).id;
      }
      console.log(`ℹ️ Resolved Nile System Tenant ID: ${systemTenantId}`);
    } else {
      await railDb.execute(`
        INSERT OR IGNORE INTO tenants (id, legal_name, routing_code, api_status, public_key_pem, created_at)
        VALUES ('00000000-0000-0000-0000-000000000000', 'Payrail Platform Network', 'PAYRAIL_SYSTEM_BIC', 'active', 'SYSTEM_PUBLIC_KEY', ?);
      `, [new Date().toISOString()]);
      systemTenantId = '00000000-0000-0000-0000-000000000000';
    }
  } catch (err: any) {
    console.log('ℹ️ System tenant seeding failed/exists:', err.message);
  }

  console.log('Database tables successfully verified/created.');
}

export function setRailDbClient(client: DbClient) {
  railDb = client;
}
export function setVaultDbClient(client: DbClient) {
  vaultDb = client;
}
export function setSystemTenantId(id: string) {
  systemTenantId = id;
}

export function swapToSqlite() {
  console.warn('  ⚠️ Swapping connection clients to local SQLite fallback.');
  const sqliteUrl = `file:${path.join(dbDir, 'payment-rail.db')}`;
  railDb = new LibsqlDbClient(createLibsqlClient({ url: sqliteUrl }));
  systemTenantId = '00000000-0000-0000-0000-000000000000';

  const vaultSqliteUrl = `file:${path.join(dbDir, 'vault.db')}`;
  vaultDb = new LibsqlDbClient(createLibsqlClient({ url: vaultSqliteUrl }));
}
