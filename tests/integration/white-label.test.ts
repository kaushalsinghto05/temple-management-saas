import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant, updateTenantStatus } from '@/modules/tenants/tenant-service';
import { createTemple, updateTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { createPujaService, setPujaStatus, updatePujaService, createPujaTimeSlot } from '@/modules/pujas/puja-service';
import {
  resolvePublicTemple,
  getPublicPujaCatalog,
  captureServiceSnapshot,
} from '@/modules/white-label/white-label-service';
import { NotFoundError } from '@/core/errors';

describe('Integration: White-Label Public Experience & Catalog Availability (FR-WL-001 to 004, FR-PUJA-004, 006)', () => {
  let tenant: any;
  let publishedTemple: any;
  let draftTemple: any;
  let adminId: string;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin@tirupati.org',
      fullName: 'Tirupati Admin',
    });
    adminId = rootAdmin.id;

    tenant = await createTenant({
      name: 'Tirumala Tirupati Devasthanams',
      slug: 'ttd-trust',
      actorUserId: adminId,
    });

    // 1. Published active temple
    publishedTemple = await createTemple({
      tenantId: tenant.id,
      name: 'Sri Venkateswara Temple',
      slug: 'tirumala-main',
      address: { line1: 'Tirumala Hills', city: 'Tirupati', state: 'Andhra Pradesh', postalCode: '517504', country: 'India' },
      branding: {
        primaryColor: '#c49000',
        logoUrl: 'https://cdn.temple.org/logo.png',
        description: 'Abode of Lord Venkateswara',
      },
      published: true, // PUBLISHED
      operatingStatus: 'ACTIVE',
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    // 2. Draft temple (not published)
    draftTemple = await createTemple({
      tenantId: tenant.id,
      name: 'Upcoming Padmavathi Branch',
      slug: 'padmavathi-branch',
      address: { line1: 'Tiruchanoor', city: 'Tirupati', state: 'Andhra Pradesh', postalCode: '517503', country: 'India' },
      published: false, // DRAFT / UNPUBLISHED
      operatingStatus: 'ACTIVE',
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });
  });

  it('FR-WL-001 & 002: should resolve public profile for published temple with branding', async () => {
    const profile = await resolvePublicTemple('ttd-trust', 'tirumala-main');

    expect(profile.name).toBe('Sri Venkateswara Temple');
    expect(profile.branding.primaryColor).toBe('#c49000');
    expect(profile.branding.logoUrl).toBe('https://cdn.temple.org/logo.png');
    expect(profile.timezone).toBe('Asia/Kolkata');
  });

  it('FR-WL-003 & 004: should strictly reject draft or unpublished temple profiles', async () => {
    // Attempting to resolve draft temple must throw NotFoundError (FR-WL-004)
    await expect(resolvePublicTemple('ttd-trust', 'padmavathi-branch')).rejects.toThrow(NotFoundError);
  });

  it('FR-WL-004: should reject public resolution if parent tenant is suspended', async () => {
    // Suspend the tenant
    await updateTenantStatus({
      tenantId: tenant.id,
      status: 'SUSPENDED',
      actorUserId: adminId,
    });

    // Resolution must fail because tenant is suspended
    await expect(resolvePublicTemple('ttd-trust', 'tirumala-main')).rejects.toThrow(NotFoundError);
  });

  it('FR-PUJA-004: public catalog must only include published pujas and valid future available slots', async () => {
    // Create Puja 1: Published
    const publishedPuja = await createPujaService({
      tenantId: tenant.id,
      templeId: publishedTemple.id,
      name: 'Suprabhatam Seva',
      durationMinutes: 30,
      priceMinorUnits: 50000, // ₹500.00
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });
    await setPujaStatus(tenant.id, publishedPuja.id, 'PUBLISHED', adminId, 'TEMPLE_ADMIN');

    // Create Puja 2: Draft
    const draftPuja = await createPujaService({
      tenantId: tenant.id,
      templeId: publishedTemple.id,
      name: 'Special Archana Seva',
      durationMinutes: 45,
      priceMinorUnits: 25000,
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });
    // Leave draftPuja in DRAFT status!

    // Add Future Slot for Published Puja (Tomorrow)
    const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 30 * 60 * 1000);
    const validFutureSlot = await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: publishedTemple.id,
      pujaServiceId: publishedPuja.id,
      startTime: futureStart,
      endTime: futureEnd,
      totalCapacity: 50,
      actorUserId: adminId,
      actorRole: 'PUJA_MANAGER',
    });

    // Add Past Slot for Published Puja (Yesterday)
    const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pastEnd = new Date(pastStart.getTime() + 30 * 60 * 1000);
    await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: publishedTemple.id,
      pujaServiceId: publishedPuja.id,
      startTime: pastStart,
      endTime: pastEnd,
      totalCapacity: 50,
      actorUserId: adminId,
      actorRole: 'PUJA_MANAGER',
    });

    // Fetch public catalog
    const catalog = await getPublicPujaCatalog('ttd-trust', 'tirumala-main');

    // 1. Only published pujas returned
    expect(catalog.pujas.length).toBe(1);
    expect(catalog.pujas[0].id).toBe(publishedPuja.id);
    expect(catalog.pujas[0].name).toBe('Suprabhatam Seva');

    // 2. Only future available slots returned (past slot excluded)
    expect(catalog.pujas[0].slots.length).toBe(1);
    expect(catalog.pujas[0].slots[0].id).toBe(validFutureSlot.id);
    expect(catalog.pujas[0].slots[0].availableCapacity).toBe(50);
  });

  it('FR-PUJA-006: historical snapshot preserves pricing and service details when service is later modified', async () => {
    const puja = await createPujaService({
      tenantId: tenant.id,
      templeId: publishedTemple.id,
      name: 'Kalyanotsavam Seva',
      description: 'Divine celestial wedding',
      durationMinutes: 120,
      priceMinorUnits: 100000, // ₹1,000.00
      currency: 'INR',
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });

    // Devotee books -> capture snapshot (FR-PUJA-006)
    const snapshot = captureServiceSnapshot(puja);
    expect(snapshot.name).toBe('Kalyanotsavam Seva');
    expect(snapshot.priceMinorUnits).toBe(100000);
    expect(snapshot.durationMinutes).toBe(120);

    // Later, Temple Admin updates the puja service price to ₹2,000.00
    await updatePujaService({
      tenantId: tenant.id,
      pujaId: puja.id,
      name: 'Grand Kalyanotsavam Seva',
      priceMinorUnits: 200000, // ₹2,000.00
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });

    // The snapshot captured during booking MUST remain completely unchanged!
    expect(snapshot.name).toBe('Kalyanotsavam Seva');
    expect(snapshot.priceMinorUnits).toBe(100000);
    expect(snapshot.priceMinorUnits).not.toBe(200000);
  });
});
