import { initDb } from './rls';
import { resetClient } from './client';

async function main() {
  console.log('🔄 Initializing database schema, constraints, and RLS policies...');
  try {
    await initDb();
    console.log('✅ Database schema and RLS policies initialized successfully.');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  } finally {
    await resetClient();
  }
}

main();
