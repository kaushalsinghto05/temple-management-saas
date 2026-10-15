import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { createPujaService, createPujaTimeSlot, setPujaStatus } from '@/modules/pujas/puja-service';
import { configureTemplePayment, processWebhookEvent } from '@/modules/payments/payment-service';
import { reservePujaSlot } from '@/modules/bookings/booking-service';
import { cancelBookingAndRefund } from '@/modules/refunds/refund-service';
import { getAuditLogs } from '@/modules/audit/audit-service';
import { MockPaymentAdapter } from '@/modules/payments/adapters/mock-adapter';
import { UserContext } from '@/core/rbac/guard';
import { ForbiddenError } from '@/core/errors';
import { getDb } from '@/db/client';
import { pujaTimeSlots, bookings, payments, refunds } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('Acceptance Test AT-08: Unauthorized Refund Attempt (FR-BOOK-008, FR-PAY-008, FR-AUD-001)', () => {
  let tenant: any;
  let temple: any;
  let pujaService: any;
  let slot: any;
  let accountantUser: any;
  let adminUser: any;
  let devoteeUser: any;
  let accountantContext: UserContext;
  let adminContext: UserContext;
  let booking: any;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.at08@trust.org',
      fullName: 'AT08 Admin',
    });

    tenant = await createTenant({
      name: 'Tirupati Trust',
      slug: 'tirupati',
      actorUserId: rootAdmin.id,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Balaji Temple',
      slug: 'balaji',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Hill Road', city: 'Tirumala', state: 'Andhra Pradesh', postalCode: '517504', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_tirupati_123',
      webhookSecret: 'secret_tirupati_key',
      apiKey: 'api_tirupati_key',
      actorUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });

    // Create staff without refunds.issue permission (TEMPLE_ACCOUNTANT)
    accountantUser = await registerUser({
      email: 'accountant@tirupati.org',
      fullName: 'Accountant Rao',
      password: 'Password123!',
    });
    const memAcct = await inviteMember({
      tenantId: tenant.id,
      email: accountantUser.email,
      role: 'TEMPLE_ACCOUNTANT',
      assignedTempleId: temple.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    accountantContext = {
      userId: accountantUser.id,
      isPlatformAdmin: false,
      memberships: [memAcct],
    };

    // Create staff with refunds.issue permission (TEMPLE_ADMIN)
    adminUser = await registerUser({
      email: 'admin@tirupati.org',
      fullName: 'Admin Reddi',
      password: 'Password123!',
    });
    const memAdmin = await inviteMember({
      tenantId: tenant.id,
      email: adminUser.email,
      role: 'TEMPLE_ADMIN',
      assignedTempleId: temple.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    adminContext = {
      userId: adminUser.id,
      isPlatformAdmin: false,
      memberships: [memAdmin],
    };

    // Create Devotee
    devoteeUser = await registerUser({
      email: 'devotee@example.com',
      fullName: 'Devotee Venkat',
      password: 'Password123!',
    });

    // Create Puja & Slot
    pujaService = await createPujaService({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Suprabhata Seva',
      durationMinutes: 60,
      priceMinorUnits: 50000, // ₹500.00
      currency: 'INR',
      actorUserId: adminUser.id,
      actorRole: 'TEMPLE_ADMIN',
    });

    await setPujaStatus(tenant.id, pujaService.id, 'PUBLISHED', adminUser.id, 'TEMPLE_ADMIN');

    const now = new Date();
    const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

    slot = await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: pujaService.id,
      startTime,
      endTime,
      totalCapacity: 10,
      actorUserId: adminUser.id,
      actorRole: 'TEMPLE_ADMIN',
    });

    // Reserve 2 tickets
    const reserveRes = await reservePujaSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: pujaService.id,
      slotId: slot.id,
      participantCount: 2,
      devoteeDetails: { name: 'Devotee Venkat', email: 'devotee@example.com' },
      devoteeUserId: devoteeUser.id,
      paymentProvider: 'MOCK',
    });
    booking = reserveRes.booking;

    // Simulate successful webhook payment confirmation
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      event_id: `evt_pay_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: 'pay_tirupati_999',
            order_id: reserveRes.paymentOrder.providerOrderId,
            amount: 100000, // 2 * ₹500 = ₹1,000.00
            currency: 'INR',
          },
        },
      },
    });
    const signature = MockPaymentAdapter.signPayload(webhookPayload, 'secret_tirupati_key');

    await processWebhookEvent({
      provider: 'MOCK',
      tenantId: tenant.id,
      templeId: temple.id,
      headers: { 'x-webhook-signature': signature },
      rawBody: webhookPayload,
    });
  });

  it('AT-08: Staff without refunds.issue permission is REJECTED with 403 and logged in audit log', async () => {
    // 1. Accountant attempts to refund the booking
    await expect(
      cancelBookingAndRefund({
        tenantId: tenant.id,
        bookingId: booking.id,
        reason: 'Devotee requested cancellation',
        userContext: accountantContext,
      })
    ).rejects.toThrow(ForbiddenError);

    // 2. Verify that an audit event was logged capturing the unauthorized attempt
    const auditLogs = await getAuditLogs({
      tenantId: tenant.id,
    });

    const unauthorizedLogs = auditLogs.filter(
      (l: any) => l.action === 'refund.unauthorized_attempt'
    );
    expect(unauthorizedLogs.length).toBeGreaterThan(0);
    const unauthorizedLog = unauthorizedLogs[0];
    expect(unauthorizedLog.actorId).toBe(accountantUser.id);
    expect(unauthorizedLog.resourceType).toBe('booking');
    expect(unauthorizedLog.resourceId).toBe(booking.id);

    // 3. Verify booking is still CONFIRMED and capacity remains allocated
    const db = getDb();
    const [b] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(b.status).toBe('CONFIRMED');

    const [s] = await db.select().from(pujaTimeSlots).where(eq(pujaTimeSlots.id, slot.id));
    expect(s.allocatedCapacity).toBe(2);
  });

  it('AT-08: Authorized staff (TEMPLE_ADMIN) can cancel booking, release slot capacity, and issue refund', async () => {
    // 1. Temple Admin executes cancellation and refund
    const result = await cancelBookingAndRefund({
      tenantId: tenant.id,
      bookingId: booking.id,
      reason: 'Medical emergency per devotee documentation',
      userContext: adminContext,
    });

    expect(result.booking.status).toBe('CANCELLED');
    expect(result.booking.capacityReleased).toBe(true);
    expect(result.refund).toBeDefined();
    expect(result.refund?.status).toBe('COMPLETED');
    expect(result.refund?.amountMinorUnits).toBe(100000);

    // 2. Verify capacity is released back to the slot in DB
    const db = getDb();
    const [s] = await db.select().from(pujaTimeSlots).where(eq(pujaTimeSlots.id, slot.id));
    expect(s.allocatedCapacity).toBe(0); // 2 seats returned

    // 3. Verify payment status is REFUNDED
    const [p] = await db.select().from(payments).where(eq(payments.bookingId, booking.id));
    expect(p.status).toBe('REFUNDED');

    // 4. Verify audit log captures the successful refund
    const auditLogs = await getAuditLogs({
      tenantId: tenant.id,
    });
    const refundLogs = auditLogs.filter((l: any) => l.action === 'booking.cancelled_and_refunded');
    expect(refundLogs.length).toBeGreaterThan(0);
    expect(refundLogs[0].actorId).toBe(adminUser.id);
  });
});
