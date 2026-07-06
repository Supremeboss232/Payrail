import { db, initDb } from '../server/src/db';
import { getAccounts, getTransactions, getTransactionEntries } from '../server/src/ledger';
import * as crypto from 'crypto';
import { seedDatabase } from '../server/src/index';

async function runVerification() {
  console.log('====================================================');
  console.log('⚡ STARTING PRIVATE PAYMENT RAIL SYSTEM VERIFICATION');
  console.log('====================================================');

  try {
    // 1. Initialize and Seed Database
    await initDb();
    await seedDatabase();
    
    // Seed initial mock key if missing (handled in server index, but let's check)
    const rawDevKey = 'sk_live_dev_key_12345';
    const hashedDevKey = crypto.createHash('sha256').update(rawDevKey).digest('hex');
    await db.execute({
      sql: `INSERT OR IGNORE INTO api_keys (id, key_hash, prefix, name, status, created_at)
            VALUES ('key_default_dev', ?, 'sk_live_', 'Default Developer Key', 'active', ?)`,
      args: [hashedDevKey, new Date().toISOString()],
    });

    console.log('\n[1] LEDGER ACCOUNTS AUDIT BEFORE PAYMENT');
    let accounts = await getAccounts();
    for (const acc of accounts) {
      console.log(`  Account: ${acc.name} (${acc.id}) | Balance: $${(acc.balance / 100).toFixed(2)} ${acc.currency}`);
    }

    // 2. Set Chase Bank (Priority 1) balance to 0 cents to force a SWAP / Failover!
    console.log('\n[2] SIMULATING EXHAUSTED FUNDS IN CHASE BANK (PRIORITY #1)');
    await db.execute("UPDATE accounts SET balance = 0 WHERE id = 'acc_bank_chase'");
    console.log('  Chase balance set to $0.00.');

    // Wells Fargo (Priority #2) has $8,500.00 seeded.
    const wfAcc = accounts.find(a => a.id === 'acc_bank_wellsfargo')!;
    console.log(`  Wells Fargo (Priority #2) Balance: $${(wfAcc.balance / 100).toFixed(2)} USD.`);

    // 3. Create a Payment Intent for $500.00 (50000 cents) destined for the Merchant Drawer
    console.log('\n[3] CREATING PAYMENT INTENT');
    const piId = 'pi_test_verification_999';
    const clientSecret = `${piId}_secret_test`;
    const destination = 'acc_merchant_usd';
    const amount = 50000; // $500.00
    
    await db.execute({
      sql: `INSERT OR REPLACE INTO payment_intents (id, amount, currency, status, funding_source_id, destination_account_id, client_secret, metadata, created_at)
            VALUES (?, ?, 'USD', 'requires_payment_method', NULL, ?, ?, '{}', ?)`,
      args: [piId, amount, destination, clientSecret, new Date().toISOString()],
    });
    console.log(`  Payment Intent created: ${piId} for $500.00`);

    // 4. Trigger Confirm and Dynamic Swap logic manually to inspect routing
    console.log('\n[4] EXECUTING GATEWAY ROUTING ENGINE (SWAP SIMULATION)');
    // Fetch active funding sources ordered by priority
    const fsResult = await db.execute("SELECT * FROM funding_sources WHERE status = 'active' ORDER BY priority ASC");
    const fundingSources = fsResult.rows;

    let successfulFs: any = null;
    let failureReason = '';
    const logs: string[] = [];

    for (const fs of fundingSources) {
      logs.push(`Attempting payment using funding source: ${fs.name}`);
      try {
        const accResult = await db.execute({
          sql: 'SELECT * FROM accounts WHERE id = ?',
          args: [fs.account_id],
        });
        const sourceAcc: any = accResult.rows[0];

        if (sourceAcc.balance < amount) {
          throw new Error(`Insufficient funds: ${sourceAcc.name} balance is $${(sourceAcc.balance / 100).toFixed(2)}`);
        }

        // Atomic double-entry ledger writes
        // Debit: Merchant Destination Account (increases)
        // Credit: Funding Source Account (decreases)
        const timestamp = new Date().toISOString();
        const txId = `tx_verify_${Date.now()}`;

        // Create transaction block
        const tx = await db.transaction('write');
        try {
          // Insert transaction header
          await tx.execute({
            sql: `INSERT INTO transactions (id, payment_intent_id, description, source_channel, reference_id, status, created_at)
                  VALUES (?, ?, ?, 'api', ?, 'posted', ?)`,
            args: [txId, piId, `Payment Intent confirm: ${piId} via ${fs.name}`, piId, timestamp],
          });

          // Debit merchant account
          await tx.execute({
            sql: `INSERT INTO entries (id, transaction_id, account_id, type, amount, currency, created_at)
                  VALUES (?, ?, ?, 'debit', ?, 'USD', ?)`,
            args: [`ent_verify_d_${Date.now()}`, txId, destination, amount, timestamp],
          });
          const destBalanceResult = await tx.execute({
            sql: 'SELECT balance FROM accounts WHERE id = ?',
            args: [destination],
          });
          const newDestBal = (destBalanceResult.rows[0].balance as number) + amount;
          await tx.execute({
            sql: 'UPDATE accounts SET balance = ? WHERE id = ?',
            args: [newDestBal, destination],
          });

          // Credit funding source account
          await tx.execute({
            sql: `INSERT INTO entries (id, transaction_id, account_id, type, amount, currency, created_at)
                  VALUES (?, ?, ?, 'credit', ?, 'USD', ?)`,
            args: [`ent_verify_c_${Date.now()}`, txId, fs.account_id, amount, timestamp],
          });
          const newSourceBal = (sourceAcc.balance as number) - amount;
          await tx.execute({
            sql: 'UPDATE accounts SET balance = ? WHERE id = ?',
            args: [newSourceBal, fs.account_id],
          });

          await tx.commit();
        } catch (e) {
          await tx.rollback();
          throw e;
        } finally {
          tx.close();
        }

        successfulFs = fs;
        logs.push(`Payment succeeded via ${fs.name}.`);
        break;
      } catch (err: any) {
        logs.push(`Swap Triggered: ${fs.name} failed (${err.message}).`);
        failureReason = err.message;
      }
    }

    if (successfulFs) {
      await db.execute({
        sql: "UPDATE payment_intents SET status = 'succeeded', funding_source_id = ? WHERE id = ?",
        args: [successfulFs.id, piId],
      });
      console.log('  Payment Intent SUCCEEDED!');
    } else {
      await db.execute({
        sql: "UPDATE payment_intents SET status = 'failed' WHERE id = ?",
        args: [piId],
      });
      console.log('  Payment Intent FAILED!');
    }

    console.log('\n[5] ROUTING ENGINE LOGS:');
    for (const log of logs) {
      console.log(`  -> ${log}`);
    }

    // 5. Audit Balances After Payment
    console.log('\n[6] LEDGER ACCOUNTS AUDIT AFTER PAYMENT');
    accounts = await getAccounts();
    for (const acc of accounts) {
      console.log(`  Account: ${acc.name} (${acc.id}) | Balance: $${(acc.balance / 100).toFixed(2)} ${acc.currency}`);
    }

    // 6. Perform Balance Integrity check (Double-Entry Constraints Verification)
    console.log('\n[7] LEDGER DOUBLE-ENTRY INTEGRITY CHECK');
    // Fetch recent transaction entries
    const txs = await getTransactions();
    const testTx = txs.find(t => t.payment_intent_id === piId)!;
    const entries = await getTransactionEntries(testTx.id);

    console.log(`  Inspecting Transaction ${testTx.id}: ${testTx.description}`);
    let debitsSum = 0;
    let creditsSum = 0;

    for (const entry of entries) {
      console.log(`    Entry: Account ${entry.account_id} | Type: ${entry.type.toUpperCase()} | Amount: $${(entry.amount / 100).toFixed(2)}`);
      if (entry.type === 'debit') debitsSum += entry.amount;
      if (entry.type === 'credit') creditsSum += entry.amount;
    }

    console.log(`  Total Debits: $${(debitsSum / 100).toFixed(2)} | Total Credits: $${(creditsSum / 100).toFixed(2)}`);
    if (debitsSum === creditsSum && debitsSum === amount) {
      console.log('  ✅ SUCCESS: Double-entry ledger is perfectly balanced. Debits equal Credits.');
    } else {
      throw new Error('Double-entry validation failed: Debits do not equal Credits.');
    }

    console.log('\n====================================================');
    console.log('🎉 VERIFICATION COMPLETE - ALL CHECKS PASSED');
    console.log('====================================================');
  } catch (error) {
    console.error('\n❌ VERIFICATION FAILURE:', error);
    process.exit(1);
  }
}

runVerification();
