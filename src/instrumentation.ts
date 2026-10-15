export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { initDb } = await import('./db/rls');
      await initDb();
      console.log('✅ Local database initialized and RLS policies verified on startup');

      const { seedDemoData } = await import('./db/seed');
      await seedDemoData();
      console.log('✅ Local demo data verified on startup');
    } catch (err) {
      console.error('⚠️ Database startup initialization error:', err);
    }
  }
}
