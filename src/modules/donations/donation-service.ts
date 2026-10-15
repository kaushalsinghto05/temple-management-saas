import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { withTenantContext } from '../../db/rls';
import {
  donationCampaigns,
  donations,
  temples,
  DonationCampaign,
  Donation,
  Receipt,
  Payment,
} from '../../db/schema';
import { UserContext, enforcePermission } from '../../core/rbac/guard';
import { ValidationError, NotFoundError, ForbiddenError } from '../../core/errors';
import { logAuditEvent } from '../audit/audit-service';
import { createPaymentOrder } from '../payments/payment-service';
import { issueReceiptForDonation } from '../receipts/receipt-service';
import { PaymentOrder } from '../payments/adapters/types';

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createDonationCampaign(
  userContext: UserContext,
  input: {
    tenantId: string;
    templeId: string;
    name: string;
    purpose: string;
    recipientLegalEntity: string;
    suggestedAmountsMinorUnits?: number[];
    minAmountMinorUnits?: number;
    maxAmountMinorUnits?: number;
    taxExemptionEligible?: boolean;
    taxExemptionSection?: string;
  }
): Promise<DonationCampaign> {
  enforcePermission(userContext, input.tenantId, 'temples.write', input.templeId);

  if (!input.name || input.name.trim().length === 0) {
    throw new ValidationError('Campaign name is required');
  }
  if (!input.purpose || input.purpose.trim().length === 0) {
    throw new ValidationError('Campaign purpose is required');
  }
  if (!input.recipientLegalEntity || input.recipientLegalEntity.trim().length === 0) {
    throw new ValidationError('Recipient legal entity is required for official financial accounting');
  }

  const suggested = input.suggestedAmountsMinorUnits || [10000, 25000, 50000, 100000]; // ₹100, ₹250, ₹500, ₹1000
  const minAmount = input.minAmountMinorUnits ?? 1000; // Default ₹10.00

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [campaign] = await db
      .insert(donationCampaigns)
      .values({
        tenantId: input.tenantId,
        templeId: input.templeId,
        name: input.name,
        purpose: input.purpose,
        recipientLegalEntity: input.recipientLegalEntity,
        suggestedAmountsMinorUnits: JSON.stringify(suggested),
        minAmountMinorUnits: minAmount,
        maxAmountMinorUnits: input.maxAmountMinorUnits ?? null,
        status: 'ACTIVE',
        taxExemptionEligible: input.taxExemptionEligible ?? false,
        taxExemptionSection: input.taxExemptionSection || null,
      })
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: userContext.userId,
      actorRole: 'STAFF',
      action: 'donation_campaign.created',
      resourceType: 'donation_campaign',
      resourceId: campaign.id,
      changesSummary: {
        name: campaign.name,
        templeId: campaign.templeId,
        recipientLegalEntity: campaign.recipientLegalEntity,
      },
    });

    return campaign;
  });
}

export async function getCampaigns(
  tenantId: string,
  templeId: string,
  onlyActive: boolean = true
): Promise<DonationCampaign[]> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const conditions = [
      eq(donationCampaigns.tenantId, tenantId),
      eq(donationCampaigns.templeId, templeId),
    ];

    if (onlyActive) {
      conditions.push(eq(donationCampaigns.status, 'ACTIVE'));
    }

    return await db
      .select()
      .from(donationCampaigns)
      .where(and(...conditions))
      .orderBy(desc(donationCampaigns.createdAt));
  });
}

export async function getCampaignById(
  tenantId: string,
  campaignId: string
): Promise<DonationCampaign> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [campaign] = await db
      .select()
      .from(donationCampaigns)
      .where(
        and(eq(donationCampaigns.tenantId, tenantId), eq(donationCampaigns.id, campaignId))
      )
      .limit(1);

    if (!campaign) {
      throw new NotFoundError(`Donation campaign '${campaignId}' not found`);
    }

    return campaign;
  });
}

