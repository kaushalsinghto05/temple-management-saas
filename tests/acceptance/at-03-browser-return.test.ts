import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { createPujaService, setPujaStatus, createPujaTimeSlot } from '@/modules/pujas/puja-service';
import { reservePujaSlot } from '@/modules/bookings/booking-service';
import { configureTemplePayment } from '@/modules/payments/payment-service';
import { GET as getBookingRoute } from '@/app/api/bookings/[reference]/route';
import { NextRequest } from 'next/server';

describe('Acceptance Test AT-03: Browser Return Page Is Not Proof of Payment (FR-PAY-005)', () => {
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
      email: 'admin.returnpage@shrine.org',
      fullName: 'Browser Return Admin',
    });
    adminId = rootAdmin.id;

    tenant = await createTenant({
      name: 'Return Validation Trust',
      slug: 'return-trust',
      actorUserId: adminId,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Holy Mandir',
      slug: 'holy-mandir',
      address: { line1: 'Main St', city: 'Haridwar', state: 'UK', postalCode: '249401', country: 'India' },
      published: true,
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_mock_return',
      webhookSecret: 'secret_return_key',
      apiKey: 'api_mock_key',
      actorUserId: adminId,
      actorRole: 'TRUST_ADMIN',
    });

    puja = await createPujaService({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Ganga Aarti Special',
      durationMinutes: 45,
      priceMinorUnits: 50100, // ₹501.00
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
      totalCapacity: 10,
      actorUserId: adminId,
      actorRole: 'PUJA_MANAGER',
    });
  });

  it('AT-03: When devotee redirects to return page claiming payment, booking status remains PENDING_PAYMENT until webhook confirms', async () => {
    // 1. Devotee reserves slot
    const { booking } = await reservePujaSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja.id,
      slotId: slot.id,
      participantCount: 2,
      devoteeDetails: { name: 'Aarav Gupta', email: 'aarav@example.com' },
    });

    expect(booking.status).toBe('PENDING_PAYMENT');

    // 2. Devotee browser reaches return URL (e.g. /booking/success?ref=...&status=paid)
    // The client requests the booking status endpoint
    const req = new NextRequest(`http://localhost/api/bookings/${booking.bookingReference}?tenantId=${tenant.id}`);
    const res = await getBookingRoute(req, { params: Promise.resolve({ reference: booking.bookingReference }) });
    const json = await res.json();

    // 3. Assert: Booking MUST STILL BE PENDING_PAYMENT. The browser return has zero authoritative power.
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('PENDING_PAYMENT');
    expect(json.data.status).not.toBe('CONFIRMED');
  });
});
