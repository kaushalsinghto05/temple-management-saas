import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant, updateTenantStatus, getTenantById } from '@/modules/tenants/tenant-service';
import { createTemple, getTempleById, listTemplesByTenant, updateTemple } from '@/modules/temples/temple-service';
import { ConflictError, NotFoundError } from '@/core/errors';

describe('Integration: Tenants & Temples (FR-TEN-001 to 005)', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();
  });

  it('FR-TEN-001: should allow platform admin to create, suspend, and reactivate tenants', async () => {
    const adminId = '00000000-0000-0000-0000-000000000001';

    const tenant = await createTenant({
      name: 'Shri Somnath Religious Trust',
      slug: 'somnath-trust',
      actorUserId: adminId,
    });

    expect(tenant.id).toBeDefined();
    expect(tenant.status).toBe('ACTIVE');
    expect(tenant.slug).toBe('somnath-trust');

    // Suspend tenant
    const suspended = await updateTenantStatus({
      tenantId: tenant.id,
      status: 'SUSPENDED',
      actorUserId: adminId,
    });
    expect(suspended.status).toBe('SUSPENDED');

    // Reactivate tenant
    const reactivated = await updateTenantStatus({
      tenantId: tenant.id,
      status: 'ACTIVE',
      actorUserId: adminId,
    });
    expect(reactivated.status).toBe('ACTIVE');
  });

  it('FR-TEN-002 & 003: should support 1:N temples per tenant with timezone and branding defaults', async () => {
    const adminId = '00000000-0000-0000-0000-000000000001';
    const tenant = await createTenant({
      name: 'Kashi Vishwanath Trust',
      slug: 'kashi-trust',
      actorUserId: adminId,
    });

    // Create Temple 1 (Main branch)
    const temple1 = await createTemple({
      tenantId: tenant.id,
      name: 'Kashi Vishwanath Main Mandir',
      slug: 'main-mandir',
      address: {
        line1: 'Lahori Tola',
        city: 'Varanasi',
        state: 'Uttar Pradesh',
        postalCode: '221001',
        country: 'India',
      },
      branding: {
        primaryColor: '#ff6f00',
        description: 'Holy shrine of Lord Shiva',
      },
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    expect(temple1.timezone).toBe('Asia/Kolkata'); // default timezone
    expect(temple1.branding.primaryColor).toBe('#ff6f00');

    // Create Temple 2 (Annapurna branch under same trust)
    const temple2 = await createTemple({
      tenantId: tenant.id,
      name: 'Maa Annapurna Mandir',
      slug: 'annapurna-mandir',
      address: {
        line1: 'Near Vishwanath Corridor',
        city: 'Varanasi',
        state: 'Uttar Pradesh',
        postalCode: '221001',
        country: 'India',
      },
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    const templesList = await listTemplesByTenant(tenant.id);
    expect(templesList.length).toBe(2);
    expect(templesList.map((t) => t.slug)).toContain('main-mandir');
    expect(templesList.map((t) => t.slug)).toContain('annapurna-mandir');

    // Update Temple details
    const updated = await updateTemple({
      tenantId: tenant.id,
      templeId: temple1.id,
      name: 'Kashi Vishwanath Jyotirlinga Dham',
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });
    expect(updated.name).toBe('Kashi Vishwanath Jyotirlinga Dham');
  });

  it('FR-TEN-005: should enforce unique temple slugs within same tenant but allow across different tenants', async () => {
    const adminId = '00000000-0000-0000-0000-000000000001';

    const tenantA = await createTenant({
      name: 'Trust A',
      slug: 'trust-a',
      actorUserId: adminId,
    });

    const tenantB = await createTenant({
      name: 'Trust B',
      slug: 'trust-b',
      actorUserId: adminId,
    });

    // Create 'shiva-shrine' in Tenant A
    await createTemple({
      tenantId: tenantA.id,
      name: 'Shiva Shrine A',
      slug: 'shiva-shrine',
      address: { line1: 'Road 1', city: 'City', state: 'State', postalCode: '100001', country: 'India' },
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    // Attempt duplicate 'shiva-shrine' in Tenant A -> should throw ConflictError
    await expect(
      createTemple({
        tenantId: tenantA.id,
        name: 'Another Shiva Shrine in A',
        slug: 'shiva-shrine',
        address: { line1: 'Road 2', city: 'City', state: 'State', postalCode: '100001', country: 'India' },
        actorUserId: adminId,
        actorRole: 'TRUST_ADMIN',
      })
    ).rejects.toThrow(ConflictError);

    // Creating same slug 'shiva-shrine' in Tenant B -> MUST SUCCEED (tenant-scoped slug uniqueness)
    const templeInB = await createTemple({
      tenantId: tenantB.id,
      name: 'Shiva Shrine in B',
      slug: 'shiva-shrine',
      address: { line1: 'Road B', city: 'City B', state: 'State', postalCode: '100002', country: 'India' },
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    expect(templeInB.slug).toBe('shiva-shrine');
    expect(templeInB.tenantId).toBe(tenantB.id);
  });
});
