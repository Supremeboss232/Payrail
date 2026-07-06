import { db, initDb } from '../server/src/db';
import { seedDatabase } from '../server/src/index';

async function clearDb() {
  console.log('====================================================');
  console.log('🧹 CLEARING ENTIRE PAYMENT RAIL DATABASE');
  console.log('====================================================');

  try {
    await initDb();

    console.log('Wiping all tables...');
    // We execute deletes in reverse dependency order
    await db.execute('DELETE FROM webhook_delivery_logs');
    await db.execute('DELETE FROM webhook_endpoints');
    await db.execute('DELETE FROM api_keys');
    await db.execute('DELETE FROM entries');
    await db.execute('DELETE FROM transactions');
    await db.execute('DELETE FROM payment_intents');
    await db.execute('DELETE FROM funding_sources');
    await db.execute('DELETE FROM accounts');
    
    console.log('Database tables cleared successfully.');

    // Seed defaults (merchant wallet and default api key)
    await seedDatabase();

    console.log('====================================================');
    console.log('🎉 DATABASE HAS BEEN SUCCESSFULLY RESET TO A CLEAN SLATE');
    console.log('====================================================');
  } catch (error) {
    console.error('Failed to reset database:', error);
    process.exit(1);
  }
}

clearDb();
