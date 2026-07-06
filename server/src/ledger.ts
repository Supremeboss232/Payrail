import { v4 as uuidv4 } from 'uuid';
import { db } from './db';

export interface LedgerEntryInput {
  accountId: string;
  type: 'debit' | 'credit';
  amount: number; // minor units (cents)
  currency: string;
}

export interface Account {
  id: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  category: 'bank' | 'broker_cash' | 'broker_asset' | 'logistics' | 'wallet' | 'revenue' | 'escrow' | 'equity';
  currency: string;
  balance: number;
  status: 'active' | 'suspended';
  created_at: string;
}

export interface Transaction {
  id: string;
  payment_intent_id: string | null;
  description: string;
  source_channel: 'api' | 'console' | 'system';
  reference_id: string | null;
  status: 'pending' | 'posted' | 'failed';
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  transaction_id: string;
  account_id: string;
  type: 'debit' | 'credit';
  amount: number;
  currency: string;
  created_at: string;
}

/**
 * Creates an account in the ledger.
 */
export async function createAccount(
  id: string,
  name: string,
  type: Account['type'],
  category: Account['category'],
  currency: string,
  initialBalance = 0
): Promise<Account> {
  const createdAt = new Date().toISOString();
  
  // If initialBalance > 0, we'll create a seeding transaction to keep the double-entry ledger balanced.
  // We offset it against a system equity account: `acc_system_equity`
  await db.execute({
    sql: `INSERT OR IGNORE INTO accounts (id, name, type, category, currency, balance, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    args: [id, name, type, category, currency.toUpperCase(), 0, createdAt],
  });

  if (initialBalance > 0) {
    const equityId = `acc_system_equity_${currency.toLowerCase()}`;
    // Ensure system equity account exists
    await db.execute({
      sql: `INSERT OR IGNORE INTO accounts (id, name, type, category, currency, balance, status, created_at)
            VALUES (?, ?, 'equity', 'equity', ?, 0, 'active', ?)`,
      args: [equityId, `System Capital Equity (${currency.toUpperCase()})`, currency.toUpperCase(), createdAt],
    });

    // Seeding transaction
    // To increase asset balance (debit asset account), we credit the equity account.
    // To increase liability/equity balance (credit liability/equity), we debit the equity account.
    const isAssetOrExpense = type === 'asset' || type === 'expense';
    const entries: LedgerEntryInput[] = [
      {
        accountId: id,
        type: isAssetOrExpense ? 'debit' : 'credit',
        amount: initialBalance,
        currency: currency.toUpperCase(),
      },
      {
        accountId: equityId,
        type: isAssetOrExpense ? 'credit' : 'debit',
        amount: initialBalance,
        currency: currency.toUpperCase(),
      },
    ];

    await postTransaction(
      `Seed initial balance for account ${name}`,
      'system',
      entries,
      `seed_${id}`
    );
  }

  const result = await db.execute({
    sql: 'SELECT * FROM accounts WHERE id = ?',
    args: [id],
  });
  
  return result.rows[0] as unknown as Account;
}

/**
 * Posts a transaction with multiple entries into the ledger.
 * This runs within an ACID transaction to guarantee double-entry balance.
 */
export async function postTransaction(
  description: string,
  sourceChannel: Transaction['source_channel'],
  entries: LedgerEntryInput[],
  referenceId: string | null = null,
  paymentIntentId: string | null = null
): Promise<Transaction> {
  if (entries.length < 2) {
    throw new Error('A transaction must have at least 2 entries.');
  }

  // 1. Validate that the transaction is balanced per currency.
  // Group entries by currency and check debits vs credits.
  const totals: Record<string, { debits: number; credits: number }> = {};
  for (const entry of entries) {
    const cur = entry.currency.toUpperCase();
    if (!totals[cur]) {
      totals[cur] = { debits: 0, credits: 0 };
    }
    if (entry.type === 'debit') {
      totals[cur].debits += entry.amount;
    } else {
      totals[cur].credits += entry.amount;
    }
  }

  for (const [cur, total] of Object.entries(totals)) {
    if (total.debits !== total.credits) {
      throw new Error(
        `Transaction unbalanced for currency ${cur}. Debits: ${total.debits}, Credits: ${total.credits}`
      );
    }
  }

  const txId = `tx_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const timestamp = new Date().toISOString();

  // Create LibSQL write transaction
  const tx = await db.transaction('write');

  try {
    // 2. Fetch and validate accounts involved, verifying status and currencies
    const accountIds = entries.map(e => e.accountId);
    const placeholders = accountIds.map(() => '?').join(',');
    const accountsResult = await tx.execute({
      sql: `SELECT * FROM accounts WHERE id IN (${placeholders})`,
      args: accountIds,
    });

    const accountsMap = new Map<string, Account>();
    for (const row of accountsResult.rows) {
      accountsMap.set(row.id as string, row as unknown as Account);
    }

    // Check that all accounts exist and are active
    for (const entry of entries) {
      const acc = accountsMap.get(entry.accountId);
      if (!acc) {
        throw new Error(`Account ${entry.accountId} not found in ledger.`);
      }
      if (acc.status !== 'active') {
        throw new Error(`Account ${entry.accountId} is suspended.`);
      }
      if (acc.currency.toUpperCase() !== entry.currency.toUpperCase()) {
        throw new Error(
          `Currency mismatch for account ${entry.accountId}. Expected ${acc.currency}, got ${entry.currency}`
        );
      }
    }

    // 3. Write transaction header
    await tx.execute({
      sql: `INSERT INTO transactions (id, payment_intent_id, description, source_channel, reference_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'posted', ?)`,
      args: [txId, paymentIntentId, description, sourceChannel, referenceId, timestamp],
    });

    // 4. Write entries and update balances
    for (const entry of entries) {
      const entryId = `ent_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
      const acc = accountsMap.get(entry.accountId)!;

      // Calculate balance delta
      // Asset/Expense: Debit increases (+), Credit decreases (-)
      // Liability/Equity/Revenue: Credit increases (+), Debit decreases (-)
      let balanceDelta = 0;
      const isAssetOrExpense = acc.type === 'asset' || acc.type === 'expense';

      if (entry.type === 'debit') {
        balanceDelta = isAssetOrExpense ? entry.amount : -entry.amount;
      } else {
        balanceDelta = isAssetOrExpense ? -entry.amount : entry.amount;
      }

      // Check balance limit for Asset/Expense to prevent overdraft if desired (here we allow negative balances, but you can block it)
      const newBalance = acc.balance + balanceDelta;
      if (isAssetOrExpense && acc.category !== 'equity' && newBalance < 0 && acc.category === 'wallet') {
        throw new Error(`Insufficient funds in wallet account ${acc.name}.`);
      }

      // Write Ledger Entry line
      await tx.execute({
        sql: `INSERT INTO entries (id, transaction_id, account_id, type, amount, currency, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [entryId, txId, entry.accountId, entry.type, entry.amount, entry.currency.toUpperCase(), timestamp],
      });

      // Update cached account balance
      await tx.execute({
        sql: `UPDATE accounts SET balance = ? WHERE id = ?`,
        args: [newBalance, entry.accountId],
      });
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }

  // Fetch created transaction
  const result = await db.execute({
    sql: 'SELECT * FROM transactions WHERE id = ?',
    args: [txId],
  });

  return result.rows[0] as unknown as Transaction;
}

/**
 * Retrieves all accounts and their current balances
 */
export async function getAccounts(): Promise<Account[]> {
  const result = await db.execute('SELECT * FROM accounts ORDER BY type, name');
  return result.rows as unknown as Account[];
}

/**
 * Retrieves the transaction journal (newest first)
 */
export async function getTransactions(): Promise<Transaction[]> {
  const result = await db.execute('SELECT * FROM transactions ORDER BY created_at DESC');
  return result.rows as unknown as Transaction[];
}

/**
 * Gets all entries associated with a transaction
 */
export async function getTransactionEntries(transactionId: string): Promise<LedgerEntry[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM entries WHERE transaction_id = ? ORDER BY type DESC',
    args: [transactionId],
  });
  return result.rows as unknown as LedgerEntry[];
}

/**
 * Gets entry history for a specific account
 */
export async function getAccountHistory(accountId: string): Promise<any[]> {
  const result = await db.execute({
    sql: `
      SELECT e.id, e.type, e.amount, e.currency, e.created_at, t.description, t.id as transaction_id
      FROM entries e
      JOIN transactions t ON e.transaction_id = t.id
      WHERE e.account_id = ?
      ORDER BY e.created_at DESC
    `,
    args: [accountId],
  });
  return result.rows;
}
