import { getRawClient, getDb } from './client';
import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { TenantMismatchError, ValidationError } from '../core/errors';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

export async function initDb(): Promise<void> {
  const raw = getRawClient();

  const ddl = `

    -- Create non-superuser application role if not exists
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user;
      END IF;
    END
    $$;

    -- Tenants table
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Temples table
    CREATE TABLE IF NOT EXISTS temples (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL,
      timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
      address JSONB NOT NULL,
      contact_email VARCHAR(255),
      contact_phone VARCHAR(50),
      branding JSONB NOT NULL DEFAULT '{}'::jsonb,
      operating_status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      published BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT temples_tenant_slug_unique UNIQUE (tenant_id, slug),
      CONSTRAINT temples_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE,
      phone VARCHAR(50) UNIQUE,
      password_hash TEXT,
      salt TEXT,
      full_name VARCHAR(255) NOT NULL,
      is_platform_admin BOOLEAN NOT NULL DEFAULT false,
      mfa_enabled BOOLEAN NOT NULL DEFAULT false,
      mfa_secret TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      active_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
      token VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Tenant Memberships table
    CREATE TABLE IF NOT EXISTS tenant_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL,
      assigned_temple_id UUID REFERENCES temples(id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT memberships_tenant_user_role_temple_unique UNIQUE (tenant_id, user_id, role, assigned_temple_id),
      CONSTRAINT memberships_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Audit Logs table
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      actor_id VARCHAR(255) NOT NULL,
      actor_role VARCHAR(50) NOT NULL,
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(100) NOT NULL,
      resource_id VARCHAR(255) NOT NULL,
      request_id VARCHAR(100) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      changes_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Puja Services table
    CREATE TABLE IF NOT EXISTS puja_services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      duration_minutes INTEGER NOT NULL,
      price_minor_units BIGINT NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT pujas_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Puja Time Slots table
    CREATE TABLE IF NOT EXISTS puja_time_slots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      puja_service_id UUID NOT NULL REFERENCES puja_services(id) ON DELETE CASCADE,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      total_capacity INTEGER NOT NULL,
      allocated_capacity INTEGER NOT NULL DEFAULT 0,
      availability_status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT slots_id_tenant_unique UNIQUE (id, tenant_id),
      CONSTRAINT slots_capacity_check CHECK (allocated_capacity <= total_capacity),
      CONSTRAINT slots_time_check CHECK (end_time > start_time)
    );

    -- Temple Payment Configs table
    CREATE TABLE IF NOT EXISTS temple_payment_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      provider VARCHAR(50) NOT NULL,
      merchant_account_id VARCHAR(255) NOT NULL,
      webhook_secret TEXT NOT NULL,
      api_key TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'ELIGIBLE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT payment_configs_temple_provider_unique UNIQUE (temple_id, provider),
      CONSTRAINT payment_configs_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Bookings table
    CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      puja_service_id UUID NOT NULL REFERENCES puja_services(id) ON DELETE CASCADE,
      slot_id UUID NOT NULL REFERENCES puja_time_slots(id) ON DELETE CASCADE,
      devotee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      booking_reference VARCHAR(64) UNIQUE NOT NULL,
      participant_count INTEGER NOT NULL,
      total_price_minor_units BIGINT NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      service_snapshot JSONB NOT NULL,
      devotee_details JSONB NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING_PAYMENT',
      fulfillment_status VARCHAR(50) NOT NULL DEFAULT 'UNFULFILLED',
      expires_at TIMESTAMPTZ NOT NULL,
      capacity_released BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT bookings_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Payments table
    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      reference_type VARCHAR(50) NOT NULL,
      booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
      donation_id UUID,
      provider VARCHAR(50) NOT NULL,
      provider_order_id VARCHAR(255) NOT NULL,
      provider_payment_id VARCHAR(255),
      amount_minor_units BIGINT NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      fee_minor_units BIGINT,
      net_settlement_minor_units BIGINT,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      reconciliation_reason TEXT,
      settled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT payments_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Payment Webhook Events table (Idempotency Journal)
    CREATE TABLE IF NOT EXISTS payment_webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider VARCHAR(50) NOT NULL,
      event_id VARCHAR(255) NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      payload TEXT NOT NULL,
      status VARCHAR(50) NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT webhook_events_provider_event_unique UNIQUE (provider, event_id)
    );

    -- Donation Campaigns table
    CREATE TABLE IF NOT EXISTS donation_campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      purpose TEXT NOT NULL,
      recipient_legal_entity VARCHAR(255) NOT NULL,
      suggested_amounts_minor_units TEXT NOT NULL,
      min_amount_minor_units BIGINT NOT NULL DEFAULT 1000,
      max_amount_minor_units BIGINT,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      tax_exemption_eligible BOOLEAN NOT NULL DEFAULT false,
      tax_exemption_section VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT campaigns_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Donations table
    CREATE TABLE IF NOT EXISTS donations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      campaign_id UUID NOT NULL REFERENCES donation_campaigns(id) ON DELETE CASCADE,
      donor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      amount_minor_units BIGINT NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      donor_name VARCHAR(255) NOT NULL,
      donor_email VARCHAR(255),
      donor_phone VARCHAR(50),
      donor_pan VARCHAR(20),
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT donations_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Receipts table
    CREATE TABLE IF NOT EXISTS receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      donation_id UUID NOT NULL UNIQUE REFERENCES donations(id) ON DELETE CASCADE,
      donor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      receipt_number VARCHAR(100) NOT NULL,
      fiscal_year VARCHAR(20) NOT NULL,
      recipient_legal_entity VARCHAR(255) NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      amount_minor_units BIGINT NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      payment_reference VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'VALID',
      voided_reason TEXT,
      voided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      tax_deduction_eligible BOOLEAN NOT NULL DEFAULT false,
      tax_deduction_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT receipts_tenant_number_unique UNIQUE (tenant_id, receipt_number),
      CONSTRAINT receipts_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Receipt Revisions table (Immutable Journal)
    CREATE TABLE IF NOT EXISTS receipt_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL,
      actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(50) NOT NULL,
      previous_state JSONB NOT NULL,
      new_state JSONB NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Refunds table
    CREATE TABLE IF NOT EXISTS refunds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
      donation_id UUID REFERENCES donations(id) ON DELETE SET NULL,
      amount_minor_units BIGINT NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      reason TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      provider_refund_id VARCHAR(255),
      requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT refunds_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Custom Domains table
    CREATE TABLE IF NOT EXISTS custom_domains (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      temple_id UUID NOT NULL REFERENCES temples(id) ON DELETE CASCADE,
      domain VARCHAR(255) UNIQUE NOT NULL,
      verification_token VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING_VERIFICATION',
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT custom_domains_id_tenant_unique UNIQUE (id, tenant_id)
    );

    -- Grant permissions to app_user
    GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;

    -- Configure RLS for temples
    ALTER TABLE temples ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON temples;
    CREATE POLICY tenant_isolation_policy ON temples
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for tenant_memberships
    ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_memberships;
    CREATE POLICY tenant_isolation_policy ON tenant_memberships
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for puja_services
    ALTER TABLE puja_services ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON puja_services;
    CREATE POLICY tenant_isolation_policy ON puja_services
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for puja_time_slots
    ALTER TABLE puja_time_slots ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON puja_time_slots;
    CREATE POLICY tenant_isolation_policy ON puja_time_slots
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for temple_payment_configs
    ALTER TABLE temple_payment_configs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON temple_payment_configs;
    CREATE POLICY tenant_isolation_policy ON temple_payment_configs
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for bookings
    ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON bookings;
    CREATE POLICY tenant_isolation_policy ON bookings
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for payments
    ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON payments;
    CREATE POLICY tenant_isolation_policy ON payments
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for donation_campaigns
    ALTER TABLE donation_campaigns ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON donation_campaigns;
    CREATE POLICY tenant_isolation_policy ON donation_campaigns
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for donations
    ALTER TABLE donations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON donations;
    CREATE POLICY tenant_isolation_policy ON donations
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for receipts
    ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON receipts;
    CREATE POLICY tenant_isolation_policy ON receipts
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for receipt_revisions
    ALTER TABLE receipt_revisions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON receipt_revisions;
    CREATE POLICY tenant_isolation_policy ON receipt_revisions
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for refunds
    ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON refunds;
    CREATE POLICY tenant_isolation_policy ON refunds
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    -- Configure RLS for custom_domains
    ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_policy ON custom_domains;
    CREATE POLICY tenant_isolation_policy ON custom_domains
      FOR ALL
      TO app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  `;

  if ('exec' in raw) {
    await (raw as PGlite).exec(ddl);
  } else {
    await (raw as pg.Pool).query(ddl);
  }
}

