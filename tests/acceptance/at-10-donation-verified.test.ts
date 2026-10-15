import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { configureTemplePayment, processWebhookEvent } from '@/modules/payments/payment-service';
import { createDonationCampaign, initiateDonation } from '@/modules/donations/donation-service';
import { MockPaymentAdapter } from '@/modules/payments/adapters/mock-adapter';
import { UserContext } from '@/core/rbac/guard';
import { getDb } from '@/db/client';
import { donations, receipts } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('Acceptance Test AT-10: Donation Lifecycle & Verified Receipt (FR-DON-001..005, FR-REC-001..003)', () => {
  let tenant: any;
  let temple: any;
  let devotee: any;
  let campaign: any;
  const webhookSecret = 'whsec_somnath_test_secret';

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.at10@trust.org',
      fullName: 'AT10 Admin',
    });

    tenant = await createTenant({
      name: 'Shree Somnath Trust',
      slug: 'somnath',
      actorUserId: rootAdmin.id,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Somnath Jyotirlinga Temple',
      slug: 'jyotirlinga',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Temple Path', city: 'Prabhas Patan', state: 'Gujarat', postalCode: '362268', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    // Create Trust Admin for campaign creation
    const trustAdmin = await registerUser({
      email: 'trustee.somnath@trust.org',
      fullName: 'Somnath Trustee',
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

    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_somnath_merchant',
      webhookSecret,
      apiKey: 'key_somnath_test',
      actorUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });

    devotee = await registerUser({
      email: 'bhakt@example.com',
      fullName: 'Girish Kumar',
      password: 'Password123!',
    });

    campaign = await createDonationCampaign(trustAdminContext, {
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Goshala Care & Protection',
      purpose: 'Preservation, feeding, and medical care of indigenous cows',
      recipientLegalEntity: 'Shree Somnath Temple Trust',
      suggestedAmountsMinorUnits: [50000, 110000, 210000, 510000], // ₹500, ₹1100, ₹2100, ₹5100
      minAmountMinorUnits: 10000, // ₹100.00
      taxExemptionEligible: true,
      taxExemptionSection: '80G',
    });
  });

  it('AT-10: Valid donation -> verified webhook -> receipt issued with sequential number and 80G tax exemption note', async () => {
    // 1. Devotee initiates donation for ₹5,100.00 (510000 minor units) with PAN
    const { donation, paymentOrder } = await initiateDonation({
      tenantId: tenant.id,
      templeId: temple.id,
      campaignId: campaign.id,
      donorUserId: devotee.id,
      amountMinorUnits: 510000,
      currency: 'INR',
      donorName: 'Girish Kumar',
      donorEmail: 'bhakt@example.com',
      donorPan: 'ABCDE1234F',
      provider: 'MOCK',
    });

    expect(donation.status).toBe('PENDING');

    // 2. Gateway delivers signed payment.captured webhook
    const providerPaymentId = `pay_somnath_${Date.now()}`;
    const payload = JSON.stringify({
      event: 'payment.captured',
      event_id: `evt_somnath_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: providerPaymentId,
            order_id: paymentOrder.providerOrderId,
            amount: 510000,
            currency: 'INR',
          },
        },
      },
    });

    const signature = MockPaymentAdapter.signPayload(payload, webhookSecret);

    const webhookRes = await processWebhookEvent({
      provider: 'MOCK',
      tenantId: tenant.id,
      templeId: temple.id,
      headers: { 'x-webhook-signature': signature },
      rawBody: payload,
    });

    expect(webhookRes.status).toBe('PROCESSED');

    // 3. Verify donation status in DB
    const db = getDb();
    const [updatedDonation] = await db
      .select()
      .from(donations)
      .where(eq(donations.id, donation.id));
    expect(updatedDonation.status).toBe('PAID');

    // 4. Verify receipt generated in DB
    const [receipt] = await db
      .select()
      .from(receipts)
      .where(eq(receipts.donationId, donation.id));

    expect(receipt).toBeDefined();
    expect(receipt.receiptNumber).toMatch(/^RCP-SOMN-\d{4}-\d{2}-00001$/);
    expect(receipt.issuingEntity).toBe('Shree Somnath Temple Trust');
    expect(receipt.amountMinorUnits).toBe(510000);
    expect(receipt.currency).toBe('INR');
    expect(receipt.paymentReference).toBe(providerPaymentId);
    expect(receipt.taxDeductionEligible).toBe(true);
    expect(receipt.taxDeductionNote).toContain('Section 80G');
    expect(receipt.status).toBe('VALID');

    // 5. Subsequent donation gets next sequential receipt number (00002)
    const secondDonation = await initiateDonation({
      tenantId: tenant.id,
      templeId: temple.id,
      campaignId: campaign.id,
      amountMinorUnits: 110000,
      donorName: 'Anil Gupta',
      provider: 'MOCK',
    });

    const secondPayload = JSON.stringify({
      event: 'payment.captured',
      event_id: `evt_somnath_2_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: `pay_somnath_second_${Date.now()}`,
            order_id: secondDonation.paymentOrder.providerOrderId,
            amount: 110000,
            currency: 'INR',
          },
        },
      },
    });
    const secondSig = MockPaymentAdapter.signPayload(secondPayload, webhookSecret);

    await processWebhookEvent({
      provider: 'MOCK',
      tenantId: tenant.id,
      templeId: temple.id,
      headers: { 'x-webhook-signature': secondSig },
      rawBody: secondPayload,
    });

    const [secondReceipt] = await db
      .select()
      .from(receipts)
      .where(eq(receipts.donationId, secondDonation.donation.id));

    expect(secondReceipt.receiptNumber).toMatch(/^RCP-SOMN-\d{4}-\d{2}-00002$/);
  });
});
