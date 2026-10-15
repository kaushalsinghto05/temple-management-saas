import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { createPujaService, createPujaTimeSlot, setPujaStatus } from '@/modules/pujas/puja-service';
import { configureTemplePayment, processWebhookEvent } from '@/modules/payments/payment-service';
import { reservePujaSlot } from '@/modules/bookings/booking-service';
import { checkInBooking, searchBookings } from '@/modules/operations/operations-service';
import { getAuditLogs } from '@/modules/audit/audit-service';
import { MockPaymentAdapter } from '@/modules/payments/adapters/mock-adapter';
import { UserContext } from '@/core/rbac/guard';
import { ForbiddenError, ValidationError, NotFoundError } from '@/core/errors';
import { getDb } from '@/db/client';
import { bookings } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('Integration: Operations, Attendance Check-In & Booking Search (FR-BOOK-006, FR-BOOK-007)', () => {
  let tenantA: any;
  let tenantB: any;
  let templeA: any;
  let templeB: any;
  let priestUser: any;
  let devoteeUser: any;
  let priestContext: UserContext;
  let devoteeContext: UserContext;
  let priestTenantBContext: UserContext;
  let pujaService: any;
  let slot: any;
  let confirmedBooking: any;
  const webhookSecret = 'secret_ops_test_123';

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.ops@trust.org',
      fullName: 'Operations Admin',
    });

    // 1. Create Tenant A and Temple A
    tenantA = await createTenant({
      name: 'Ujjain Mahakaleshwar Trust',
      slug: 'mahakal',
      actorUserId: rootAdmin.id,
    });

    templeA = await createTemple({
      tenantId: tenantA.id,
      name: 'Mahakaleshwar Jyotirlinga',
      slug: 'mahakaleshwar',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Jaisinghpura', city: 'Ujjain', state: 'MP', postalCode: '456006', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // 2. Create Tenant B and Temple B (for cross-tenant checks)
    tenantB = await createTenant({
      name: 'Omkareshwar Trust',
      slug: 'omkar',
      actorUserId: rootAdmin.id,
    });

    templeB = await createTemple({
      tenantId: tenantB.id,
      name: 'Omkareshwar Temple',
      slug: 'omkareshwar',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Mandhata Island', city: 'Khandwa', state: 'MP', postalCode: '450554', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // 3. Configure payments for Temple A
    await configureTemplePayment({
      tenantId: tenantA.id,
      templeId: templeA.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_mahakal_1',
      webhookSecret,
      apiKey: 'key_mahakal_1',
      actorUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });

    // 4. Register Priest in Tenant A
    priestUser = await registerUser({
      email: 'pujari@mahakal.org',
      fullName: 'Pandit Sharma',
      password: 'Password123!',
    });
    const priestMem = await inviteMember({
      tenantId: tenantA.id,
      email: priestUser.email as string,
      role: 'PRIEST',
      assignedTempleId: templeA.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    priestContext = {
      userId: priestUser.id,
      isPlatformAdmin: false,
      memberships: [priestMem],
    };

    // 5. Register Priest in Tenant B (cross-tenant)
    const priestB = await registerUser({
      email: 'pujari@omkar.org',
      fullName: 'Pandit Shastri',
      password: 'Password123!',
    });
    const priestBMem = await inviteMember({
      tenantId: tenantB.id,
      email: priestB.email as string,
      role: 'PRIEST',
      assignedTempleId: templeB.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    priestTenantBContext = {
      userId: priestB.id,
      isPlatformAdmin: false,
      memberships: [priestBMem],
    };

    // 6. Register Devotee
    devoteeUser = await registerUser({
      email: 'devotee.ops@example.com',
      fullName: 'Rohan Verma',
      password: 'Password123!',
    });
    const devoteeMem = await inviteMember({
      tenantId: tenantA.id,
      email: devoteeUser.email as string,
      role: 'DEVOTEE',
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    devoteeContext = {
      userId: devoteeUser.id,
      isPlatformAdmin: false,
      memberships: [devoteeMem],
    };

    // 7. Create Puja & Slot in Temple A
    pujaService = await createPujaService({
      tenantId: tenantA.id,
      templeId: templeA.id,
      name: 'Bhasma Aarti',
      durationMinutes: 90,
      priceMinorUnits: 150000, // ₹1,500.00
      currency: 'INR',
      actorUserId: priestUser.id,
      actorRole: 'PRIEST',
    });
    await setPujaStatus(tenantA.id, pujaService.id, 'PUBLISHED', priestUser.id, 'PRIEST');

    const now = new Date();
    const startTime = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 90 * 60 * 1000);

    slot = await createPujaTimeSlot({
      tenantId: tenantA.id,
      templeId: templeA.id,
      pujaServiceId: pujaService.id,
      startTime,
      endTime,
      totalCapacity: 50,
      actorUserId: priestUser.id,
      actorRole: 'PRIEST',
    });

    // 8. Reserve and Confirm Booking
    const reserveRes = await reservePujaSlot({
      tenantId: tenantA.id,
      templeId: templeA.id,
      pujaServiceId: pujaService.id,
      slotId: slot.id,
      participantCount: 2,
      devoteeDetails: { name: 'Rohan Verma', email: 'devotee.ops@example.com', phone: '9876543210' },
      devoteeUserId: devoteeUser.id,
      paymentProvider: 'MOCK',
    });

    const payload = JSON.stringify({
      event: 'payment.captured',
      event_id: `evt_mahakal_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: `pay_mahakal_${Date.now()}`,
            order_id: reserveRes.paymentOrder.providerOrderId,
            amount: 300000, // 2 * ₹1,500 = ₹3,000.00
            currency: 'INR',
          },
        },
      },
    });
    const sig = MockPaymentAdapter.signPayload(payload, webhookSecret);

    await processWebhookEvent({
      provider: 'MOCK',
      tenantId: tenantA.id,
      templeId: templeA.id,
      headers: { 'x-webhook-signature': sig },
      rawBody: payload,
    });

    const db = getDb();
    const [b] = await db.select().from(bookings).where(eq(bookings.id, reserveRes.booking.id));
    confirmedBooking = b;
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it('FR-BOOK-007: Priest can mark devotee attendance / check-in for confirmed booking', async () => {
    expect(confirmedBooking.status).toBe('CONFIRMED');
    expect(confirmedBooking.fulfillmentStatus).toBe('UNFULFILLED');

    // Priest checks in the devotee at the entrance
    const updated = await checkInBooking({
      tenantId: tenantA.id,
      bookingId: confirmedBooking.id,
      userContext: priestContext,
    });

    expect(updated.fulfillmentStatus).toBe('FULFILLED');

    // Verify DB state
    const db = getDb();
    const [inDb] = await db.select().from(bookings).where(eq(bookings.id, confirmedBooking.id));
    expect(inDb.fulfillmentStatus).toBe('FULFILLED');

    // Verify audit log
    const auditLogs = await getAuditLogs({
      tenantId: tenantA.id,
      action: 'booking.checked_in',
    });
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0].actorId).toBe(priestUser.id);
    expect(auditLogs[0].resourceId).toBe(confirmedBooking.id);
  });

  it('FR-BOOK-007: Rejects duplicate check-in if booking is already fulfilled', async () => {
    // First check-in succeeds
    await checkInBooking({
      tenantId: tenantA.id,
      bookingId: confirmedBooking.id,
      userContext: priestContext,
    });

    // Second check-in attempt is rejected
    await expect(
      checkInBooking({
        tenantId: tenantA.id,
        bookingId: confirmedBooking.id,
        userContext: priestContext,
      })
    ).rejects.toThrow(ValidationError);
  });

  it('FR-BOOK-007: Rejects check-in if devotee attempts to self-check-in without staff permissions', async () => {
    await expect(
      checkInBooking({
        tenantId: tenantA.id,
        bookingId: confirmedBooking.id,
        userContext: devoteeContext,
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('FR-BOOK-007: Cross-tenant isolation prevents staff from Tenant B checking in Tenant A booking', async () => {
    await expect(
      checkInBooking({
        tenantId: tenantB.id,
        bookingId: confirmedBooking.id,
        userContext: priestTenantBContext,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('FR-BOOK-006: Staff with bookings.read can search and filter bookings', async () => {
    const results = await searchBookings({
      tenantId: tenantA.id,
      templeId: templeA.id,
      userContext: priestContext,
      searchQuery: 'Rohan',
    });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe(confirmedBooking.id);
    expect(results[0].bookingReference).toBe(confirmedBooking.bookingReference);
  });
});