/**
 * Executes an operation within a tenant-scoped transaction.
 * Applies SET LOCAL app.current_tenant_id = tenantId.
 * Guarantees that upon commit/abort the setting is completely cleared,
 * preventing any tenant context from leaking on connection reuse (AT-11).
 */
export async function withTenantContext<T>(
  tenantId: string,
  operation: (context: { tx: any; db: any }) => Promise<T>
): Promise<T> {
  if (!isValidUUID(tenantId)) {
    throw new ValidationError('Invalid tenant ID: must be a valid UUID');
  }

  const { txStorage } = await import('./client');
  const existingStore = txStorage.getStore();
  if (existingStore && existingStore.tx && existingStore.db) {
    if (existingStore.tenantId === tenantId) {
      return await operation({ tx: existingStore.tx, db: existingStore.db });
    }
  }

  const raw = getRawClient();

  // For PGlite in-memory / local
  if ('transaction' in raw) {
    return await (raw as PGlite).transaction(async (txClient) => {
      await txClient.query(`SET ROLE app_user;`);
      await txClient.query(`SET LOCAL app.current_tenant_id = '${tenantId}';`);
      const { drizzle } = await import('drizzle-orm/pglite');
      const schema = await import('./schema');
      const { txStorage } = await import('./client');
      const txDb = drizzle(txClient as any, { schema });
      return await txStorage.run({ tx: txClient, db: txDb, tenantId }, async () => {
        try {
          const result = await operation({ tx: txClient, db: txDb });
          return result;
        } finally {
          await txClient.query(`RESET ROLE;`).catch(() => {});
        }
      });
    });
  }

  // For Node pg Pool (Production PostgreSQL)
  const client = await (raw as pg.Pool).connect();
  try {
    await client.query('BEGIN;');
    await client.query('SET ROLE app_user;');
    await client.query(`SET LOCAL app.current_tenant_id = $1;`, [tenantId]);
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const schema = await import('./schema');
    const { txStorage } = await import('./client');
    const txDb = drizzle(client, { schema });
    const result = await txStorage.run({ tx: client, db: txDb, tenantId }, async () => {
      return await operation({ tx: client, db: txDb });
    });
    await client.query('COMMIT;');
    return result;
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    throw err;
  } finally {
    await client.query('RESET ROLE;').catch(() => {});
    client.release();
  }
}

/**
 * Platform staff execution context (can query across tenants for platform administration).
 */
export async function withPlatformContext<T>(
  operation: (client: any) => Promise<T>
): Promise<T> {
  const raw = getRawClient();
  if ('query' in raw) {
    return await operation(raw);
  }
  return await operation(getDb());
}
