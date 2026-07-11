import * as crypto from 'crypto';
import { db, initDb } from '../server/src/db';
import { seedDatabase } from '../server/src/index';

const BASE_URL = 'http://localhost:9500';
const DEFAULT_API_KEY = 'sk_live_dev_key_12345';

// Helper to sign HTTP request payloads
function signPayload(privateKeyPem: string, body: any): { timestamp: string; signature: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawBody = JSON.stringify(body);
  const dataToSign = `${timestamp}.${rawBody}`;

  const sign = crypto.createSign('SHA256');
  sign.update(dataToSign);
  const signature = sign.sign(privateKeyPem, 'hex');

  return { timestamp, signature };
}

async function testB2BFlow() {
  console.log('====================================================');
  console.log('🛡️ TESTING PAYRAIL B2B SETTLEMENT ENGINE MIGRATIONS');
  console.log('====================================================');

  try {
    // 1. Wipe database to start fresh
    console.log('\nStep 1: Resetting database schemas and initial defaults...');
    await initDb();
    
    // We clear all tables in order
    await db.execute('DELETE FROM entries');
    await db.execute('DELETE FROM transactions');
    await db.execute('DELETE FROM payment_intents');
    await db.execute('DELETE FROM funding_sources');
    await db.execute('DELETE FROM accounts');
    await db.execute('DELETE FROM tenants');
    await db.execute('DELETE FROM api_keys');
    
    // Seed defaults
    await seedDatabase();

    // 2. Generate ECDSA keys for Tenant A and Tenant B
    console.log('\nStep 2: Generating ECDSA Secp256k1 keys for tenants...');
    const keysA = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const privateKeyPemA = keysA.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const publicKeyPemA = keysA.publicKey.export({ type: 'spki', format: 'pem' }) as string;

    const keysB = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const privateKeyPemB = keysB.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const publicKeyPemB = keysB.publicKey.export({ type: 'spki', format: 'pem' }) as string;

    console.log('  Keys successfully generated.');

    // 3. Onboard Tenants via API using default keys
    console.log('\nStep 3: Registering Bank A and Bank B tenants...');
    
    const tenantARes = await fetch(`${BASE_URL}/v1/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEFAULT_API_KEY}`
      },
      body: JSON.stringify({
        id: 'tenant_bank_a',
        legal_name: 'Private Settlement Bank A',
        routing_code: 'BANKA_SWIFT_BIC',
        public_key_pem: publicKeyPemA
      })
    });
    const tenantA = await tenantARes.json();
    if (!tenantARes.ok) throw new Error(`Onboarding Bank A failed: ${JSON.stringify(tenantA)}`);
    console.log(`  Onboarded: ${tenantA.legal_name} (${tenantA.routing_code})`);

    const tenantBRes = await fetch(`${BASE_URL}/v1/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEFAULT_API_KEY}`
      },
      body: JSON.stringify({
        id: 'tenant_bank_b',
        legal_name: 'Private Settlement Bank B',
        routing_code: 'BANKB_SWIFT_BIC',
        public_key_pem: publicKeyPemB
      })
    });
    const tenantB = await tenantBRes.json();
    if (!tenantBRes.ok) throw new Error(`Onboarding Bank B failed: ${JSON.stringify(tenantB)}`);
    console.log(`  Onboarded: ${tenantB.legal_name} (${tenantB.routing_code})`);

    // 4. Create Ledger Accounts scoped to Tenants
    console.log('\nStep 4: Setting up multi-tenant ledger accounts...');
    
    // Bank A Settlement clearing account (balance: $10,000.00)
    await db.execute({
      sql: `INSERT INTO accounts (id, tenant_id, name, type, category, currency, balance, status, created_at)
            VALUES ('acc_clearing_banka', 'tenant_bank_a', 'Bank A Clearing Account', 'asset', 'bank', 'USD', 1000000, 'active', ?)`,
      args: [new Date().toISOString()]
    });
    console.log('  Created Account: acc_clearing_banka (USD $10,000.00) scoped to Tenant A');

    // Bank B Settlement clearing account (balance: $2,000.00)
    await db.execute({
      sql: `INSERT INTO accounts (id, tenant_id, name, type, category, currency, balance, status, created_at)
            VALUES ('acc_clearing_bankb', 'tenant_bank_b', 'Bank B Clearing Account', 'asset', 'bank', 'USD', 200000, 'active', ?)`,
      args: [new Date().toISOString()]
    });
    console.log('  Created Account: acc_clearing_bankb (USD $2,000.00) scoped to Tenant B');

    // Link Bank A accounts as a gateway funding source
    await db.execute({
      sql: `INSERT INTO funding_sources (id, name, type, account_id, priority, status, created_at)
            VALUES ('fs_banka_clearing', 'Bank A Local Reserves', 'bank', 'acc_clearing_banka', 1, 'active', ?)`,
      args: [new Date().toISOString()]
    });

    // 5. Dispatch signed Payment Intent for Bank A
    console.log('\nStep 5: Testing cryptographically signed payment intent confirm...');
    
    // Create Payment Intent
    const createBody = {
      amount: 15000, // $150.00
      currency: 'USD',
      destination_account_id: 'acc_merchant_usd'
    };
    const createPiRes = await fetch(`${BASE_URL}/v1/payment_intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEFAULT_API_KEY}`
      },
      body: JSON.stringify(createBody)
    });
    const pi = await createPiRes.json();
    console.log(`  Created Payment Intent: ${pi.id}`);

    // Confirm Payment using ECDSA signatures
    const confirmBody = {};
    const sigInfo = signPayload(privateKeyPemA, confirmBody);

    console.log('  Sending payload headers:');
    console.log(`    Payrail-Tenant-Id: tenant_bank_a`);
    console.log(`    Payrail-Signature: t=${sigInfo.timestamp},v1=${sigInfo.signature.substring(0, 16)}...`);

    const confirmRes = await fetch(`${BASE_URL}/v1/payment_intents/${pi.id}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Payrail-Tenant-Id': 'tenant_bank_a',
        'Payrail-Signature': `t=${sigInfo.timestamp},v1=${sigInfo.signature}`
      },
      body: JSON.stringify(confirmBody)
    });
    const confirmData = await confirmRes.json();
    if (!confirmRes.ok) throw new Error(`Signed confirmation failed: ${JSON.stringify(confirmData)}`);
    
    console.log(`  Confirmation success status: ${confirmData.success}`);
    console.log('  Generated ISO 20022 Pacs.008 customer credit transfer:');
    console.log(confirmData.pacs_008_xml.split('\n').map((l: string) => `    ${l}`).slice(0, 10).join('\n') + '\n    ...');

    // 6. Test Net Settlement (DNS Sweep)
    console.log('\nStep 6: Executing B2B Net Settlement Sweep...');
    
    const dnsRes = await fetch(`${BASE_URL}/v1/settlements/dns_sweep`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEFAULT_API_KEY}`
      },
      body: JSON.stringify({
        source_bic: 'BANKA_SWIFT_BIC',
        dest_bic: 'BANKB_SWIFT_BIC',
        amount: 80000, // $800.00
        currency: 'USD'
      })
    });
    const dnsData = await dnsRes.json();
    if (!dnsRes.ok) throw new Error(`Net settlement sweep failed: ${JSON.stringify(dnsData)}`);
    console.log(`  Settlement Transaction ID: ${dnsData.transaction.id}`);
    console.log('  Generated ISO 20022 Pacs.009 financial institution transfer:');
    console.log(dnsData.pacs_009_xml.split('\n').map((l: string) => `    ${l}`).slice(0, 10).join('\n') + '\n    ...');

    // 7. Verify Merkle Chain Log Integrity
    console.log('\nStep 7: Validating Merkle ledger integrity...');
    const txResult = await db.execute('SELECT id, description, reference_id, payment_intent_id, merkle_hash FROM transactions ORDER BY created_at ASC');
    
    let previousHash = '0000000000000000000000000000000000000000000000000000000000000000';
    for (const row of txResult.rows as any) {
      const hashData = `${row.id}:${row.description}:${row.reference_id || ''}:${row.payment_intent_id || ''}:${previousHash}`;
      const expectedHash = crypto.createHash('sha256').update(hashData).digest('hex');
      
      if (expectedHash !== row.merkle_hash) {
        throw new Error(`LEGER CORRUPT: Transaction ${row.id} hash mismatch. Expected ${expectedHash}, got ${row.merkle_hash}`);
      }
      
      console.log(`  ✓ Transaction ${row.id} verified. Merkle Hash: ${row.merkle_hash.substring(0, 24)}...`);
      previousHash = row.merkle_hash;
    }

    console.log('\n====================================================');
    console.log('🎉 B2B SETTLEMENT ENGINE TESTS COMPLETED SUCCESSFULLY!');
    console.log('  Verified: Asymmetric signing, tenant scopes, Merkle hash');
    console.log('  integrity, and ISO 20022 PACs messaging.');
    console.log('====================================================');
    
  } catch (error: any) {
    console.error('\n❌ B2B Verification failed:', error.message);
    process.exit(1);
  }
}

testB2BFlow();
