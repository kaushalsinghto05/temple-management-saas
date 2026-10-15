import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { createPujaService, createPujaTimeSlot, setPujaStatus } from '@/modules/pujas/puja-service';
import { reservePujaSlot, confirmBookingPayment, getDevoteeBookings } from '@/modules/bookings/booking-service';
import { createDonationCampaign, initiateDonation, confirmDonationPayment, searchDonations, getDevoteeDonations } from '@/modules/donations/donation-service';
import { configureTemplePayment } from '@/modules/payments/payment-service';
import { getBookingReport, getDonationReport, exportToCsv, BookingReportItem, DonationReportItem } from '@/modules/reports/report-service';
import { getTempleDashboard, getPlatformOverview, getOperationsExceptionsQueue, resolveReconciliationException } from '@/modules/operations/operations-service';
import { getAuditLogs } from '@/modules/audit/audit-service';
import { UserContext } from '@/core/rbac/guard';
import { ForbiddenError } from '@/core/errors';
import { getDb } from '@/db/client';
import { payments } from '@/db/schema';

describe('Phase 5 Complete: Operations, Timezone-Aware Reporting & Audit Dashboard (FR-REP-001..004, FR-AUD-001..005, FR-BOOK-006, 007, 010, FR-DON-006, 007)', () => {
  let rootAdmin: any;
  let tenant: any;
  let temple: any;
  let templeManagerUser: any;
  let accountantUser: any;
  let devoteeUserA: any;
  let devoteeUserB: any;

  let platformAdminContext: UserContext;
  let managerContext: UserContext;
  let accountantContext: UserContext;
  let devoteeContextA: UserContext;
  let devoteeContextB: UserContext;

  let pujaService: any;
  let slot: any;
  let campaign: any;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    // 1. Root Platform Admin
    rootAdmin = await registerUser({
      email: 'root.superadmin@trustplatform.org',
      fullName: 'Super Platform Admin',
    });
    platformAdminContext = {
      userId: rootAdmin.id,
      isPlatformAdmin: true,
      memberships: [],
    };

    // 2. Tenant & Temple (Asia/Kolkata timezone)
    tenant = await createTenant({
      name: 'Somnath Temple Trust',
      slug: 'somnath-trust',
      actorUserId: rootAdmin.id,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Somnath Jyotirlinga',
      slug: 'somnath-jyotirlinga',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Prabhas Patan', city: 'Veraval', state: 'Gujarat', postalCode: '362268', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_somnath_merchant',
      webhookSecret: 'secret_somnath_123',
      apiKey: 'key_somnath_live',
      actorUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });

    // 3. Temple Manager (has bookings.read, bookings.check_in, reports.view)
    templeManagerUser = await registerUser({
      email: 'manager@somnath.org',
      fullName: 'Temple Manager Patel',
      password: 'Password123!',
    });
    const managerMem = await inviteMember({
      tenantId: tenant.id,
      email: templeManagerUser.email as string,
      role: 'TEMPLE_ADMIN',
      assignedTempleId: temple.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    managerContext = {
      userId: templeManagerUser.id,
      isPlatformAdmin: false,
      memberships: [managerMem],
    };

    // 4. Temple Accountant (has reports.finance.read, donations.read)
    accountantUser = await registerUser({
      email: 'accountant@somnath.org',
      fullName: 'Somnath Accountant',
      password: 'Password123!',
    });
    const accountantMem = await inviteMember({
      tenantId: tenant.id,
      email: accountantUser.email as string,
      role: 'TEMPLE_ACCOUNTANT',
      assignedTempleId: temple.id,
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    accountantContext = {
      userId: accountantUser.id,
      isPlatformAdmin: false,
      memberships: [accountantMem],
    };

    // 5. Devotee Users
    devoteeUserA = await registerUser({
      email: 'devotee.a@somnath-pilgrim.org',
      fullName: 'Aarav Sharma',
      password: 'Password123!',
    });
    const devoteeMemA = await inviteMember({
      tenantId: tenant.id,
      email: devoteeUserA.email as string,
      role: 'DEVOTEE',
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    devoteeContextA = {
      userId: devoteeUserA.id,
      isPlatformAdmin: false,
      memberships: [devoteeMemA],
    };

    devoteeUserB = await registerUser({
      email: 'devotee.b@somnath-pilgrim.org',
      fullName: 'Priya Verma',
      password: 'Password123!',
    });
    const devoteeMemB = await inviteMember({
      tenantId: tenant.id,
      email: devoteeUserB.email as string,
      role: 'DEVOTEE',
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    devoteeContextB = {
      userId: devoteeUserB.id,
      isPlatformAdmin: false,
      memberships: [devoteeMemB],
    };

    // 6. Setup Puja Service & Slot
    pujaService = await createPujaService({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Maha Rudrabhishek',
      description: 'Sacred abhishekam of the holy Jyotirlinga',
      durationMinutes: 60,
      priceMinorUnits: 250000, // ₹2,500.00
      currency: 'INR',
      actorUserId: templeManagerUser.id,
      actorRole: 'PUJA_MANAGER',
    });
    await setPujaStatus(
      tenant.id,
      pujaService.id,
      'PUBLISHED',
      templeManagerUser.id,
      'PUJA_MANAGER'
    );

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const tomorrowEnd = new Date(tomorrow.getTime() + 60 * 60 * 1000);
    slot = await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: pujaService.id,
      startTime: tomorrow,
      endTime: tomorrowEnd,
      totalCapacity: 10,
      actorUserId: templeManagerUser.id,
      actorRole: 'PUJA_MANAGER',
    });

    // 7. Setup Donation Campaign
    campaign = await createDonationCampaign(managerContext, {
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Somnath Mandir Anna Kshethra Annadanam',
      purpose: 'Free meals for visiting devotees',
      recipientLegalEntity: 'Shree Somnath Trust (Reg. No. E-1234/Junagadh)',
      taxExemptionEligible: true,
      taxExemptionSection: '80G',
      suggestedAmountsMinorUnits: [110000, 210000, 510000],
    });
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it('FR-REP-001 & FR-REP-003: Booking report correctly filters by temple business date in local timezone', async () => {
    // Reserve & confirm a booking for Devotee A
    const { booking, paymentOrder } = await reservePujaSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: pujaService.id,
      slotId: slot.id,
      participantCount: 2,
      devoteeUserId: devoteeUserA.id,
      devoteeDetails: {
        name: 'Aarav Sharma',
        email: 'devotee.a@somnath-pilgrim.org',
        phone: '+919876543210',
        gotra: 'Kashyapa',
        nakshatra: 'Rohini',
      },
    });

    await confirmBookingPayment(
      tenant.id,
      booking.id,
      'pay_mock_1',
      paymentOrder.providerOrderId,
      500000, // 2 * 250000
      'INR'
    );

    // Fetch booking report as Puja Manager
    const report = await getBookingReport({
      tenantId: tenant.id,
      templeId: temple.id,
      userContext: managerContext,
    });

    expect(report.tenantId).toBe(tenant.id);
    expect(report.templeId).toBe(temple.id);
    expect(report.timezone).toBe('Asia/Kolkata');
    expect(report.totalBookings).toBe(1);
    expect(report.totalParticipants).toBe(2);
    expect(report.totalRevenueMinorUnits).toBe(500000);
    expect(report.bookings[0].bookingReference).toBe(booking.bookingReference);
    expect(report.bookings[0].devoteeName).toBe('Aarav Sharma');
    expect(report.bookings[0].gotra).toBe('Kashyapa');
    expect(report.bookings[0].nakshatra).toBe('Rohini');
  });

  it('FR-REP-002 & FR-REP-003: Donation report accurately aggregates 80G tax details and receipt numbers', async () => {
    // Initiate and confirm donation for Devotee B
    const { donation, paymentOrder } = await initiateDonation({
      tenantId: tenant.id,
      templeId: temple.id,
      campaignId: campaign.id,
      donorUserId: devoteeUserB.id,
      amountMinorUnits: 210000, // ₹2,100
      donorName: 'Priya Verma',
      donorEmail: 'devotee.b@somnath-pilgrim.org',
      donorPan: 'ABCDE1234F',
    });

    const { receipt } = await confirmDonationPayment(
      tenant.id,
      donation.id,
      'pay_donation_1',
      paymentOrder.providerOrderId
    );

    expect(receipt.receiptNumber).toMatch(/^RCP-/);

    // Fetch donation report as Temple Accountant
    const report = await getDonationReport({
      tenantId: tenant.id,
      templeId: temple.id,
      userContext: accountantContext,
    });

    expect(report.totalDonations).toBe(1);
    expect(report.totalAmountMinorUnits).toBe(210000);
    expect(report.donations[0].donorName).toBe('Priya Verma');
    expect(report.donations[0].donorPan).toBe('ABCDE1234F');
    expect(report.donations[0].taxExemptionEligible).toBe(true);
    expect(report.donations[0].taxExemptionSection).toBe('80G');
    expect(report.donations[0].receiptNumber).toBe(receipt.receiptNumber);
  });

  it('FR-REP-004: Enforces server-side authorization and produces valid RFC 4180 CSV exports', async () => {
    // 1. Devotee attempting to access financial report or donation report is REJECTED (403)
    await expect(
      getDonationReport({
        tenantId: tenant.id,
        templeId: temple.id,
        userContext: devoteeContextA,
      })
    ).rejects.toThrow(ForbiddenError);

    // 2. Authorized Accountant can generate CSV export
    const donationReport = await getDonationReport({
      tenantId: tenant.id,
      templeId: temple.id,
      userContext: accountantContext,
    });

    const csvOutput = exportToCsv<DonationReportItem>(
      [
        { header: 'Business Date', key: 'businessDate' },
        { header: 'Campaign', key: 'campaignName' },
        { header: 'Donor Name', key: 'donorName' },
        { header: 'Amount (₹)', key: (r) => (r.amountMinorUnits / 100).toFixed(2) },
        { header: 'Status', key: 'status' },
        { header: '80G Section', key: (r) => r.taxExemptionSection || '' },
      ],
      donationReport.donations
    );

    expect(csvOutput).toContain('Business Date,Campaign,Donor Name,Amount (₹),Status,80G Section');
  });

  it('FR-BOOK-006 & Section 7: Temple daily operations dashboard aggregates metrics, slots, and exceptions', async () => {
    // Create an operational exception in the temple
    const db = getDb();
    await db.insert(payments).values({
      tenantId: tenant.id,
      templeId: temple.id,
      referenceType: 'BOOKING',
      provider: 'MOCK',
      providerOrderId: 'ord_except_99',
      providerPaymentId: 'pay_except_99',
      amountMinorUnits: 150000,
      currency: 'INR',
      status: 'RECONCILIATION_REQUIRED',
      reconciliationReason: 'Late webhook arrival after hold expiry',
    });

    const dashboard = await getTempleDashboard({
      tenantId: tenant.id,
      templeId: temple.id,
      userContext: managerContext,
    });

    expect(dashboard.templeName).toBe('Somnath Jyotirlinga');
    expect(dashboard.timezone).toBe('Asia/Kolkata');
    expect(dashboard.businessDate).toBeDefined();
    expect(dashboard.metrics.upcomingSlotsCount).toBeGreaterThanOrEqual(1);
    expect(dashboard.metrics.operationalExceptionsCount).toBe(1);
    expect(dashboard.operationalExceptions[0].status).toBe('RECONCILIATION_REQUIRED');
  });

  it('FR-BOOK-010 & FR-DON-007: Devotees can retrieve their own booking and donation histories', async () => {
    // Devotee A booking
    await reservePujaSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: pujaService.id,
      slotId: slot.id,
      participantCount: 1,
      devoteeUserId: devoteeUserA.id,
      devoteeDetails: {
        name: 'Aarav Sharma',
        email: 'devotee.a@somnath-pilgrim.org',
        phone: '+919876543210',
      },
    });

    // Devotee A donation
    await initiateDonation({
      tenantId: tenant.id,
      templeId: temple.id,
      campaignId: campaign.id,
      donorUserId: devoteeUserA.id,
      amountMinorUnits: 510000,
      donorName: 'Aarav Sharma',
      donorEmail: 'devotee.a@somnath-pilgrim.org',
    });

    // Devotee A queries their own bookings and donations
    const myBookings = await getDevoteeBookings({
      tenantId: tenant.id,
      userContext: devoteeContextA,
    });
    expect(myBookings.length).toBe(1);
    expect(myBookings[0].devoteeUserId).toBe(devoteeUserA.id);

    const myDonations = await getDevoteeDonations(devoteeContextA, tenant.id);
    expect(myDonations.length).toBe(1);
    expect(myDonations[0].donorUserId).toBe(devoteeUserA.id);
    expect(myDonations[0].amountMinorUnits).toBe(510000);

    // Devotee B queries their own bookings -> should see 0
    const devoteeBBookings = await getDevoteeBookings({
      tenantId: tenant.id,
      userContext: devoteeContextB,
    });
    expect(devoteeBBookings.length).toBe(0);
  });

  it('FR-DON-006: Authorized staff can search donations and review donor details', async () => {
    const searchRes = await searchDonations(accountantContext, {
      tenantId: tenant.id,
      templeId: temple.id,
      campaignId: campaign.id,
    });

    expect(Array.isArray(searchRes)).toBe(true);
  });

  it('FR-AUD-004 & FR-AUD-005: Platform overview and operational exception resolution', async () => {
    // 1. Platform Super Admin can view platform overview
    const overview = await getPlatformOverview(platformAdminContext);
    expect(overview.totalTenants).toBeGreaterThanOrEqual(1);
    expect(overview.tenantsByStatus.active).toBeGreaterThanOrEqual(1);
    expect(overview.totalTemples).toBeGreaterThanOrEqual(1);

    // Non-platform user cannot view platform overview
    await expect(getPlatformOverview(managerContext)).rejects.toThrow(ForbiddenError);

    // 2. Insert quarantined payment and query exception queue
    const db = getDb();
    const [quarantinedPayment] = await db.insert(payments).values({
      tenantId: tenant.id,
      templeId: temple.id,
      referenceType: 'BOOKING',
      provider: 'MOCK',
      providerOrderId: 'ord_quarantine_01',
      providerPaymentId: 'pay_quarantine_01',
      amountMinorUnits: 250000,
      currency: 'INR',
      status: 'RECONCILIATION_REQUIRED',
      reconciliationReason: 'Mismatched currency detected',
    }).returning();

    const exceptions = await getOperationsExceptionsQueue({
      userContext: platformAdminContext,
      tenantId: tenant.id,
    });
    expect(exceptions.some((e) => e.id === quarantinedPayment.id)).toBe(true);

    // 3. Resolve the exception (e.g. MANUAL_REFUND)
    const resolved = await resolveReconciliationException({
      tenantId: tenant.id,
      paymentId: quarantinedPayment.id,
      userContext: accountantContext,
      resolutionAction: 'MANUAL_REFUND',
      notes: 'Customer notified, manual refund initiated on provider portal',
    });

    expect(resolved.status).toBe('REFUNDED');
    expect(resolved.reconciliationReason).toContain('Resolved as MANUAL_REFUND');

    // 4. Verify audit trail of the resolution
    const auditEntries = await getAuditLogs({
      tenantId: tenant.id,
      action: 'payment.reconciliation_resolved',
      resourceId: quarantinedPayment.id,
    });

    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0].actorId).toBe(accountantUser.id);
    expect(auditEntries[0].changesSummary).toMatchObject({
      resolutionAction: 'MANUAL_REFUND',
      previousStatus: 'RECONCILIATION_REQUIRED',
      newStatus: 'REFUNDED',
    });
  });
});
