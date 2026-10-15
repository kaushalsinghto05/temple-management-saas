import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { getDailyFinancialReport, exportToCsv, getLocalDateString } from '@/modules/reports/report-service';
import { UserContext } from '@/core/rbac/guard';
import { ForbiddenError } from '@/core/errors';
import { getDb } from '@/db/client';
import { payments, refunds } from '@/db/schema';

describe('Integration: Timezone-Aware Financial Reporting & CSV Export (FR-REP-001..004)', () => {
  let tenant: any;
  let temple: any;
  let accountantUser: any;
  let devoteeUser: any;
  let accountantContext: UserContext;
  let devoteeContext: UserContext;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.rep@trust.org',
      fullName: 'Reporting Admin',
    });

    tenant = await createTenant({
      name: 'Venkateswara Reporting Trust',
      slug: 'venkateswara-rep',
      actorUserId: rootAdmin.id,
    });

    // Temple configured with Asia/Kolkata timezone (UTC +5:30)
    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Tirumala Sanctum',
      slug: 'tirumala-sanctum',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Temple Hill', city: 'Tirupati', state: 'AP', postalCode: '517504', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // Accountant user (has reports.view & reports.finance.read)
    accountantUser = await registerUser({
      email: 'accountant@tirumala.org',
      fullName: 'Accountant Tirumala',
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

    // Devotee user (no financial reporting permissions)
    devoteeUser = await registerUser({
      email: 'devotee.rep@example.com',
      fullName: 'Devotee Pilgrim',
      password: 'Password123!',
    });
    const devoteeMem = await inviteMember({
      tenantId: tenant.id,
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

    // Seed financial records directly with explicit UTC timestamps:
    // Event 1: Oct 15, 2026 at 18:15:00 UTC = 23:45 IST on Oct 15, 2026
    const timeOct15LateIST = new Date('2026-10-15T18:15:00.000Z');

    // Event 2: Oct 15, 2026 at 18:45:00 UTC = 00:15 IST on Oct 16, 2026
    const timeOct16EarlyIST = new Date('2026-10-15T18:45:00.000Z');

    // Event 3: Oct 16, 2026 at 06:30:00 UTC = 12:00 IST on Oct 16, 2026
    const timeOct16NoonIST = new Date('2026-10-16T06:30:00.000Z');

    const db = getDb();

    // Payment 1: Booking payment ₹500 (50000 paise) at 23:45 IST on Oct 15
    await db.insert(payments).values({
      tenantId: tenant.id,
      templeId: temple.id,
      referenceType: 'BOOKING',
      provider: 'MOCK',
      providerOrderId: 'ord_1',
      providerPaymentId: 'pay_1',
      amountMinorUnits: 50000,
      feeMinorUnits: 1000,
      netSettlementMinorUnits: 49000,
      currency: 'INR',
      status: 'SUCCEEDED',
      createdAt: timeOct15LateIST,
    });

    // Payment 2: Booking payment ₹1,000 (100000 paise) at 00:15 IST on Oct 16
    await db.insert(payments).values({
      tenantId: tenant.id,
      templeId: temple.id,
      referenceType: 'BOOKING',
      provider: 'MOCK',
      providerOrderId: 'ord_2',
      providerPaymentId: 'pay_2',
      amountMinorUnits: 100000,
      feeMinorUnits: 2000,
      netSettlementMinorUnits: 98000,
      currency: 'INR',
      status: 'SUCCEEDED',
      createdAt: timeOct16EarlyIST,
    });

    // Payment 3: Donation ₹2,500 (250000 paise) at 12:00 IST on Oct 16
    const [p3] = await db.insert(payments).values({
      tenantId: tenant.id,
      templeId: temple.id,
      referenceType: 'DONATION',
      provider: 'MOCK',
      providerOrderId: 'ord_3',
      providerPaymentId: 'pay_3',
      amountMinorUnits: 250000,
      feeMinorUnits: 5000,
      netSettlementMinorUnits: 245000,
      currency: 'INR',
      status: 'SUCCEEDED',
      createdAt: timeOct16NoonIST,
    }).returning();

    // Refund: ₹500 (50000 paise) on Oct 16 for a cancellation
    await db.insert(refunds).values({
      tenantId: tenant.id,
      templeId: temple.id,
      paymentId: p3.id,
      amountMinorUnits: 50000,
      currency: 'INR',
      reason: 'Donor requested partial refund',
      status: 'COMPLETED',
      requestedByUserId: accountantUser.id,
      createdAt: timeOct16NoonIST,
    });
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it('FR-REP-001: Correctly groups transactions by temple business day in Asia/Kolkata timezone', async () => {
    const report = await getDailyFinancialReport({
      tenantId: tenant.id,
      templeId: temple.id,
      userContext: accountantContext,
    });

    expect(report.timezone).toBe('Asia/Kolkata');
    expect(report.dailyRecords.length).toBe(2);

    // Record for Oct 15 (transaction at 23:45 IST)
    const day15 = report.dailyRecords.find((r) => r.businessDate === '2026-10-15');
    expect(day15).toBeDefined();
    expect(day15?.grossCollectionsMinorUnits).toBe(50000); // Only Payment 1 (₹500.00)
    expect(day15?.transactionCount).toBe(1);
    expect(day15?.bookingRevenueMinorUnits).toBe(50000);
    expect(day15?.donationRevenueMinorUnits).toBe(0);

    // Record for Oct 16 (transaction at 00:15 IST + noon IST)
    // Both Payment 2 (₹1,000) and Payment 3 (₹2,500) fall into Oct 16
    const day16 = report.dailyRecords.find((r) => r.businessDate === '2026-10-16');
    expect(day16).toBeDefined();
    expect(day16?.grossCollectionsMinorUnits).toBe(350000); // ₹1,000 + ₹2,500 = ₹3,500 (350000 paise)
    expect(day16?.transactionCount).toBe(2);
    expect(day16?.bookingRevenueMinorUnits).toBe(100000);
    expect(day16?.donationRevenueMinorUnits).toBe(250000);
    expect(day16?.refundsMinorUnits).toBe(50000); // ₹500 refunded
    expect(day16?.netSettlementMinorUnits).toBe((98000 + 245000) - 50000); // ₹2,930 net
  });

  it('FR-REP-002: Computes accurate aggregate financial totals across date ranges', async () => {
    const report = await getDailyFinancialReport({
      tenantId: tenant.id,
      templeId: temple.id,
      userContext: accountantContext,
    });

    // Total gross = 50,000 + 350,000 = 400,000 paise (₹4,000.00)
    expect(report.totals.totalGrossCollectionsMinorUnits).toBe(400000);
    // Total refunds = 50,000 paise (₹500.00)
    expect(report.totals.totalRefundsMinorUnits).toBe(50000);
    // Total fees = 1,000 + 2,000 + 5,000 = 8,000 paise (₹80.00)
    expect(report.totals.totalFeeMinorUnits).toBe(8000);
    // Total transactions = 3
    expect(report.totals.totalTransactionsCount).toBe(3);
  });

  it('FR-REP-004: Generates compliant CSV format with properly formatted rupee decimals', async () => {
    const report = await getDailyFinancialReport({
      tenantId: tenant.id,
      templeId: temple.id,
      userContext: accountantContext,
    });

    const csv = exportToCsv(
      [
        { header: 'Business Date', key: 'businessDate' },
        { header: 'Transactions', key: 'transactionCount' },
        { header: 'Gross (INR)', key: (r) => (r.grossCollectionsMinorUnits / 100).toFixed(2) },
        { header: 'Refunds (INR)', key: (r) => (r.refundsMinorUnits / 100).toFixed(2) },
      ],
      report.dailyRecords
    );

    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Business Date,Transactions,Gross (INR),Refunds (INR)');
    expect(lines[1]).toBe('2026-10-15,1,500.00,0.00');
    expect(lines[2]).toBe('2026-10-16,2,3500.00,500.00');
  });

  it('FR-REP-004: Rejects unauthorized access when devotee requests financial report', async () => {
    await expect(
      getDailyFinancialReport({
        tenantId: tenant.id,
        templeId: temple.id,
        userContext: devoteeContext,
      })
    ).rejects.toThrow(ForbiddenError);
  });
});
