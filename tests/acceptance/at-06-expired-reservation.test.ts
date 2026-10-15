import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { createPujaService, setPujaStatus, createPujaTimeSlot } from '@/modules/pujas/puja-service';
import { reservePujaSlot, releaseExpiredReservations, getBookingByReference } from '@/modules/bookings/booking-service';
import { configureTemplePayment, processWebhookEvent } from '@/modules/payments/payment-service';
import { MockPaymentAdapter } from '@/modules/payments/adapters/mock-adapter';
import { getDb } from '@/db/client';
import { bookings, payments, pujaTimeSlots } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('Acceptance Test AT-06: Payment Received After Reservation Expiry (Zero Silent Overbooking)', () => {
  let tenant: any;
  let temple: any;
  let puja: any;
  let slot: any;
  let adminId: string;
  const webhookSecret = 'secret_late_payment_test_789';

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.expiry@shrine.org',
      fullName: 'Expiry Admin',
    });
    adminId = rootAdmin.id;

    tenant = await createTenant({
      name: 'Timeliness Trust',
      slug: 'timeliness-trust',
      actorUserId: adminId,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Timeliness Mandir',
      slug: 'timeliness-mandir',
      address: { line1: 'Temple St', city: 'Puri', state: 'Odisha', postalCode: '752001', country: 'India' },
      published: true,
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_mock_timeliness',
      webhookSecret,
      apiKey: 'api_mock_key',
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    puja = await createPujaService({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Jagannath Mahaprasad Darshan',
      durationMinutes: 60,
      priceMinorUnits: 300000, // ₹3,000.00
      currency: 'INR',
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });
    await setPujaStatus(tenant.id, puja.id, 'PUBLISHED', adminId, 'TEMPLE_ADMIN');

    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

    // Slot with total capacity = 1
    slot = await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      startTime,
      endTime,
      totalCapacity: 1, // Only 1 seat
      actorUserId: adminId,
      actorRole: 'PUJA_MANAGER',
    });
  });

  it('AT-06: When payment succeeds after reservation has expired, capacity is NOT silently overbooked and exception workflow runs', async () => {
    // 1. Devotee 1 reserves the last available seat
    const { booking: booking1, paymentOrder: order1 } = await reservePujaSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      slotId: slot.id,
      participantCount: 1,
      devoteeDetails: { name: 'Late Payer', email: 'late@example.com' },
    });

    expect(booking1.status).toBe('PENDING_PAYMENT');

    // 2. Simulate expiration: Fast-forward booking1's expiresAt to the past
    const db = getDb();
    await db
      .update(bookings)
      .set({ expiresAt: new Date(Date.now() - 60000) }) // expired 1 minute ago
      .where(eq(bookings.id, booking1.id));

    // 3. Expiry worker runs and releases capacity (FR-BOOK-009)
    const releasedCount = await releaseExpiredReservations(tenant.id);
    expect(releasedCount).toBe(1);

    // Verify slot capacity is now freed
    const [updatedSlot] = await db.select().from(pujaTimeSlots).where(eq(pujaTimeSlots.id, slot.id));
    expect(updatedSlot.allocatedCapacity).toBe(0);
    expect(updatedSlot.availabilityStatus).toBe('AVAILABLE');

    // 4. Devotee 2 comes along and books the newly freed seat!
    const { booking: booking2 } = await reservePujaSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      slotId: slot.id,
      participantCount: 1,
      devoteeDetails: { name: 'Prompt Devotee', email: 'prompt@example.com' },
    });
    expect(booking2.status).toBe('PENDING_PAYMENT');

    // 5. Late webhook arrives from provider for Devotee 1's expired booking!
    const payloadObj = {
      event_id: 'evt_late_payment_arrival',
      event: 'payment.succeeded',
      order_id: order1.providerOrderId,
      payment_id: 'pay_late_received_999',
      amount: 300000,
      currency: 'INR',
    };
    const rawBody = JSON.stringify(payloadObj);
    const signature = MockPaymentAdapter.signPayload(rawBody, webhookSecret);

    const webhookResult = await processWebhookEvent({
      provider: 'MOCK',
      templeId: temple.id,
      tenantId: tenant.id,
      headers: { 'x-webhook-signature': signature },
      rawBody,
    });

    // 6. Assert: Webhook is NOT processed normally; it is quarantined for exception handling
    expect(webhookResult.status).toBe('QUARANTINED');
    expect(webhookResult.reason).toContain('Payment succeeded after reservation expired');

    // 7. Assert: Booking 1 is NOT confirmed (remains EXPIRED)
    const booking1Check = await getBookingByReference(tenant.id, booking1.bookingReference);
    expect(booking1Check.status).toBe('EXPIRED');
    expect(booking1Check.status).not.toBe('CONFIRMED');

    // 8. Assert: Payment record is marked RECONCILIATION_REQUIRED
    const [paymentRecord] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerOrderId, order1.providerOrderId));

    expect(paymentRecord.status).toBe('RECONCILIATION_REQUIRED');
    expect(paymentRecord.reconciliationReason).toContain('Payment succeeded after reservation expired');

    // 9. CRITICAL ASSERTION: Slot capacity is NOT overbooked!
    // Allocated capacity must be 1 (held for Devotee 2), NOT 2!
    const [finalSlotState] = await db.select().from(pujaTimeSlots).where(eq(pujaTimeSlots.id, slot.id));
    expect(finalSlotState.allocatedCapacity).toBe(1);
    expect(finalSlotState.allocatedCapacity).toBeLessThanOrEqual(finalSlotState.totalCapacity);
  });
});
