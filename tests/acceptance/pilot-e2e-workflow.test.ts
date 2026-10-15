import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { createPujaService, createPujaTimeSlot, setPujaStatus } from '@/modules/pujas/puja-service';
import { configureTemplePayment, processWebhookEvent } from '@/modules/payments/payment-service';
import { reservePujaSlot, confirmBookingPayment, getBookingByReference, getDevoteeBookings } from '@/modules/bookings/booking-service';
import { checkInBooking, searchBookings, getTempleDashboard } from '@/modules/operations/operations-service';
import { createDonationCampaign, initiateDonation, confirmDonationPayment, getDevoteeDonations } from '@/modules/donations/donation-service';
import { getReceiptById, voidReceipt } from '@/modules/receipts/receipt-service';
import { getDailyFinancialReport, getBookingReport, getDonationReport } from '@/modules/reports/report-service';
import { getPlatformOverview } from '@/modules/operations/operations-service';
import { MockPaymentAdapter } from '@/modules/payments/adapters/mock-adapter';
import { UserContext } from '@/core/rbac/guard';
import { ForbiddenError, NotFoundError } from '@/core/errors';

describe('Phase 6: Comprehensive Pilot Hardening & End-to-End Acceptance (AT-01..AT-12, Section 4 & 9.1)', () => {
  let rootAdmin: any;
  let tenant1: any;
  let tenant2: any;
  let temple1: any;
  let temple2: any;

  let trusteeUser: any;
  let priestUser: any;
  let accountantUser: any;
  let devoteeA: any;
  let devoteeB: any;

  let platformAdminContext: UserContext;
  let trusteeContext: UserContext;
  let priestContext: UserContext;
  let accountantContext: UserContext;
  let devoteeContextA: UserContext;
  let devoteeContextB: UserContext;

  const webhookSecret = 'sec_pilot_webhook_live_999';

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    // 1. Root Platform Super Admin
    rootAdmin = await registerUser({
      email: 'platform.super@saas-temple.org',
      fullName: 'Chief Platform Administrator',
    });
    platformAdminContext = {
      userId: rootAdmin.id,
      isPlatformAdmin: true,
      memberships: [],
    };

    // 2. Tenant 1: Meenakshi Sundareswarar Trust
    tenant1 = await createTenant({
      name: 'Meenakshi Sundareswarar Trust',
      slug: 'meenakshi-trust',
      actorUserId: rootAdmin.id,
    });

    temple1 = await createTemple({
      tenantId: tenant1.id,
      name: 'Madurai Meenakshi Amman Temple',
      slug: 'meenakshi-amman',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Madurai Main', city: 'Madurai', state: 'Tamil Nadu', postalCode: '625001', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // 3. Tenant 2: Kashi Vishwanath Trust (for cross-tenant boundary verification)
    tenant2 = await createTenant({
      name: 'Kashi Vishwanath Trust',
      slug: 'kashi-trust',
      actorUserId: rootAdmin.id,
    });

    temple2 = await createTemple({
      tenantId: tenant2.id,
      name: 'Kashi Vishwanath Jyotirlinga',
      slug: 'kashi-vishwanath',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Varanasi Ghat', city: 'Varanasi', state: 'UP', postalCode: '221001', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // 4. Direct Payment Account setup (FR-PAY-001)
    await configureTemplePayment({
      tenantId: tenant1.id,
      templeId: temple1.id,
      provider: 'MOCK',
      merchantAccountId: 'merch_meenakshi_sbi',
      webhookSecret,
      apiKey: 'key_meenakshi_live',
      actorUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });

    // 5. Staff Users & Role Assignments (FR-RBAC-001..004)
    trusteeUser = await registerUser({
      email: 'trustee@meenakshi.org',
      fullName: 'Trustee Sundaram',
      password: 'Password123!',
    });
    const trusteeMem = await inviteMember({
      tenantId: tenant1.id,
      email: trusteeUser.email as string,
      role: 'TRUST_ADMIN',
      assignedTempleId: temple1.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    trusteeContext = {
      userId: trusteeUser.id,
      isPlatformAdmin: false,
      memberships: [trusteeMem],
    };

    priestUser = await registerUser({
      email: 'archakar@meenakshi.org',
      fullName: 'Pandit Sastri',
      password: 'Password123!',
    });
    const priestMem = await inviteMember({
      tenantId: tenant1.id,
      email: priestUser.email as string,
      role: 'PRIEST',
      assignedTempleId: temple1.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    priestContext = {
      userId: priestUser.id,
      isPlatformAdmin: false,
      memberships: [priestMem],
    };

    accountantUser = await registerUser({
      email: 'accountant@meenakshi.org',
      fullName: 'Accountant Raman',
      password: 'Password123!',
    });
    const accountantMem = await inviteMember({
      tenantId: tenant1.id,
      email: accountantUser.email as string,
      role: 'TEMPLE_ACCOUNTANT',
      assignedTempleId: temple1.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    accountantContext = {
      userId: accountantUser.id,
      isPlatformAdmin: false,
      memberships: [accountantMem],
    };

    // 6. Devotees
    devoteeA = await registerUser({
      email: 'devotee.ramanathan@pilgrim.net',
      fullName: 'Ramanathan Chettiar',
      password: 'Password123!',
    });
    const devoteeMemA = await inviteMember({
      tenantId: tenant1.id,
      email: devoteeA.email as string,
      role: 'DEVOTEE',
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    devoteeContextA = {
      userId: devoteeA.id,
      isPlatformAdmin: false,
      memberships: [devoteeMemA],
    };

    devoteeB = await registerUser({
      email: 'devotee.kannan@pilgrim.net',
      fullName: 'Kannan Murugan',
      password: 'Password123!',
    });
    const devoteeMemB = await inviteMember({
      tenantId: tenant1.id,
      email: devoteeB.email as string,
      role: 'DEVOTEE',
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    devoteeContextB = {
      userId: devoteeB.id,
      isPlatformAdmin: false,
      memberships: [devoteeMemB],
    };
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it('Section 4.1 & AT-01..AT-04: Full End-to-End Puja Booking Lifecycle', async () => {
    // 1. Trustee creates and publishes puja service (FR-PUJA-001..002)
    const puja = await createPujaService({
      tenantId: tenant1.id,
      templeId: temple1.id,
      name: 'Thirukalyanam Special Archana',
      description: 'Divine wedding ceremony archana and prasad blessings',
      durationMinutes: 45,
      priceMinorUnits: 150000, // ₹1,500.00
      currency: 'INR',
      actorUserId: trusteeUser.id,
      actorRole: 'TRUST_ADMIN',
    });

    await setPujaStatus(
      tenant1.id,
      puja.id,
      'PUBLISHED',
      trusteeUser.id,
      'TRUST_ADMIN'
    );

    // 2. Trustee schedules future bookable time slot with capacity of 5 (FR-PUJA-003)
    const slotStart = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 45 * 60 * 1000);
    const slot = await createPujaTimeSlot({
      tenantId: tenant1.id,
      templeId: temple1.id,
      pujaServiceId: puja.id,
      startTime: slotStart,
      endTime: slotEnd,
      totalCapacity: 5,
      actorUserId: trusteeUser.id,
      actorRole: 'TRUST_ADMIN',
    });

    // 3. Devotee A reserves 2 seats atomically (FR-BOOK-001..004)
    const { booking, paymentOrder } = await reservePujaSlot({
      tenantId: tenant1.id,
      templeId: temple1.id,
      pujaServiceId: puja.id,
      slotId: slot.id,
      participantCount: 2,
      devoteeUserId: devoteeA.id,
      devoteeDetails: {
        name: 'Ramanathan Chettiar',
        email: 'devotee.ramanathan@pilgrim.net',
        phone: '+919443123456',
        gotra: 'Shandilya',
        nakshatra: 'Uthiram',
      },
    });

    expect(booking.status).toBe('PENDING_PAYMENT');
    expect(booking.totalPriceMinorUnits).toBe(300000); // 2 * ₹1,500 = ₹3,000 (300000 paise)
    expect(booking.currency).toBe('INR');

    // AT-03: Devotee hitting return URL does NOT confirm payment
    const pendingBooking = await getBookingByReference(tenant1.id, booking.bookingReference);
    expect(pendingBooking.status).toBe('PENDING_PAYMENT');

    // 4. Webhook arrives with valid signature (FR-PAY-003, FR-PAY-004, AT-04)
    const eventId = 'evt_pilot_live_001';
    const payloadObj = {
      event_id: eventId,
      event: 'payment.succeeded',
      order_id: paymentOrder.providerOrderId,
      payment_id: 'pay_live_sundaram_01',
      amount: 300000,
      currency: 'INR',
    };
    const rawBody = JSON.stringify(payloadObj);
    const signature = MockPaymentAdapter.signPayload(rawBody, webhookSecret);
    const headers = { 'x-webhook-signature': signature };

    const webhookResult = await processWebhookEvent({
      provider: 'MOCK',
      templeId: temple1.id,
      tenantId: tenant1.id,
      headers,
      rawBody,
    });

    expect(webhookResult.status).toBe('PROCESSED');
    expect(webhookResult.payment?.status).toBe('SUCCEEDED');

    // Replay identical webhook -> Idempotent, zero duplicate effect (AT-04)
    const replayResult = await processWebhookEvent({
      provider: 'MOCK',
      templeId: temple1.id,
      tenantId: tenant1.id,
      headers,
      rawBody,
    });
    expect(replayResult.status).toBe('DUPLICATE');

    // 5. Booking transitions to CONFIRMED (FR-BOOK-005)
    const confirmedBooking = await getBookingByReference(tenant1.id, booking.bookingReference);
    expect(confirmedBooking.status).toBe('CONFIRMED');

    // 6. Priest checks in the devotee and fulfills attendance (FR-BOOK-007)
    const checkedIn = await checkInBooking({
      tenantId: tenant1.id,
      bookingId: confirmedBooking.id,
      userContext: priestContext,
    });
    expect(checkedIn.fulfillmentStatus).toBe('FULFILLED');

    // 7. Verify devotee can retrieve own booking (FR-BOOK-010)
    const myBookings = await getDevoteeBookings({
      tenantId: tenant1.id,
      userContext: devoteeContextA,
    });
    expect(myBookings.some((b) => b.id === booking.id)).toBe(true);

    // Devotee B cannot see Devotee A's booking
    const devoteeBBookings = await getDevoteeBookings({
      tenantId: tenant1.id,
      userContext: devoteeContextB,
    });
    expect(devoteeBBookings.some((b) => b.id === booking.id)).toBe(false);

    // 8. Operational Dashboard reflects completed operations
    const dashboard = await getTempleDashboard({
      tenantId: tenant1.id,
      templeId: temple1.id,
      userContext: trusteeContext,
    });
    expect(dashboard.metrics.upcomingSlotsCount).toBeGreaterThanOrEqual(1);
    expect(dashboard.metrics.operationalExceptionsCount).toBe(0);
  });

  it('Section 4.2 & AT-10, AT-12: Full End-to-End Donation, Receipting & Voiding Lifecycle', async () => {
    // 1. Trustee publishes Annadanam Donation Campaign (FR-DON-001..002)
    const campaign = await createDonationCampaign(trusteeContext, {
      tenantId: tenant1.id,
      templeId: temple1.id,
      name: 'Nithya Annadanam Fund',
      purpose: 'Daily sacred food offering for 5,000 pilgrims',
      recipientLegalEntity: 'Arulmigu Meenakshi Sundareswarar Thirukoil Trust',
      taxExemptionEligible: true,
      taxExemptionSection: '80G',
      suggestedAmountsMinorUnits: [50000, 100000, 250000, 500000],
    });

    // 2. Devotee B initiates donation with PAN (FR-DON-003..004)
    const { donation, paymentOrder } = await initiateDonation({
      tenantId: tenant1.id,
      templeId: temple1.id,
      campaignId: campaign.id,
      donorUserId: devoteeB.id,
      amountMinorUnits: 250000, // ₹2,500.00
      donorName: 'Kannan Murugan',
      donorEmail: 'devotee.kannan@pilgrim.net',
      donorPan: 'ABCDE9876Z',
    });

    expect(donation.status).toBe('PENDING');

    // 3. Confirm payment & automatically issue sequential receipt (AT-10, FR-REC-001..003)
    const { receipt } = await confirmDonationPayment(
      tenant1.id,
      donation.id,
      'pay_donation_live_01',
      paymentOrder.providerOrderId
    );

    expect(receipt.receiptNumber).toMatch(/^RCP-MEEN-/);
    expect(receipt.taxDeductionEligible).toBe(true);
    expect(receipt.taxDeductionNote).toContain('Section 80G');
    expect(receipt.issuingEntity).toBe('Arulmigu Meenakshi Sundareswarar Thirukoil Trust');

    // 4. Devotee B retrieves own donation history & receipt (FR-DON-007, AT-07)
    const myDonations = await getDevoteeDonations(devoteeContextB, tenant1.id);
    expect(myDonations.length).toBe(1);
    expect(myDonations[0].id).toBe(donation.id);

    // Devotee A cannot view Devotee B's receipt (AT-07)
    await expect(
      getReceiptById(tenant1.id, receipt.id, devoteeContextA)
    ).rejects.toThrow(ForbiddenError);

    // 5. Void receipt with immutable audit trail (AT-12, FR-REC-004)
    const { receipt: voided } = await voidReceipt({
      tenantId: tenant1.id,
      receiptId: receipt.id,
      reason: 'Donor requested correction of PAN card details',
      userContext: trusteeContext,
    });

    expect(voided.status).toBe('VOIDED');
    expect(voided.voidedReason).toContain('correction of PAN');

    // 6. Reports accurately reflect transaction and void history (FR-REP-002)
    const donationRep = await getDonationReport({
      tenantId: tenant1.id,
      templeId: temple1.id,
      userContext: accountantContext,
    });
    expect(donationRep.totalDonations).toBe(1);
    expect(donationRep.donations[0].receiptNumber).toBe(receipt.receiptNumber);
  });

  it('Section 9.1 Pilot Checklist Verification: Multi-Tenant Boundary & Platform Health', async () => {
    // 1. Platform Super Admin inspects Platform Overview (FR-AUD-004)
    const overview = await getPlatformOverview(platformAdminContext);
    expect(overview.totalTenants).toBeGreaterThanOrEqual(2);
    expect(overview.tenantsByStatus.active).toBeGreaterThanOrEqual(2);
    expect(overview.totalTemples).toBeGreaterThanOrEqual(2);

    // 2. Strict Cross-Tenant Isolation: Tenant 1 Trustee cannot query Tenant 2 (AT-01)
    await expect(
      getBookingReport({
        tenantId: tenant2.id,
        templeId: temple2.id,
        userContext: trusteeContext,
      })
    ).rejects.toThrow(ForbiddenError);
  });
});
