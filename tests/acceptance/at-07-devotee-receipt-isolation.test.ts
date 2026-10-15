import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { configureTemplePayment } from '@/modules/payments/payment-service';
import { createDonationCampaign, initiateDonation, confirmDonationPayment } from '@/modules/donations/donation-service';
import { getReceiptById } from '@/modules/receipts/receipt-service';
import { UserContext } from '@/core/rbac/guard';
import { ForbiddenError } from '@/core/errors';

describe('Acceptance Test AT-07: Devotee Receipt Isolation (FR-REC-005)', () => {
  let tenant: any;
  let temple: any;
  let devoteeA: any;
  let devoteeB: any;
  let accountant: any;
  let devoteeAContext: UserContext;
  let devoteeBContext: UserContext;
  let accountantContext: UserContext;
  let receiptB: any;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.at07@trust.org',
      fullName: 'AT07 Admin',
    });

    // 1. Create Tenant and Temple
    tenant = await createTenant({
      name: 'Shree Siddhivinayak Trust',
      slug: 'siddhivinayak',
      actorUserId: rootAdmin.id,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Main Temple',
      slug: 'main-temple',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Temple Road', city: 'Mumbai', state: 'Maharashtra', postalCode: '400028', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // Register Trust Admin
    const trustAdmin = await registerUser({
      email: 'trustadmin.at07@trust.org',
      fullName: 'Trust Admin AT07',
      password: 'Password123!',
    });
    const trustAdminMem = await inviteMember({
      tenantId: tenant.id,
      email: trustAdmin.email as string,
      role: 'TRUST_ADMIN',
      invitedByUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });
    const trustAdminContext: UserContext = {
      userId: trustAdmin.id,
      isPlatformAdmin: false,
      memberships: [trustAdminMem],
    };

    // 2. Configure mock payment provider
    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_mock_siddhi',
      webhookSecret: 'secret_siddhi_123',
      apiKey: 'key_siddhi_123',
      actorUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });

    // 3. Create Devotee A, Devotee B, and Staff Accountant
    devoteeA = await registerUser({
      email: 'devoteea@example.com',
      fullName: 'Devotee Ramesh',
      password: 'Password123!',
    });
    const memA = await inviteMember({
      tenantId: tenant.id,
      email: devoteeA.email,
      role: 'DEVOTEE',
      invitedByUserId: trustAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });
    devoteeAContext = {
      userId: devoteeA.id,
      isPlatformAdmin: false,
      memberships: [memA],
    };

    devoteeB = await registerUser({
      email: 'devoteeb@example.com',
      fullName: 'Devotee Suresh',
      password: 'Password123!',
    });
    const memB = await inviteMember({
      tenantId: tenant.id,
      email: devoteeB.email,
      role: 'DEVOTEE',
      invitedByUserId: trustAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });
    devoteeBContext = {
      userId: devoteeB.id,
      isPlatformAdmin: false,
      memberships: [memB],
    };

    accountant = await registerUser({
      email: 'accountant@example.com',
      fullName: 'Accountant Sharma',
      password: 'Password123!',
    });
    const memAcct = await inviteMember({
      tenantId: tenant.id,
      email: accountant.email,
      role: 'TEMPLE_ACCOUNTANT',
      assignedTempleId: temple.id,
      invitedByUserId: trustAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });
    accountantContext = {
      userId: accountant.id,
      isPlatformAdmin: false,
      memberships: [memAcct],
    };

    // 4. Create Campaign
    const campaign = await createDonationCampaign(trustAdminContext, {
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Annadanam Fund',
      purpose: 'Daily Prasad & Food Distribution',
      recipientLegalEntity: 'Shree Siddhivinayak Temple Trust',
      taxExemptionEligible: true,
      taxExemptionSection: '80G',
    });

    // 5. Devotee B initiates and completes a donation
    const { donation } = await initiateDonation({
      tenantId: tenant.id,
      templeId: temple.id,
      campaignId: campaign.id,
      donorUserId: devoteeB.id,
      amountMinorUnits: 250000, // ₹2,500.00
      currency: 'INR',
      donorName: 'Devotee Suresh',
      donorEmail: 'devoteeb@example.com',
      donorPan: 'ABCDE1234F',
    });

    const confirmRes = await confirmDonationPayment(
      tenant.id,
      donation.id,
      'pay_mock_123',
      'pay_provider_ref_456'
    );
    receiptB = confirmRes.receipt;
  });

  it('AT-07: Devotee A attempting to download Devotee B receipt is REJECTED with 403 Forbidden', async () => {
    // Devotee A attempts to fetch Devotee B's receipt
    await expect(
      getReceiptById(tenant.id, receiptB.id, devoteeAContext)
    ).rejects.toThrow(ForbiddenError);
  });

  it('AT-07: Devotee B can successfully fetch their own receipt', async () => {
    const fetchedReceipt = await getReceiptById(tenant.id, receiptB.id, devoteeBContext);
    expect(fetchedReceipt.id).toBe(receiptB.id);
    expect(fetchedReceipt.receiptNumber).toBe(receiptB.receiptNumber);
    expect(fetchedReceipt.amountMinorUnits).toBe(250000);
    expect(fetchedReceipt.donorUserId).toBe(devoteeB.id);
  });

  it('AT-07: Authorized staff with receipts.read permission can access the receipt for accounting', async () => {
    const staffFetched = await getReceiptById(tenant.id, receiptB.id, accountantContext);
    expect(staffFetched.id).toBe(receiptB.id);
    expect(staffFetched.issuingEntity).toBe('Shree Siddhivinayak Temple Trust');
  });
});
