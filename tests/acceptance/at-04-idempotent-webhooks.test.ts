import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { createPujaService, setPujaStatus, createPujaTimeSlot } from '@/modules/pujas/puja-service';
import { reservePujaSlot, getBookingByReference } from '@/modules/bookings/booking-service';
import { configureTemplePayment, processWebhookEvent } from '@/modules/payments/payment-service';
import { MockPaymentAdapter } from '@/modules/payments/adapters/mock-adapter';
import { getDb } from '@/db/client';
import { payments, paymentWebhookEvents } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('Acceptance Test AT-04: Idempotent Webhook Processing (FR-PAY-004)', () => {
  let tenant: any;
  let temple: any;
  let puja: any;
  let slot: any;
  let adminId: string;
  const webhookSecret = 'secret_idempotency_test_123';

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.idempotent@shrine.org',
      fullName: 'Idempotency Admin',
    });
    adminId = rootAdmin.id;

    tenant = await createTenant({
      name: 'Idempotency Trust',
      slug: 'idempotent-trust',
      actorUserId: adminId,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Idempotent Mandir',
      slug: 'idempotent-mandir',
      address: { line1: 'Main St', city: 'Ujjain', state: 'MP', postalCode: '456001', country: 'India' },
      published: true,
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_mock_idempotent',
      webhookSecret,
      apiKey: 'api_mock_key',
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    puja = await createPujaService({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Mahakal Bhasma Aarti',
      durationMinutes: 60,
      priceMinorUnits: 100000, // ₹1,000.00
      currency: 'INR',
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });
    await setPujaStatus(tenant.id, puja.id, 'PUBLISHED', adminId, 'TEMPLE_ADMIN');

    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

    slot = await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      startTime,
      endTime,
      totalCapacity: 5,
      actorUserId: adminId,
      actorRole: 'PUJA_MANAGER',
    });
  });

  it('AT-04: Provider delivers the same successful webhook twice -> one payment effect, one confirmation, no duplicate effects', async () => {
    // 1. Devotee reserves slot
    const { booking, paymentOrder } = await reservePujaSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      slotId: slot.id,
      participantCount: 1,
      devoteeDetails: { name: 'Pooja Verma', email: 'pooja@example.com' },
    });

    expect(booking.status).toBe('PENDING_PAYMENT');

    // 2. Prepare successful webhook payload
    const eventId = 'evt_unique_123456789';
    const payloadObj = {
      event_id: eventId,
      event: 'payment.succeeded',
      order_id: paymentOrder.providerOrderId,
      payment_id: 'pay_provider_998877',
      amount: 100000,
      currency: 'INR',
    };
    const rawBody = JSON.stringify(payloadObj);
    const signature = MockPaymentAdapter.signPayload(rawBody, webhookSecret);
    const headers = { 'x-webhook-signature': signature };

    // 3. First webhook delivery
    const result1 = await processWebhookEvent({
      provider: 'MOCK',
      templeId: temple.id,
      tenantId: tenant.id,
      headers,
      rawBody,
    });

    expect(result1.status).toBe('PROCESSED');
    expect(result1.payment?.status).toBe('SUCCEEDED');

    // Verify booking is confirmed
    const updatedBooking1 = await getBookingByReference(tenant.id, booking.bookingReference);
    expect(updatedBooking1.status).toBe('CONFIRMED');

    // 4. Second identical webhook delivery (provider retry or network replay)
    const result2 = await processWebhookEvent({
      provider: 'MOCK',
      templeId: temple.id,
      tenantId: tenant.id,
      headers,
      rawBody,
    });

    // Must be recognized as duplicate without re-executing side effects
    expect(result2.status).toBe('DUPLICATE');

    // Verify in database: exactly 1 webhook event was recorded in journal
    const db = getDb();
    const recordedEvents = await db
      .select()
      .from(paymentWebhookEvents)
      .where(eq(paymentWebhookEvents.eventId, eventId));
    expect(recordedEvents.length).toBe(1);

    // Verify booking remains CONFIRMED exactly once
    const updatedBooking2 = await getBookingByReference(tenant.id, booking.bookingReference);
    expect(updatedBooking2.status).toBe('CONFIRMED');
  });
});
