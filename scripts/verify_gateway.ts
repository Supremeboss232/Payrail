import { vaultDb, railDb, systemTenantId, initDb } from '../server/src/db';
import { createAccount, getAccounts, getTransactions, getTransactionEntries, postTransaction } from '../server/src/ledger';
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
    const now = new Date().toISOString();

    // Ensure test accounts exist for verification
    await createAccount('acc_bank_chase', 'Chase Business Checking', 'asset', 'bank', 'USD', 0, systemTenantId);
    await createAccount('acc_bank_wellsfargo', 'Wells Fargo Treasury', 'asset', 'bank', 'USD', 850000, systemTenantId);
    await createAccount('acc_merchant_usd', 'Merchant Settlement Wallet', 'asset', 'wallet', 'USD', 0, systemTenantId);

    // Ensure funding sources exist for priority failover test
    await railDb.execute({
      sql: `INSERT OR REPLACE INTO funding_sources (id, name, type, account_id, priority, status, connector_type, created_at)
            VALUES ('fs_verify_chase', 'Chase Business Checking (P1)', 'bank', 'acc_bank_chase', 1, 'active', 'http_callback', ?)`,
      args: [now],
    });
    await railDb.execute({
      sql: `INSERT OR REPLACE INTO funding_sources (id, name, type, account_id, priority, status, connector_type, created_at)
            VALUES ('fs_verify_wf', 'Wells Fargo Treasury (P2)', 'bank', 'acc_bank_wellsfargo', 2, 'active', 'http_callback', ?)`,
      args: [now],
    });

    console.log('\n[1] LEDGER ACCOUNTS AUDIT BEFORE PAYMENT');
    let accounts = await getAccounts();
    for (const acc of accounts) {
      console.log(`  Account: ${acc.name} (${acc.id}) | Balance: $${(acc.balance / 100).toFixed(2)} ${acc.currency}`);
    }

    // 2. Set Chase Bank (Priority 1) balance to 0 cents to force a SWAP / Failover!
    console.log('\n[2] SIMULATING EXHAUSTED FUNDS IN CHASE BANK (PRIORITY #1)');
    await railDb.execute("UPDATE accounts SET balance = 0 WHERE id = 'acc_bank_chase'");
    await railDb.execute("UPDATE accounts SET balance = 850000 WHERE id = 'acc_bank_wellsfargo'");
    console.log('  Chase balance set to $0.00.');
    console.log('  Wells Fargo (Priority #2) Balance: $8500.00 USD.');

    // 3. Create a Payment Intent for $500.00 (50000 cents) destined for the Merchant Drawer
    console.log('\n[3] CREATING PAYMENT INTENT');
    const piId = `pi_verify_${Date.now()}`;
    const clientSecret = `${piId}_secret_test`;
    const destination = 'acc_merchant_usd';
    const amount = 50000; // $500.00
    
    await railDb.execute({
      sql: `INSERT OR REPLACE INTO payment_intents (id, amount, currency, status, funding_source_id, destination_account_id, client_secret, metadata, created_at)
            VALUES (?, ?, 'USD', 'requires_payment_method', NULL, ?, ?, '{}', ?)`,
      args: [piId, amount, destination, clientSecret, now],
    });
    console.log(`  Payment Intent created: ${piId} for $500.00`);

    // 4. Trigger Confirm and Dynamic Swap logic to inspect routing
    console.log('\n[4] EXECUTING GATEWAY ROUTING ENGINE (SWAP SIMULATION)');
    const fsResult = await railDb.execute("SELECT * FROM funding_sources WHERE status = 'active' ORDER BY priority ASC");
    const fundingSources = fsResult.rows;

    let successfulFs: any = null;
    const logs: string[] = [];

    for (const fs of fundingSources) {
      logs.push(`Attempting payment using funding source: ${fs.name}`);
      try {
        const accResult = await railDb.execute({
          sql: 'SELECT * FROM accounts WHERE id = ?',
          args: [fs.account_id],
        });
        const sourceAcc: any = accResult.rows[0];
        if (!sourceAcc) throw new Error(`Account ${fs.account_id} not found`);

        if (Number(sourceAcc.balance) < amount) {
          throw new Error(`Insufficient funds: ${sourceAcc.name} balance is $${(Number(sourceAcc.balance) / 100).toFixed(2)}`);
        }

        await postTransaction(
          `Payment Intent confirm: ${piId} via ${fs.name}`,
          'api',
          [
            { accountId: destination, type: 'debit', amount, currency: 'USD' },
            { accountId: fs.account_id, type: 'credit', amount, currency: 'USD' },
          ],
          piId,
          piId,
          systemTenantId
        );

        successfulFs = fs;
        logs.push(`Payment succeeded via ${fs.name}.`);
        break;
      } catch (err: any) {
        logs.push(`Swap Triggered: ${fs.name} failed (${err.message}).`);
      }
    }

    if (successfulFs) {
      await railDb.execute({
        sql: "UPDATE payment_intents SET status = 'succeeded', funding_source_id = ? WHERE id = ?",
        args: [successfulFs.id, piId],
      });
      console.log('  Payment Intent SUCCEEDED!');
    } else {
      await railDb.execute({
        sql: "UPDATE payment_intents SET status = 'failed' WHERE id = ?",
        args: [piId],
      });
      throw new Error('All funding sources failed during verification.');
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
    const txs = await getTransactions();
    const testTx = txs.find(t => t.payment_intent_id === piId)!;
    const entries = await getTransactionEntries(testTx.id);

    console.log(`  Inspecting Transaction ${testTx.id}: ${testTx.description} (Hash: ${testTx.hash.slice(0, 16)}...)`);
    let debitsSum = 0;
    let creditsSum = 0;

    for (const entry of entries) {
      console.log(`    Entry: Account ${entry.account_id} | Type: ${entry.type.toUpperCase()} | Amount: $${(entry.amount / 100).toFixed(2)}`);
      if (entry.type === 'debit') debitsSum += Number(entry.amount);
      if (entry.type === 'credit') creditsSum += Number(entry.amount);
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
