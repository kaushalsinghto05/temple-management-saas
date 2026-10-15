import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser, signIn } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { GET as getTempleRoute, PATCH as updateTempleRoute } from '@/app/api/admin/temples/[id]/route';
import { GET as listTemplesRoute } from '@/app/api/admin/temples/route';
import { NextRequest } from 'next/server';

describe('Acceptance Test AT-01: Cross-Tenant Isolation Enforcement', () => {
  let tenantA: any;
  let tenantB: any;
  let templeA: any;
  let templeB: any;
  let adminA: any;
  let tokenA: string;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    // Create root admin user in database to satisfy foreign keys
    const rootAdmin = await registerUser({
      email: 'root@platform.internal',
      fullName: 'Root Platform Admin',
      isPlatformAdmin: true,
    });
    const rootAdminId = rootAdmin.id;

    // 1. Create two isolated tenants
    tenantA = await createTenant({
      name: 'Somnath Religious Trust',
      slug: 'somnath-trust',
      actorUserId: rootAdminId,
    });

    tenantB = await createTenant({
      name: 'Kedarnath Religious Trust',
      slug: 'kedarnath-trust',
      actorUserId: rootAdminId,
    });

    // 2. Create temples in each tenant
    templeA = await createTemple({
      tenantId: tenantA.id,
      name: 'Shri Somnath Jyotirlinga',
      slug: 'somnath-main',
      address: { line1: 'Prabhas Patan', city: 'Veraval', state: 'Gujarat', postalCode: '362268', country: 'India' },
      branding: { primaryColor: '#ff9900', description: 'First Jyotirlinga' },
      actorUserId: rootAdminId,
      actorRole: 'TRUST_ADMIN',
    });

    templeB = await createTemple({
      tenantId: tenantB.id,
      name: 'Shri Kedarnath Dham',
      slug: 'kedarnath-main',
      address: { line1: 'Garhwal Himalayas', city: 'Rudraprayag', state: 'Uttarakhand', postalCode: '246445', country: 'India' },
      branding: { primaryColor: '#0066cc', description: 'Himalayan Shrine of Lord Shiva' },
      actorUserId: rootAdminId,
      actorRole: 'TRUST_ADMIN',
    });

    // 3. Register Admin A and assign TRUST_ADMIN role ONLY in Tenant A
    adminA = await registerUser({
      email: 'admin.a@somnath.org',
      password: 'SecureAdminPassword123!',
      fullName: 'Somnath Trust Admin',
    });

    await inviteMember({
      tenantId: tenantA.id,
      email: 'admin.a@somnath.org',
      role: 'TRUST_ADMIN',
      invitedByUserId: rootAdminId,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });

    // Log in as Admin A
    const loginResult = await signIn({
      identifier: 'admin.a@somnath.org',
      password: 'SecureAdminPassword123!',
    });
    tokenA = loginResult.session.token;
  });

  it('Scenario 1: Tenant A admin requests Tenant B resource by ID claiming Tenant B header -> Access is DENIED (403)', async () => {
    // Admin A sends request to get Temple B, claiming Tenant B's tenant context
    const req = new NextRequest(`http://localhost/api/admin/temples/${templeB.id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-id': tenantB.id,
      },
    });

    const res = await getTempleRoute(req, { params: Promise.resolve({ id: templeB.id }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('FORBIDDEN');
    expect(json.error.message).toContain('Access denied');
    // Ensure no sensitive data leaked from Tenant B
    expect(json.data).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('Kedarnath');
  });

  it('Scenario 2: Tenant A admin requests Tenant B resource by ID under Tenant A context -> Resource NOT FOUND (404)', async () => {
    // Admin A sends request to get Temple B using Admin A's own valid Tenant A context
    const req = new NextRequest(`http://localhost/api/admin/temples/${templeB.id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-id': tenantA.id,
      },
    });

    const res = await getTempleRoute(req, { params: Promise.resolve({ id: templeB.id }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
    expect(json.data).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('Kedarnath');
  });

  it('Scenario 3: Tenant A admin attempts to mutate Tenant B resource -> Request is rejected', async () => {
    const req = new NextRequest(`http://localhost/api/admin/temples/${templeB.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-id': tenantA.id,
      },
      body: JSON.stringify({ name: 'Hacked Kedarnath' }),
    });

    const res = await updateTempleRoute(req, { params: Promise.resolve({ id: templeB.id }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
  });

  it('Scenario 4: Tenant A admin queries temples listing -> Only Tenant A temples returned, zero Tenant B temples', async () => {
    const req = new NextRequest(`http://localhost/api/admin/temples`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-id': tenantA.id,
      },
    });

    const res = await listTemplesRoute(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].id).toBe(templeA.id);
    expect(json.data[0].name).toBe('Shri Somnath Jyotirlinga');

    // Confirm Tenant B data is strictly absent
    expect(JSON.stringify(json.data)).not.toContain('Kedarnath');
  });
});
