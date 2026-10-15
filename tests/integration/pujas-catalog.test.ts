import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import {
  createPujaService,
  updatePujaService,
  setPujaStatus,
  getPujaServiceById,
  createPujaTimeSlot,
  listSlotsForPuja,
} from '@/modules/pujas/puja-service';
import { ValidationError, NotFoundError } from '@/core/errors';

describe('Integration: Puja Services & Schedules (FR-PUJA-001 to 005)', () => {
  let tenant: any;
  let temple: any;
  let adminId: string;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin@shrine.org',
      fullName: 'Temple Admin',
    });
    adminId = rootAdmin.id;

    tenant = await createTenant({
      name: 'Vedic Heritage Trust',
      slug: 'vedic-heritage',
      actorUserId: adminId,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Shri Ram Mandir',
      slug: 'ram-mandir',
      address: { line1: 'Ayodhya Marg', city: 'Ayodhya', state: 'Uttar Pradesh', postalCode: '224123', country: 'India' },
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });
  });

  it('FR-PUJA-001 & 002: should create, edit, publish, and archive a puja service with integer minor units pricing', async () => {
    // 1. Create puja in DRAFT
    const puja = await createPujaService({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Maha Rudrabhishekam',
      description: 'Sacred Vedic chanting and panchamrit abhishek',
      durationMinutes: 45,
      priceMinorUnits: 110000, // ₹1,100.00
      currency: 'INR',
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });

    expect(puja.id).toBeDefined();
    expect(puja.status).toBe('DRAFT');
    expect(puja.priceMinorUnits).toBe(110000);
    expect(puja.currency).toBe('INR');

    // 2. Edit puja details
    const updated = await updatePujaService({
      tenantId: tenant.id,
      pujaId: puja.id,
      name: 'Special Maha Rudrabhishekam',
      priceMinorUnits: 150000, // ₹1,500.00
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });

    expect(updated.name).toBe('Special Maha Rudrabhishekam');
    expect(updated.priceMinorUnits).toBe(150000);

    // 3. Publish puja service
    const published = await setPujaStatus(tenant.id, puja.id, 'PUBLISHED', adminId, 'TEMPLE_ADMIN');
    expect(published.status).toBe('PUBLISHED');

    // 4. Archive puja service
    const archived = await setPujaStatus(tenant.id, puja.id, 'ARCHIVED', adminId, 'TEMPLE_ADMIN');
    expect(archived.status).toBe('ARCHIVED');
  });

  it('FR-PUJA-002: should validate puja duration and non-negative pricing', async () => {
    // Negative duration should fail
    await expect(
      createPujaService({
        tenantId: tenant.id,
        templeId: temple.id,
        name: 'Invalid Duration Puja',
        durationMinutes: 0,
        priceMinorUnits: 50000,
        actorUserId: adminId,
        actorRole: 'TEMPLE_ADMIN',
      })
    ).rejects.toThrow(ValidationError);

    // Negative price should fail
    await expect(
      createPujaService({
        tenantId: tenant.id,
        templeId: temple.id,
        name: 'Negative Price Puja',
        durationMinutes: 30,
        priceMinorUnits: -100,
        actorUserId: adminId,
        actorRole: 'TEMPLE_ADMIN',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('FR-PUJA-003 & 005: should create time slots and enforce service/temple relationship validation', async () => {
    const puja = await createPujaService({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Navagraha Shanti Puja',
      durationMinutes: 60,
      priceMinorUnits: 250000, // ₹2,500.00
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });

    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour later

    // Create valid slot
    const slot = await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      startTime,
      endTime,
      totalCapacity: 10,
      actorUserId: adminId,
      actorRole: 'PUJA_MANAGER',
    });

    expect(slot.id).toBeDefined();
    expect(slot.totalCapacity).toBe(10);
    expect(slot.allocatedCapacity).toBe(0);
    expect(slot.availabilityStatus).toBe('AVAILABLE');

    // Invalid time slot: endTime <= startTime
    await expect(
      createPujaTimeSlot({
        tenantId: tenant.id,
        templeId: temple.id,
        pujaServiceId: puja.id,
        startTime: endTime,
        endTime: startTime, // inverted!
        totalCapacity: 10,
        actorUserId: adminId,
        actorRole: 'PUJA_MANAGER',
      })
    ).rejects.toThrow(ValidationError);

    // Mismatched temple/service relationship (FR-PUJA-005): passing arbitrary non-existent temple ID
    const randomTempleId = '11111111-2222-3333-4444-555555555555';
    await expect(
      createPujaTimeSlot({
        tenantId: tenant.id,
        templeId: randomTempleId,
        pujaServiceId: puja.id,
        startTime,
        endTime,
        totalCapacity: 10,
        actorUserId: adminId,
        actorRole: 'PUJA_MANAGER',
      })
    ).rejects.toThrow(NotFoundError);

    const slots = await listSlotsForPuja(tenant.id, puja.id);
    expect(slots.length).toBe(1);
    expect(slots[0].id).toBe(slot.id);
  });
});
