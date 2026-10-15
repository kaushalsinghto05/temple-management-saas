import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember } from '@/modules/memberships/membership-service';
import { configureTemplePayment, processWebhookEvent } from '@/modules/payments/payment-service';
import { createDonationCampaign, initiateDonation } from '@/modules/donations/donation-service';
import { voidReceipt, getReceiptRevisions } from '@/modules/receipts/receipt-service';
import { MockPaymentAdapter } from '@/modules/payments/adapters/mock-adapter';
import { UserContext } from '@/core/rbac/guard';
import { ValidationError, ForbiddenError } from '@/core/errors';
import { getDb } from '@/db/client';
import { receipts, receiptRevisions } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('Acceptance Test AT-12: Financial Record Voiding Immutability (FR-REC-004, FR-AUD-001..003)', () => {
  let tenant: any;
  let temple: any;
  let adminUser: any;
  let accountantUser: any;
  let adminContext: UserContext;
  let accountantContext: UserContext;
  let receipt: any;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();

    const rootAdmin = await registerUser({
      email: 'admin.at12@trust.org',
      fullName: 'AT12 Admin',
    });

    tenant = await createTenant({
      name: 'Kashi Vishwanath Trust',
      slug: 'kashi',
      actorUserId: rootAdmin.id,
    });

    temple = await createTemple({
      tenantId: tenant.id,
      name: 'Kashi Vishwanath Temple',
      slug: 'vishwanath',
      timezone: 'Asia/Kolkata',
      address: { line1: 'Ghat Marg', city: 'Varanasi', state: 'Uttar Pradesh', postalCode: '221001', country: 'IN' },
      published: true,
      actorUserId: rootAdmin.id,
      actorRole: 'TRUST_ADMIN',
    });

    await configureTemplePayment({
      tenantId: tenant.id,
      templeId: temple.id,
      provider: 'MOCK',
      merchantAccountId: 'acct_kashi_99',
      webhookSecret: 'secret_kashi_test',
      apiKey: 'api_kashi_test',
      actorUserId: rootAdmin.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
    });

    // Staff with receipts.void (TEMPLE_ADMIN)
    adminUser = await registerUser({
      email: 'admin@kashitrust.org',
      fullName: 'Trustee Dixit',
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

    // Staff without receipts.void (TEMPLE_ACCOUNTANT)
    accountantUser = await registerUser({
      email: 'accountant@kashitrust.org',
      fullName: 'Clerk Mishra',
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

    // Create Campaign
    const campaign = await createDonationCampaign(adminContext, {
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Ganga Ghat Renovation',
      purpose: 'Restoration and safety railings along Manikarnika and Dashashwamedh',
      recipientLegalEntity: 'Kashi Vishwanath Mandir Trust',
      minAmountMinorUnits: 10000,
    });

    // Devotee donates and payment succeeds
    const { donation, paymentOrder } = await initiateDonation({
      tenantId: tenant.id,
      templeId: temple.id,
      campaignId: campaign.id,
      amountMinorUnits: 1000000, // ₹10,000.00
      donorName: 'Radhe Shyam',
      donorEmail: 'radhe@example.com',
      provider: 'MOCK',
    });

    const payload = JSON.stringify({
      event: 'payment.captured',
      event_id: `evt_kashi_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: `pay_kashi_${Date.now()}`,
            order_id: paymentOrder.providerOrderId,
            amount: 1000000,
            currency: 'INR',
          },
        },
      },
    });
    const sig = MockPaymentAdapter.signPayload(payload, 'secret_kashi_test');

    await processWebhookEvent({
      provider: 'MOCK',
      tenantId: tenant.id,
      templeId: temple.id,
      headers: { 'x-webhook-signature': sig },
      rawBody: payload,
    });

    const db = getDb();
    const [rcp] = await db.select().from(receipts).where(eq(receipts.donationId, donation.id));
    receipt = rcp;
  });

  it('AT-12: Staff without receipts.void permission cannot void receipt', async () => {
    await expect(
      voidReceipt({
        tenantId: tenant.id,
        receiptId: receipt.id,
        reason: 'Payment flagged as dispute',
        userContext: accountantContext,
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('AT-12: Voiding receipt preserves original record, records immutable revision snapshot and audit log', async () => {
    const voidReason = 'Chargeback notification received from gateway';

    // 1. Authorized Temple Admin voids the receipt
    const { receipt: voidedReceipt, revision } = await voidReceipt({
      tenantId: tenant.id,
      receiptId: receipt.id,
      reason: voidReason,
      userContext: adminContext,
    });

    expect(voidedReceipt.status).toBe('VOIDED');
    expect(voidedReceipt.voidedReason).toBe(voidReason);
    expect(voidedReceipt.voidedByUserId).toBe(adminUser.id);

    // 2. Original record in DB is preserved (not deleted)
    const db = getDb();
    const [dbReceipt] = await db.select().from(receipts).where(eq(receipts.id, receipt.id));
    expect(dbReceipt).toBeDefined();
    expect(dbReceipt.receiptNumber).toBe(receipt.receiptNumber);
    expect(dbReceipt.amountMinorUnits).toBe(receipt.amountMinorUnits);
    expect(dbReceipt.status).toBe('VOIDED');

    // 3. Verify revision journal in receipt_revisions
    expect(revision.receiptId).toBe(receipt.id);
    expect(revision.action).toBe('VOIDED');
    expect(revision.reason).toBe(voidReason);
    expect(revision.actorUserId).toBe(adminUser.id);
    expect((revision.previousState as any).status).toBe('VALID');
    expect((revision.newState as any).status).toBe('VOIDED');

    // 4. Querying revisions via service returns immutable history
    const history = await getReceiptRevisions(tenant.id, receipt.id, adminContext);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(revision.id);

    // 5. Attempting to void an already voided receipt is rejected
    await expect(
      voidReceipt({
        tenantId: tenant.id,
        receiptId: receipt.id,
        reason: 'Attempting duplicate void',
        userContext: adminContext,
      })
    ).rejects.toThrow(ValidationError);
  });
});
