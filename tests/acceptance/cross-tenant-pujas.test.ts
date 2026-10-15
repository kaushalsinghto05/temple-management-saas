import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser, signIn } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { createPujaService, setPujaStatus } from '@/modules/pujas/puja-service';
import { GET as getPujaRoute, PATCH as updatePujaRoute } from '@/app/api/admin/pujas/[id]/route';
import { POST as publishPujaRoute } from '@/app/api/admin/pujas/[id]/publish/route';
import { POST as createSlotRoute } from '@/app/api/admin/pujas/[id]/slots/route';
import { NextRequest } from 'next/server';

describe('Acceptance Test: Cross-Tenant Isolation on Puja Services', () => {
  let tenantA: any;
  let tenantB: any;
  let templeA: any;
  let templeB: any;
  let pujaB: any;
  let tokenA: string;

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

    // Tenant A
    tenantA = await createTenant({
      name: 'Tenant A Trust',
      slug: 'tenant-a-trust',
      actorUserId: rootAdmin.id,
    });

    templeA = await createTemple({
      tenantId: tenantA.id,
      name: 'Temple A',
      slug: 'temple-a',
      address: { line1: '1 A St', city: 'City A', state: 'State A', postalCode: '111111', country: 'India' },
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // Tenant B
    tenantB = await createTenant({
      name: 'Tenant B Trust',
      slug: 'tenant-b-trust',
      actorUserId: rootAdmin.id,
    });

    templeB = await createTemple({
      tenantId: tenantB.id,
      name: 'Temple B',
      slug: 'temple-b',
      address: { line1: '2 B St', city: 'City B', state: 'State B', postalCode: '222222', country: 'India' },
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // Puja in Tenant B
    pujaB = await createPujaService({
      tenantId: tenantB.id,
      templeId: templeB.id,
      name: 'Secret Tantric Puja in B',
      description: 'Private ritual of Tenant B',
      durationMinutes: 60,
      priceMinorUnits: 500000,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // Admin A in Tenant A only
    const userA = await registerUser({
      email: 'admin.a@tenant-a.org',
      password: 'AdminPassword123!',
      fullName: 'Admin of Tenant A',
    });

    await inviteMember({
      tenantId: tenantA.id,
      email: 'admin.a@tenant-a.org',
      role: 'TEMPLE_ADMIN',
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });

    const loginRes = await signIn({
      identifier: 'admin.a@tenant-a.org',
      password: 'AdminPassword123!',
    });
    tokenA = loginRes.session.token;
  });

  it('Cross-tenant read: Admin A requesting Puja B by ID is DENIED (403/404)', async () => {
    // 1. With Tenant B's ID in header (unauthorized tenant context) -> 403
    const req1 = new NextRequest(`http://localhost/api/admin/pujas/${pujaB.id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-id': tenantB.id,
      },
    });

    const res1 = await getPujaRoute(req1, { params: Promise.resolve({ id: pujaB.id }) });
    expect(res1.status).toBe(403);
    const json1 = await res1.json();
    expect(json1.success).toBe(false);
    expect(JSON.stringify(json1)).not.toContain('Secret Tantric Puja');

    // 2. With Tenant A's ID in header -> 404 (pujaB doesn't belong to tenant A)
    const req2 = new NextRequest(`http://localhost/api/admin/pujas/${pujaB.id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-id': tenantA.id,
      },
    });

    const res2 = await getPujaRoute(req2, { params: Promise.resolve({ id: pujaB.id }) });
    expect(res2.status).toBe(404);
  });

  it('Cross-tenant mutation: Admin A cannot modify Puja B or add slots', async () => {
    // Attempt update
    const reqUpdate = new NextRequest(`http://localhost/api/admin/pujas/${pujaB.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-id': tenantA.id,
      },
      body: JSON.stringify({ name: 'Tampered Puja' }),
    });

    const resUpdate = await updatePujaRoute(reqUpdate, { params: Promise.resolve({ id: pujaB.id }) });
    expect(resUpdate.status).toBe(404);

    // Attempt add slot
    const reqSlot = new NextRequest(`http://localhost/api/admin/pujas/${pujaB.id}/slots`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-id': tenantA.id,
      },
      body: JSON.stringify({
        templeId: templeA.id,
        startTime: new Date(Date.now() + 1000000).toISOString(),
        endTime: new Date(Date.now() + 2000000).toISOString(),
        totalCapacity: 20,
      }),
    });

    const resSlot = await createSlotRoute(reqSlot, { params: Promise.resolve({ id: pujaB.id }) });
    expect(resSlot.status).toBe(404);
  });
});
