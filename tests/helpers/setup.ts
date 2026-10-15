import { initDb, withPlatformContext } from '@/db/rls';
import { getRawClient, resetClient } from '@/db/client';

export async function setupTestDatabase(): Promise<void> {
  await initDb();
}

export async function teardownTestDatabase(): Promise<void> {
  // Clean up tables between test runs
  const raw = getRawClient();
  if ('exec' in raw) {
    await (raw as any).exec(`
      TRUNCATE TABLE receipt_revisions CASCADE;
      TRUNCATE TABLE refunds CASCADE;
      TRUNCATE TABLE receipts CASCADE;
      TRUNCATE TABLE donations CASCADE;
      TRUNCATE TABLE donation_campaigns CASCADE;
      TRUNCATE TABLE payment_webhook_events CASCADE;
      TRUNCATE TABLE payments CASCADE;
      TRUNCATE TABLE bookings CASCADE;
      TRUNCATE TABLE temple_payment_configs CASCADE;
      TRUNCATE TABLE custom_domains CASCADE;
      TRUNCATE TABLE puja_time_slots CASCADE;
      TRUNCATE TABLE puja_services CASCADE;
      TRUNCATE TABLE audit_logs CASCADE;
      TRUNCATE TABLE tenant_memberships CASCADE;
      TRUNCATE TABLE sessions CASCADE;
      TRUNCATE TABLE temples CASCADE;
      TRUNCATE TABLE users CASCADE;
      TRUNCATE TABLE tenants CASCADE;
    `);
  } else {
    await (raw as any).query(`
      TRUNCATE TABLE receipt_revisions CASCADE;
      TRUNCATE TABLE refunds CASCADE;
      TRUNCATE TABLE receipts CASCADE;
      TRUNCATE TABLE donations CASCADE;
      TRUNCATE TABLE donation_campaigns CASCADE;
      TRUNCATE TABLE payment_webhook_events CASCADE;
      TRUNCATE TABLE payments CASCADE;
      TRUNCATE TABLE bookings CASCADE;
      TRUNCATE TABLE temple_payment_configs CASCADE;
      TRUNCATE TABLE custom_domains CASCADE;
      TRUNCATE TABLE puja_time_slots CASCADE;
      TRUNCATE TABLE puja_services CASCADE;
      TRUNCATE TABLE audit_logs CASCADE;
      TRUNCATE TABLE tenant_memberships CASCADE;
      TRUNCATE TABLE sessions CASCADE;
      TRUNCATE TABLE temples CASCADE;
      TRUNCATE TABLE users CASCADE;
      TRUNCATE TABLE tenants CASCADE;
    `);
  }
}