export async function initiateDonation(input: {
  tenantId: string;
  templeId: string;
  campaignId: string;
  donorUserId?: string | null;
  amountMinorUnits: number;
  currency?: string;
  donorName: string;
  donorEmail?: string;
  donorPhone?: string;
  donorPan?: string;
  provider?: string;
}): Promise<{ donation: Donation; payment: Payment; paymentOrder: PaymentOrder }> {
  const currency = input.currency || 'INR';

  if (!input.donorName || input.donorName.trim().length === 0) {
    throw new ValidationError('Donor name is required');
  }

  if (input.donorEmail && !EMAIL_REGEX.test(input.donorEmail)) {
    throw new ValidationError('Invalid donor email address format');
  }

  // Fetch campaign to validate limits and tax exemption details
  const campaign = await getCampaignById(input.tenantId, input.campaignId);

  if (campaign.status !== 'ACTIVE') {
    throw new ValidationError(`Donation campaign is not active (status: ${campaign.status})`);
  }

  if (input.amountMinorUnits < campaign.minAmountMinorUnits) {
    throw new ValidationError(
      `Donation amount must be at least ₹${(campaign.minAmountMinorUnits / 100).toFixed(2)}`
    );
  }

  if (campaign.maxAmountMinorUnits && input.amountMinorUnits > campaign.maxAmountMinorUnits) {
    throw new ValidationError(
      `Donation amount cannot exceed ₹${(campaign.maxAmountMinorUnits / 100).toFixed(2)}`
    );
  }

  // If PAN is provided, validate its format (FR-DON-004)
  let cleanPan = input.donorPan?.trim().toUpperCase();
  if (cleanPan) {
    if (!PAN_REGEX.test(cleanPan)) {
      throw new ValidationError('Invalid Indian Permanent Account Number (PAN) format');
    }
  }

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // 1. Create donation record
    const [donation] = await db
      .insert(donations)
      .values({
        tenantId: input.tenantId,
        templeId: input.templeId,
        campaignId: input.campaignId,
        donorUserId: input.donorUserId || null,
        amountMinorUnits: input.amountMinorUnits,
        currency,
        donorName: input.donorName.trim(),
        donorEmail: input.donorEmail?.trim() || null,
        donorPhone: input.donorPhone?.trim() || null,
        donorPan: cleanPan || null,
        status: 'PENDING',
      })
      .returning();

    // 2. Initiate payment order with payment adapter
    const { payment, paymentOrder } = await createPaymentOrder({
      tenantId: input.tenantId,
      templeId: input.templeId,
      referenceId: donation.id,
      referenceType: 'DONATION',
      amountMinorUnits: input.amountMinorUnits,
      currency,
      provider: (input.provider as 'MOCK' | 'RAZORPAY' | 'STRIPE') || 'MOCK',
      customer: {
        name: input.donorName,
        email: input.donorEmail,
        phone: input.donorPhone,
      },
    });

    return { donation, payment, paymentOrder };
  });
}

export async function confirmDonationPayment(
  tenantId: string,
  donationId: string,
  paymentId: string,
  providerPaymentId: string
): Promise<{ donation: Donation; receipt: Receipt }> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [donation] = await db
      .select()
      .from(donations)
      .where(and(eq(donations.tenantId, tenantId), eq(donations.id, donationId)))
      .limit(1);

    if (!donation) {
      throw new NotFoundError(`Donation '${donationId}' not found`);
    }

    if (donation.status === 'PAID') {
      // Already paid; retrieve receipt
      const receipt = await issueReceiptForDonation({
        tenantId,
        templeId: donation.templeId,
        donationId: donation.id,
        donorUserId: donation.donorUserId,
        amountMinorUnits: donation.amountMinorUnits,
        currency: donation.currency,
        paymentReference: providerPaymentId,
        issuingEntity: 'Temple Trust',
      });
      return { donation, receipt };
    }

    // 1. Update donation status to PAID
    const [updatedDonation] = await db
      .update(donations)
      .set({
        status: 'PAID',
        updatedAt: new Date(),
      })
      .where(eq(donations.id, donation.id))
      .returning();

    // 2. Fetch campaign to obtain issuing entity & tax exemption section (FR-REC-002, FR-REC-003, AT-10)
    const [campaign] = await db
      .select()
      .from(donationCampaigns)
      .where(eq(donationCampaigns.id, donation.campaignId))
      .limit(1);

    const issuingEntity = campaign?.recipientLegalEntity || 'Temple Religious and Charitable Trust';
    const taxNote = campaign?.taxExemptionEligible && campaign.taxExemptionSection
      ? `Donation eligible for tax deduction under Section ${campaign.taxExemptionSection} of the Income Tax Act.`
      : undefined;

    // 3. Issue official sequential receipt
    const receipt = await issueReceiptForDonation({
      tenantId,
      templeId: donation.templeId,
      donationId: donation.id,
      donorUserId: donation.donorUserId,
      amountMinorUnits: donation.amountMinorUnits,
      currency: donation.currency,
      paymentReference: providerPaymentId,
      issuingEntity,
      taxDeductionEligible: campaign?.taxExemptionEligible ?? false,
      taxDeductionNote: taxNote,
    });

    await logAuditEvent({
      tenantId,
      actorId: donation.donorUserId || 'SYSTEM',
      actorRole: 'SYSTEM',
      action: 'donation.paid',
      resourceType: 'donation',
      resourceId: donation.id,
      changesSummary: {
        amount: donation.amountMinorUnits,
        currency: donation.currency,
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
      },
    });

    return { donation: updatedDonation, receipt };
  });
}

export async function searchDonations(
  userContext: UserContext,
  input: {
    tenantId: string;
    templeId: string;
    campaignId?: string;
    status?: string;
  }
): Promise<Donation[]> {
  enforcePermission(userContext, input.tenantId, 'donations.read', input.templeId);

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const conditions = [
      eq(donations.tenantId, input.tenantId),
      eq(donations.templeId, input.templeId),
    ];

    if (input.campaignId) {
      conditions.push(eq(donations.campaignId, input.campaignId));
    }
    if (input.status) {
      conditions.push(eq(donations.status, input.status));
    }

    return await db
      .select()
      .from(donations)
      .where(and(...conditions))
      .orderBy(desc(donations.createdAt));
  });
}

export async function getDevoteeDonations(
  userContext: UserContext,
  tenantId: string
): Promise<Donation[]> {
  if (!userContext.userId) {
    throw new ForbiddenError('Authenticated user required');
  }

  return await withTenantContext(tenantId, async ({ db }) => {
    return await db
      .select()
      .from(donations)
      .where(
        and(
          eq(donations.tenantId, tenantId),
          eq(donations.donorUserId, userContext.userId)
        )
      )
      .orderBy(desc(donations.createdAt));
  });
}
