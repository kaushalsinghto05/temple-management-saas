import { eq, and, sql, desc } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { withTenantContext } from '../../db/rls';
import {
  receipts,
  receiptRevisions,
  donations,
  temples,
  tenants,
  Receipt,
  ReceiptRevision,
} from '../../db/schema';
import { UserContext, enforcePermission } from '../../core/rbac/guard';
import { NotFoundError, ForbiddenError, ValidationError } from '../../core/errors';
import { logAuditEvent } from '../audit/audit-service';

export function calculateFiscalYear(date: Date = new Date()): string {
  // In India, fiscal year starts April 1 (month 3, 0-indexed)
  const month = date.getMonth();
  const year = date.getFullYear();
  if (month >= 3) {
    const nextYearShort = (year + 1) % 100;
    return `${year}-${nextYearShort.toString().padStart(2, '0')}`;
  } else {
    const currentYearShort = year % 100;
    return `${year - 1}-${currentYearShort.toString().padStart(2, '0')}`;
  }
}

export async function issueReceiptForDonation(input: {
  tenantId: string;
  templeId: string;
  donationId: string;
  donorUserId?: string | null;
  amountMinorUnits: number;
  currency: string;
  paymentReference: string;
  issuingEntity: string;
  taxDeductionEligible?: boolean;
  taxDeductionNote?: string;
}): Promise<Receipt> {
  return await withTenantContext(input.tenantId, async ({ db }) => {
    // Check if receipt already exists for this donation (idempotent receipt issuance)
    const [existing] = await db
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, input.tenantId), eq(receipts.donationId, input.donationId)))
      .limit(1);

    if (existing) {
      return existing;
    }

    const fiscalYear = calculateFiscalYear();

    // Count existing receipts for tenant in this fiscal year to determine sequential number
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(receipts)
      .where(and(eq(receipts.tenantId, input.tenantId), eq(receipts.fiscalYear, fiscalYear)));

    const currentCount = Number(countResult[0]?.count || 0);
    const sequenceNumber = currentCount + 1;

    // Fetch tenant slug for prefix
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1);

    const prefix = (tenant?.slug || 'RCP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const receiptNumber = `RCP-${prefix}-${fiscalYear}-${sequenceNumber.toString().padStart(5, '0')}`;

    const [receipt] = await db
      .insert(receipts)
      .values({
        tenantId: input.tenantId,
        templeId: input.templeId,
        donationId: input.donationId,
        donorUserId: input.donorUserId || null,
        receiptNumber,
        fiscalYear,
        issuingEntity: input.issuingEntity,
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency,
        paymentReference: input.paymentReference,
        status: 'VALID',
        taxDeductionEligible: input.taxDeductionEligible ?? false,
        taxDeductionNote: input.taxDeductionNote || null,
      })
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.donorUserId || 'SYSTEM',
      actorRole: 'SYSTEM',
      action: 'receipt.issued',
      resourceType: 'receipt',
      resourceId: receipt.id,
      changesSummary: {
        receiptNumber,
        donationId: input.donationId,
        amount: input.amountMinorUnits,
        fiscalYear,
      },
    });

    return receipt;
  });
}

export async function getReceiptById(
  tenantId: string,
  receiptId: string,
  userContext: UserContext
): Promise<Receipt> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [receipt] = await db
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, receiptId)))
      .limit(1);

    if (!receipt) {
      throw new NotFoundError(`Receipt '${receiptId}' not found`);
    }

    // Check authorization:
    // If user is privileged staff with 'receipts.read' permission for this temple
    let isStaffAuthorized = false;
    try {
      enforcePermission(userContext, tenantId, 'receipts.read', receipt.templeId);
      isStaffAuthorized = true;
    } catch {
      isStaffAuthorized = false;
    }

    // Devotee access check: can only read their own receipt (AT-07)
    const isDonorOwner = userContext.userId && receipt.donorUserId === userContext.userId;

    if (!isStaffAuthorized && !isDonorOwner) {
      throw new ForbiddenError('Access denied: You do not have permission to view this receipt');
    }

    return receipt;
  });
}

export async function voidReceipt(input: {
  tenantId: string;
  receiptId: string;
  reason: string;
  userContext: UserContext;
}): Promise<{ receipt: Receipt; revision: ReceiptRevision }> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new ValidationError('Reason is required to void a financial receipt');
  }

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [receipt] = await db
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, input.tenantId), eq(receipts.id, input.receiptId)))
      .limit(1);

    if (!receipt) {
      throw new NotFoundError(`Receipt '${input.receiptId}' not found`);
    }

    // Enforce permission: receipts.void (FR-REC-004)
    enforcePermission(input.userContext, input.tenantId, 'receipts.void', receipt.templeId);

    if (receipt.status === 'VOIDED') {
      throw new ValidationError('Receipt is already voided');
    }

    const previousState = { ...receipt };
    const newState = {
      ...receipt,
      status: 'VOIDED',
      voidedReason: input.reason,
      voidedByUserId: input.userContext.userId,
      updatedAt: new Date(),
    };

    // 1. Record immutable revision journal (AT-12)
    const [revision] = await db
      .insert(receiptRevisions)
      .values({
        receiptId: receipt.id,
        tenantId: input.tenantId,
        actorUserId: input.userContext.userId,
        action: 'VOIDED',
        previousState: previousState as any,
        newState: newState as any,
        reason: input.reason,
      })
      .returning();

    // 2. Update receipt status
    const [updatedReceipt] = await db
      .update(receipts)
      .set({
        status: 'VOIDED',
        voidedReason: input.reason,
        voidedByUserId: input.userContext.userId,
        updatedAt: new Date(),
      })
      .where(eq(receipts.id, receipt.id))
      .returning();

    // 3. Log to audit trail
    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.userContext.userId,
      actorRole: 'STAFF',
      action: 'receipt.voided',
      resourceType: 'receipt',
      resourceId: receipt.id,
      changesSummary: {
        receiptNumber: receipt.receiptNumber,
        reason: input.reason,
        revisionId: revision.id,
      },
    });

    return { receipt: updatedReceipt, revision };
  });
}

export async function getReceiptRevisions(
  tenantId: string,
  receiptId: string,
  userContext: UserContext
): Promise<ReceiptRevision[]> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [receipt] = await db
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, receiptId)))
      .limit(1);

    if (!receipt) {
      throw new NotFoundError(`Receipt '${receiptId}' not found`);
    }

    enforcePermission(userContext, tenantId, 'receipts.read', receipt.templeId);

    return await db
      .select()
      .from(receiptRevisions)
      .where(eq(receiptRevisions.receiptId, receiptId))
      .orderBy(desc(receiptRevisions.createdAt));
  });
}
