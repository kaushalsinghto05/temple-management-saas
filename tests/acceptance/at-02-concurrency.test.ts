import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { createPujaService, setPujaStatus, createPujaTimeSlot } from '@/modules/pujas/puja-service';
import { reservePujaSlot } from '@/modules/bookings/booking-service';
import { configureTemplePayment } from '@/modules/payments/payment-service';

describe('Acceptance Test AT-02: High-Concurrency Capacity Hold & Zero Overselling', () => {
  let tenant: any;
  let temple: any;
  let puja: any;
  let slot: any;
  let adminId: string;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.concurrency@shrine.org',
      fullName: 'Concurrency Test Admin',
    });
    adminId = rootAdmin.id;

    tenant = await createTenant({
      name: 'Simultaneous Booking Trust',
      slug: 'concurrency-trust',
      actorUserId: adminId,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Holy Sanctum',
      slug: 'holy-sanctum',
      address: { line1: 'Main St', city: 'Varanasi', state: 'UP', postalCode: '221001', country: 'India' },
      published: true,
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_mock_concurrency',
      webhookSecret: 'secret_concurrency_key',
      apiKey: 'api_mock_key',
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    puja = await createPujaService({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'VIP Sanctum Darshan',
      durationMinutes: 30,
      priceMinorUnits: 250000, // ₹2,500.00
      currency: 'INR',
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });
    await setPujaStatus(tenant.id, puja.id, 'PUBLISHED', adminId, 'TEMPLE_ADMIN');

    // Create a time slot with EXACTLY 1 SEAT capacity
    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    slot = await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      startTime,
      endTime,
      totalCapacity: 1, // Only 1 seat available!
      actorUserId: adminId,
      actorRole: 'PUJA_MANAGER',
    });
  });

  it('AT-02: Two (or more) devotees book the final seat simultaneously -> exactly 1 succeeds, no overselling occurs', async () => {
    const concurrentDevotees = 15; // 15 simultaneous requests competing for 1 seat

    const bookingPromises = Array.from({ length: concurrentDevotees }).map((_, index) => {
      return reservePujaSlot({
        tenantId: tenant.id,
        templeId: temple.id,
        pujaServiceId: puja.id,
        slotId: slot.id,
        participantCount: 1,
        devoteeDetails: {
          name: `Devotee #${index + 1}`,
          email: `devotee${index + 1}@example.com`,
          phone: `+91987654321${index % 10}`,
        },
      })
        .then((res) => ({ success: true as const, res }))
        .catch((err) => ({ success: false as const, error: err }));
    });

    const results = await Promise.all(bookingPromises);

    const successfulBookings = results.filter((r): r is { success: true; res: any } => r.success);
    const failedBookings = results.filter((r): r is { success: false; error: any } => !r.success);

    // EXACTLY 1 booking must succeed
    expect(successfulBookings.length).toBe(1);
    expect(successfulBookings[0].res?.booking.status).toBe('PENDING_PAYMENT');
    expect(successfulBookings[0].res?.booking.participantCount).toBe(1);

    // EXACTLY 14 bookings must fail with ConflictError (capacity exceeded)
    expect(failedBookings.length).toBe(concurrentDevotees - 1);
    for (const fail of failedBookings) {
      expect(fail.error.message).toContain('Capacity exceeded');
    }
  });
});
