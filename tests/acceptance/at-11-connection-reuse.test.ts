import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { withTenantContext } from '@/db/rls';
import { getRawClient } from '@/db/client';
import { temples } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('Acceptance Test AT-11: Connection Pool Hygiene & Zero Tenant Context Leakage', () => {
  let tenantA: any;
  let tenantB: any;
  let templeA: any;
  let templeB: any;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'root@platform.internal',
      fullName: 'Root Platform Admin',
      isPlatformAdmin: true,
    });
    const rootAdminId = rootAdmin.id;

    tenantA = await createTenant({
      name: 'Tenant Alpha Trust',
      slug: 'tenant-alpha',
      actorUserId: rootAdminId,
    });

    tenantB = await createTenant({
      name: 'Tenant Beta Trust',
      slug: 'tenant-beta',
      actorUserId: rootAdminId,
    });

    templeA = await createTemple({
      tenantId: tenantA.id,
      name: 'Temple Alpha',
      slug: 'temple-alpha',
      address: { line1: '1 Alpha St', city: 'City A', state: 'State A', postalCode: '111111', country: 'India' },
      actorUserId: rootAdminId,
      actorRole: 'TRUST_ADMIN',
    });

    templeB = await createTemple({
      tenantId: tenantB.id,
      name: 'Temple Beta',
      slug: 'temple-beta',
      address: { line1: '2 Beta St', city: 'City B', state: 'State B', postalCode: '222222', country: 'India' },
      actorUserId: rootAdminId,
      actorRole: 'TRUST_ADMIN',
    });
  });

  it('Scenario 1: SET LOCAL drops immediately after transaction commit; next operation retains zero context', async () => {
    const raw = getRawClient();

    // 1. Run transaction for Tenant A
    const resultA = await withTenantContext(tenantA.id, async ({ db, tx }) => {
      const rows = await db.select().from(temples);
      const setting = await tx.query(`SELECT current_setting('app.current_tenant_id', true) as val;`);
      return { rows, setting: setting.rows[0].val };
    });

    expect(resultA.setting).toBe(tenantA.id);
    expect(resultA.rows.length).toBe(1);
    expect(resultA.rows[0].id).toBe(templeA.id);

    // 2. Immediate query on the same connection outside any transaction:
    // SET LOCAL must have dropped.
    const rawCheck = await (raw as any).query(`SELECT current_setting('app.current_tenant_id', true) as val;`);
    const currentVal = rawCheck.rows[0].val;
    // Empty string or null
    expect(currentVal === '' || currentVal === null || currentVal === undefined).toBe(true);

    // 3. Run transaction for Tenant B on the reused connection
    const resultB = await withTenantContext(tenantB.id, async ({ db, tx }) => {
      const rows = await db.select().from(temples);
      const setting = await tx.query(`SELECT current_setting('app.current_tenant_id', true) as val;`);
      return { rows, setting: setting.rows[0].val };
    });

    expect(resultB.setting).toBe(tenantB.id);
    expect(resultB.rows.length).toBe(1);
    expect(resultB.rows[0].id).toBe(templeB.id);
    expect(resultB.rows[0].id).not.toBe(templeA.id);
  });

  it('Scenario 2: SET LOCAL drops cleanly even when transaction aborts/throws an error', async () => {
    const raw = getRawClient();

    // Run transaction for Tenant A that throws an error
    await expect(
      withTenantContext(tenantA.id, async ({ tx }) => {
        await tx.query('SELECT 1;');
        throw new Error('Simulated crash inside tenant transaction');
      })
    ).rejects.toThrow('Simulated crash inside tenant transaction');

    // Verify context was dropped and connection didn't retain Tenant A context
    const checkAfterRollback = await (raw as any).query(
      `SELECT current_setting('app.current_tenant_id', true) as val;`
    );
    const val = checkAfterRollback.rows[0].val;
    expect(val === '' || val === null || val === undefined).toBe(true);

    // Run Tenant B transaction next -> succeeds cleanly with Tenant B context
    const resultB = await withTenantContext(tenantB.id, async ({ db }) => {
      return await db.select().from(temples);
    });

    expect(resultB.length).toBe(1);
    expect(resultB[0].name).toBe('Temple Beta');
  });

  it('Scenario 3: Concurrent interleaved tenant requests maintain strict isolation', async () => {
    // Fire concurrent requests for Tenant A and Tenant B simultaneously
    const [rowsA, rowsB] = await Promise.all([
      withTenantContext(tenantA.id, async ({ db }) => {
        // Add tiny artificial delay to test interleaving
        await new Promise((r) => setTimeout(r, 20));
        return await db.select().from(temples);
      }),
      withTenantContext(tenantB.id, async ({ db }) => {
        await new Promise((r) => setTimeout(r, 10));
        return await db.select().from(temples);
      }),
    ]);

    expect(rowsA.length).toBe(1);
    expect(rowsA[0].id).toBe(templeA.id);

    expect(rowsB.length).toBe(1);
    expect(rowsB[0].id).toBe(templeB.id);
  });
});
