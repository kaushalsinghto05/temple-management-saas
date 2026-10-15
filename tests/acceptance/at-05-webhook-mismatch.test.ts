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
import { payments } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('Acceptance Test AT-05: Webhook Amount/Currency Mismatch Quarantining', () => {
  let tenant: any;
  let temple: any;
  let puja: any;
  let slot: any;
  let adminId: string;
  const webhookSecret = 'secret_mismatch_test_456';

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.mismatch@shrine.org',
      fullName: 'Mismatch Admin',
    });
    adminId = rootAdmin.id;

    tenant = await createTenant({
      name: 'Integrity Trust',
      slug: 'integrity-trust',
      actorUserId: adminId,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Integrity Mandir',
      slug: 'integrity-mandir',
      address: { line1: 'Temple Road', city: 'Madurai', state: 'TN', postalCode: '625001', country: 'India' },
      published: true,
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_mock_integrity',
      webhookSecret,
      apiKey: 'api_mock_key',
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    puja = await createPujaService({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Special Meenakshi Abhishekam',
      durationMinutes: 45,
      priceMinorUnits: 200000, // Expected: ₹2,000.00
      currency: 'INR',
      actorUserId: adminId,
      actorRole: 'TEMPLE_ADMIN',
    });
    await setPujaStatus(tenant.id, puja.id, 'PUBLISHED', adminId, 'TEMPLE_ADMIN');

    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 45 * 60 * 1000);

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

  it('AT-05: Signed webhook with mismatched amount is quarantined; booking remains unpaid', async () => {
    // 1. Devotee reserves slot for ₹2,000.00
    const { booking, paymentOrder } = await reservePujaSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      slotId: slot.id,
      participantCount: 1,
      devoteeDetails: { name: 'Kavita Nair', email: 'kavita@example.com' },
    });

    expect(booking.totalPriceMinorUnits).toBe(200000);

    // 2. Webhook arrives with valid cryptographic signature BUT tampered / mismatched amount (₹500 instead of ₹2,000)
    const payloadObj = {
      event_id: 'evt_mismatch_amount_1',
      event: 'payment.succeeded',
      order_id: paymentOrder.providerOrderId,
      payment_id: 'pay_tampered_123',
      amount: 50000, // Only ₹500!
      currency: 'INR',
    };
    const rawBody = JSON.stringify(payloadObj);
    const signature = MockPaymentAdapter.signPayload(rawBody, webhookSecret);
    const headers = { 'x-webhook-signature': signature };

    // 3. Process webhook
    const result = await processWebhookEvent({
      provider: 'MOCK',
      templeId: temple.id,
      tenantId: tenant.id,
      headers,
      rawBody,
    });

    // 4. Assert: Webhook status is QUARANTINED
    expect(result.status).toBe('QUARANTINED');
    expect(result.reason).toContain('Amount or currency mismatch');

    // 5. Assert: Booking is NOT marked CONFIRMED
    const bookingCheck = await getBookingByReference(tenant.id, booking.bookingReference);
    expect(bookingCheck.status).toBe('PENDING_PAYMENT');
    expect(bookingCheck.status).not.toBe('CONFIRMED');

    // 6. Assert: Payment record is marked RECONCILIATION_REQUIRED
    const db = getDb();
    const [paymentRecord] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerOrderId, paymentOrder.providerOrderId));

    expect(paymentRecord.status).toBe('RECONCILIATION_REQUIRED');
    expect(paymentRecord.reconciliationReason).toContain('Amount or currency mismatch');
  });

  it('AT-05: Signed webhook with mismatched currency (e.g. USD instead of INR) is quarantined', async () => {
    const { booking, paymentOrder } = await reservePujaSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      slotId: slot.id,
      participantCount: 1,
      devoteeDetails: { name: 'Rajesh Kumar', email: 'rajesh@example.com' },
    });

    // Webhook with currency USD instead of INR
    const payloadObj = {
      event_id: 'evt_mismatch_currency_1',
      event: 'payment.succeeded',
      order_id: paymentOrder.providerOrderId,
      payment_id: 'pay_usd_123',
      amount: 200000,
      currency: 'USD',
    };
    const rawBody = JSON.stringify(payloadObj);
    const signature = MockPaymentAdapter.signPayload(rawBody, webhookSecret);

    const result = await processWebhookEvent({
      provider: 'MOCK',
      templeId: temple.id,
      tenantId: tenant.id,
      headers: { 'x-webhook-signature': signature },
      rawBody,
    });

    expect(result.status).toBe('QUARANTINED');

    const bookingCheck = await getBookingByReference(tenant.id, booking.bookingReference);
    expect(bookingCheck.status).not.toBe('CONFIRMED');
  });
});
