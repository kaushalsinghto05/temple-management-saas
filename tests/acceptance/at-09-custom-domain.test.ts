import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import {
  configureCustomDomain,
  verifyCustomDomain,
  resolveTempleByCustomDomain,
} from '@/modules/white-label/white-label-service';
import { getAuditLogs } from '@/modules/audit/audit-service';
import { UserContext } from '@/core/rbac/guard';
import { ForbiddenError, NotFoundError, ValidationError } from '@/core/errors';
import { NextRequest } from 'next/server';
import { POST as configureDomainRoute } from '@/app/api/admin/temples/[id]/custom-domain/route';
import { POST as verifyDomainRoute } from '@/app/api/admin/temples/[id]/custom-domain/verify/route';
import { GET as resolveDomainRoute } from '@/app/api/public/custom-domain/route';
import { signIn } from '@/modules/auth/auth-service';

describe('Acceptance Test AT-09: Custom Domain Verification & Isolation (FR-WL-005)', () => {
  let tenantA: any;
  let templeA: any;
  let tenantB: any;
  let templeB: any;
  let adminA: any;
  let adminB: any;
  let priestA: any;
  let devoteeUser: any;
  let adminAContext: UserContext;
  let adminBContext: UserContext;
  let priestAContext: UserContext;
  let devoteeContext: UserContext;
  let adminASessionToken: string;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    // 1. Seed Root User & Tenants
    const rootAdmin = await registerUser({
      email: 'root@platform.trust',
      fullName: 'Platform Super Admin',
      isPlatformAdmin: true,
    });

    tenantA = await createTenant({
      name: 'Somnath Temple Trust',
      slug: 'somnath',
      actorUserId: rootAdmin.id,
    });

    templeA = await createTemple({
      tenantId: tenantA.id,
      name: 'Shree Somnath Jyotirlinga',
      slug: 'jyotirlinga',
      timezone: 'Asia/Kolkata',
      address: {
        line1: 'Prabhas Kshetra',
        city: 'Prabhas Patan',
        state: 'Gujarat',
        country: 'IN',
        postalCode: '362268',
      },
      branding: {
        primaryColor: '#D97706',
        accentColor: '#B45309',
        description: 'First among the twelve Aadi Jyotirlingas',
      },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    tenantB = await createTenant({
      name: 'Kashi Vishwanath Trust',
      slug: 'kashi',
      actorUserId: rootAdmin.id,
    });

    templeB = await createTemple({
      tenantId: tenantB.id,
      name: 'Kashi Vishwanath Temple',
      slug: 'vishwanath',
      timezone: 'Asia/Kolkata',
      address: {
        line1: 'Lahori Tola',
        city: 'Varanasi',
        state: 'Uttar Pradesh',
        country: 'IN',
        postalCode: '221001',
      },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // 2. Setup users & memberships
    adminA = await registerUser({
      email: 'admin@somnath.org',
      password: 'AdminPassword123!',
      fullName: 'Somnath Admin',
    });
    const authResult = await signIn({
      identifier: 'admin@somnath.org',
      password: 'AdminPassword123!',
    });
    adminASessionToken = authResult.session.token;
    const memA = await inviteMember({
      tenantId: tenantA.id,
      email: 'admin@somnath.org',
      role: 'TRUST_ADMIN',
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    adminAContext = {
      userId: adminA.id,
      isPlatformAdmin: false,
      memberships: [memA],
    };

    adminB = await registerUser({ email: 'admin@kashi.org', fullName: 'Kashi Admin' });
    const memB = await inviteMember({
      tenantId: tenantB.id,
      email: 'admin@kashi.org',
      role: 'TRUST_ADMIN',
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    adminBContext = {
      userId: adminB.id,
      isPlatformAdmin: false,
      memberships: [memB],
    };

    priestA = await registerUser({ email: 'priest@somnath.org', fullName: 'Somnath Priest' });
    const memPriest = await inviteMember({
      tenantId: tenantA.id,
      email: 'priest@somnath.org',
      role: 'PRIEST',
      assignedTempleId: templeA.id,
      invitedByUserId: adminA.id,
      actorRole: 'TRUST_ADMIN',
    });
    priestAContext = {
      userId: priestA.id,
      isPlatformAdmin: false,
      memberships: [memPriest],
    };

    devoteeUser = await registerUser({ email: 'devotee@gmail.com', fullName: 'Anand Devotee' });
    devoteeContext = {
      userId: devoteeUser.id,
      isPlatformAdmin: false,
      memberships: [],
    };
  });

  it('AT-09: Unverified custom domain remains inactive and public resolution fails until verified', async () => {
    const domainName = 'somnath-darshan.org';

    // 1. Staff configures custom domain
    const domainRecord = await configureCustomDomain({
      tenantId: tenantA.id,
      templeId: templeA.id,
      domain: domainName,
      userContext: adminAContext,
    });

    expect(domainRecord).toBeDefined();
    expect(domainRecord.domain).toBe('somnath-darshan.org');
    expect(domainRecord.status).toBe('PENDING_VERIFICATION');
    expect(domainRecord.verificationToken).toMatch(/^trust-verify-[a-f0-9]{32}$/);
    expect(domainRecord.verifiedAt).toBeNull();

    // 2. Devotee / public attempts to access temple via unverified domain -> REJECTED (404 / inactive)
    await expect(resolveTempleByCustomDomain(domainName)).rejects.toThrowError(
      NotFoundError
    );
    await expect(resolveTempleByCustomDomain(domainName)).rejects.toThrowError(
      /is not active or verified/
    );

    // Also verify public API route returns 404
    const publicReq = new NextRequest(`http://localhost:3000/api/public/custom-domain?domain=${domainName}`);
    const publicRes = await resolveDomainRoute(publicReq);
    expect(publicRes.status).toBe(404);
    const publicBody = await publicRes.json();
    expect(publicBody.success).toBe(false);
    expect(publicBody.error.message).toContain('is not active or verified');

    // 3. Verification attempt with WRONG token fails
    await expect(
      verifyCustomDomain({
        tenantId: tenantA.id,
        domainId: domainRecord.id,
        verificationToken: 'trust-verify-wrong-token-12345',
        userContext: adminAContext,
      })
    ).rejects.toThrowError(ValidationError);

    // Assert domain is still unverified
    await expect(resolveTempleByCustomDomain(domainName)).rejects.toThrowError(NotFoundError);

    // 4. Unauthorized staff (PRIEST or Devotee) cannot verify domain
    await expect(
      verifyCustomDomain({
        tenantId: tenantA.id,
        domainId: domainRecord.id,
        verificationToken: domainRecord.verificationToken,
        userContext: priestAContext,
      })
    ).rejects.toThrowError(ForbiddenError);

    // Cross-tenant admin (Tenant B Admin) cannot verify domain of Tenant A
    await expect(
      verifyCustomDomain({
        tenantId: tenantB.id,
        domainId: domainRecord.id,
        verificationToken: domainRecord.verificationToken,
        userContext: adminBContext,
      })
    ).rejects.toThrowError(NotFoundError);

    // 5. Authorized admin provides valid verification token -> Domain transitions to ACTIVE
    const verifiedRecord = await verifyCustomDomain({
      tenantId: tenantA.id,
      domainId: domainRecord.id,
      verificationToken: domainRecord.verificationToken,
      userContext: adminAContext,
    });

    expect(verifiedRecord.status).toBe('ACTIVE');
    expect(verifiedRecord.verifiedAt).toBeInstanceOf(Date);

    // 6. Public resolution now SUCCEEDS and returns the full white-label profile
    const publicProfile = await resolveTempleByCustomDomain(domainName);
    expect(publicProfile).toBeDefined();
    expect(publicProfile.id).toBe(templeA.id);
    expect(publicProfile.name).toBe('Shree Somnath Jyotirlinga');
    expect(publicProfile.tenantSlug).toBe('somnath');
    expect(publicProfile.timezone).toBe('Asia/Kolkata');
    expect(publicProfile.branding.primaryColor).toBe('#D97706');

    // HTTP endpoint also succeeds with 200
    const verifiedPublicReq = new NextRequest(`http://localhost:3000/api/public/custom-domain?domain=${domainName}`);
    const verifiedPublicRes = await resolveDomainRoute(verifiedPublicReq);
    expect(verifiedPublicRes.status).toBe(200);
    const verifiedBody = await verifiedPublicRes.json();
    expect(verifiedBody.success).toBe(true);
    expect(verifiedBody.data.id).toBe(templeA.id);
    expect(verifiedBody.data.name).toBe('Shree Somnath Jyotirlinga');

    // 7. Verify audit trail records both actions
    const auditLogs = await getAuditLogs({
      tenantId: tenantA.id,
    });

    const domainAuditEvents = auditLogs.filter((l: any) => l.resourceType === 'custom_domain');
    expect(domainAuditEvents.length).toBeGreaterThanOrEqual(2);

    const configEvent = domainAuditEvents.find((l: any) => l.action === 'custom_domain.configured');
    expect(configEvent).toBeDefined();
    expect(configEvent?.actorId).toBe(adminA.id);

    const verifyEvent = domainAuditEvents.find((l: any) => l.action === 'custom_domain.verified');
    expect(verifyEvent).toBeDefined();
    expect(verifyEvent?.actorId).toBe(adminA.id);
    expect(verifyEvent?.changesSummary).toHaveProperty('status', 'ACTIVE');
  });

  it('AT-09: End-to-end REST API flow for domain configuration and verification', async () => {
    const domainName = 'live-darshan.somnath.org';

    // 1. Configure custom domain via REST API
    const configReq = new NextRequest(`http://localhost:3000/api/admin/temples/${templeA.id}/custom-domain`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${adminASessionToken}`,
        'x-tenant-id': tenantA.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        domain: domainName,
      }),
    });

    const configRes = await configureDomainRoute(configReq, {
      params: Promise.resolve({ id: templeA.id }),
    });

    expect(configRes.status).toBe(201);
    const configData = await configRes.json();
    expect(configData.success).toBe(true);
    expect(configData.data.domain).toBe('live-darshan.somnath.org');
    expect(configData.data.status).toBe('PENDING_VERIFICATION');

    const domainId = configData.data.id;
    const token = configData.data.verificationToken;

    // 2. Verify custom domain via REST API
    const verifyReq = new NextRequest(`http://localhost:3000/api/admin/temples/${templeA.id}/custom-domain/verify`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${adminASessionToken}`,
        'x-tenant-id': tenantA.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        domainId,
        verificationToken: token,
      }),
    });

    const verifyRes = await verifyDomainRoute(verifyReq, {
      params: Promise.resolve({ id: templeA.id }),
    });

    expect(verifyRes.status).toBe(200);
    const verifyData = await verifyRes.json();
    expect(verifyData.success).toBe(true);
    expect(verifyData.data.status).toBe('ACTIVE');

    // 3. Resolve verified domain via REST API
    const resolveReq = new NextRequest(`http://localhost:3000/api/public/custom-domain?domain=${domainName}`);
    const resolveRes = await resolveDomainRoute(resolveReq);
    expect(resolveRes.status).toBe(200);
    const resolveData = await resolveRes.json();
    expect(resolveData.success).toBe(true);
    expect(resolveData.data.name).toBe('Shree Somnath Jyotirlinga');
  });
});
