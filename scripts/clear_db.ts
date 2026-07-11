import { vaultDb, railDb, initDb } from '../server/src/db';
import { seedDatabase } from '../server/src/index';

async function clearDb() {
  console.log('====================================================');
  console.log('🧹 CLEARING ENTIRE DUAL-DATABASE SYSTEM');
  console.log('====================================================');

  try {
    await initDb();

    console.log('Wiping Vault Database...');
    await vaultDb.execute('DELETE FROM webhook_delivery_logs');
    await vaultDb.execute('DELETE FROM webhook_endpoints');
    await vaultDb.execute('DELETE FROM api_keys');
    console.log('  ✓ Vault tables cleared.');

    console.log('Wiping Core Rail Database...');
    await railDb.execute('DELETE FROM entries');
    await railDb.execute('DELETE FROM transactions');
    await railDb.execute('DELETE FROM payment_intents');
    await railDb.execute('DELETE FROM funding_sources');
    await railDb.execute('DELETE FROM accounts');
    await railDb.execute('DELETE FROM tenants');
    await railDb.execute('DELETE FROM synced_api_keys');
    console.log('  ✓ Core Rail tables cleared.');

    console.log('Seeding baseline defaults...');
    await seedDatabase();

    console.log('====================================================');
    console.log('🎉 SYSTEM HAS BEEN SUCCESSFULLY RESET TO A CLEAN SLATE');
    console.log('====================================================');
  } catch (error) {
    console.error('Failed to reset database:', error);
    process.exit(1);
  }
}

clearDb();
