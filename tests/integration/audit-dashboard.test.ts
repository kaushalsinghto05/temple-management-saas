import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { logAuditEvent, getAuditLogs, sanitizeAuditData } from '@/modules/audit/audit-service';
import { getReconciliationQueue } from '@/modules/operations/operations-service';
import { UserContext } from '@/core/rbac/guard';
import { getDb } from '@/db/client';
import { payments } from '@/db/schema';

describe('Integration: Audit Dashboard, Redaction & Reconciliation Queue (FR-AUD-001..005)', () => {
  let tenant: any;
  let temple: any;
  let adminUser: any;
  let adminContext: UserContext;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.aud@trust.org',
      fullName: 'Audit Admin',
    });

    tenant = await createTenant({
      name: 'Puri Jagannath Trust',
      slug: 'jagannath-puri',
      actorUserId: rootAdmin.id,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Shree Jagannath Mandir',
      slug: 'jagannath-mandir',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Grand Road', city: 'Puri', state: 'Odisha', postalCode: '752001', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    adminUser = await registerUser({
      email: 'trustee@puri.org',
      fullName: 'Trustee Panda',
      password: 'Password123!',
    });
    const adminMem = await inviteMember({
      tenantId: tenant.id,
      email: adminUser.email as string,
      role: 'TRUST_ADMIN',
      assignedTempleId: temple.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    adminContext = {
      userId: adminUser.id,
      isPlatformAdmin: false,
      memberships: [adminMem],
    };
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it('FR-AUD-003: Automatically redacts sensitive fields like passwords, secrets, and tokens from audit data', () => {
    const rawData = {
      email: 'user@example.com',
      password: 'SuperSecretPassword!',
      password_hash: 'argon2id$v=19$m=65536...',
      apiKey: 'sec_api_key_12345',
      webhookSecret: 'whsec_99999999',
      metadata: {
        token: 'session_token_abc',
        publicNote: 'Approved donation',
      },
    };

    const sanitized = sanitizeAuditData(rawData);

    expect(sanitized.email).toBe('user@example.com');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.password_hash).toBe('[REDACTED]');
    expect(sanitized.apiKey).toBe('[REDACTED]');
    expect(sanitized.webhookSecret).toBe('[REDACTED]');
    expect((sanitized.metadata as any).token).toBe('[REDACTED]');
    expect((sanitized.metadata as any).publicNote).toBe('Approved donation');
  });

  it('FR-AUD-001 & 002: Logs audit entries with request ID, actor ID, and allows filtered querying', async () => {
    await logAuditEvent({
      tenantId: tenant.id,
      actorId: adminUser.id,
      actorRole: 'TRUST_ADMIN',
      action: 'temple.settings_updated',
      resourceType: 'temple',
      resourceId: temple.id,
      changesSummary: {
        field: 'branding',
        oldColor: '#ffffff',
        newColor: '#ff9900',
      },
    });

    const logs = await getAuditLogs({
      tenantId: tenant.id,
      action: 'temple.settings_updated',
    });

    expect(logs.length).toBe(1);
    expect(logs[0].actorId).toBe(adminUser.id);
    expect(logs[0].actorRole).toBe('TRUST_ADMIN');
    expect(logs[0].action).toBe('temple.settings_updated');
    expect(logs[0].resourceType).toBe('temple');
    expect(logs[0].resourceId).toBe(temple.id);
    expect(logs[0].requestId).toBeDefined();
    expect(logs[0].changesSummary).toEqual({
      field: 'branding',
      oldColor: '#ffffff',
      newColor: '#ff9900',
    });
  });

  it('FR-AUD-004 & 005: Finance staff can inspect quarantined payment exceptions via reconciliation queue', async () => {
    const db = getDb();

    // Insert payment requiring reconciliation (e.g. amount mismatch)
    await db.insert(payments).values({
      tenantId: tenant.id,
      templeId: temple.id,
      referenceType: 'BOOKING',
      provider: 'MOCK',
      providerOrderId: 'ord_mismatch_123',
      providerPaymentId: 'pay_mismatch_123',
      amountMinorUnits: 50000,
      currency: 'INR',
      status: 'RECONCILIATION_REQUIRED',
      reconciliationReason: 'Amount mismatch: expected 50000 INR, received 25000 INR',
    });

    const queue = await getReconciliationQueue({
      tenantId: tenant.id,
      templeId: temple.id,
      userContext: adminContext,
    });

    expect(queue.length).toBe(1);
    expect(queue[0].status).toBe('RECONCILIATION_REQUIRED');
    expect(queue[0].reconciliationReason).toContain('Amount mismatch');
  });
});
