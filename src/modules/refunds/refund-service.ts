import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { withTenantContext } from '../../db/rls';
import {
  bookings,
  pujaTimeSlots,
  payments,
  refunds,
  Booking,
  Refund,
} from '../../db/schema';
import { UserContext, enforcePermission } from '../../core/rbac/guard';
import { NotFoundError, ForbiddenError, ValidationError } from '../../core/errors';
import { logAuditEvent } from '../audit/audit-service';
import { getTemplePaymentConfig, getPaymentAdapter } from '../payments/payment-service';

export async function cancelBookingAndRefund(input: {
  tenantId: string;
  bookingId: string;
  reason: string;
  userContext: UserContext;
}): Promise<{ booking: Booking; refund?: Refund }> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new ValidationError('Cancellation reason is required');
  }

  // Pre-fetch booking to determine templeId and check authorization
  const db = getDb();
  let bookingRecord: Booking | undefined;

  await withTenantContext(input.tenantId, async ({ db: txDb }) => {
    const [b] = await txDb
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, input.tenantId), eq(bookings.id, input.bookingId)))
      .limit(1);
    bookingRecord = b;
  });

  if (!bookingRecord) {
    throw new NotFoundError(`Booking '${input.bookingId}' not found`);
  }

  // Verify permission: refunds.issue (AT-08)
  try {
    enforcePermission(input.userContext, input.tenantId, 'refunds.issue', bookingRecord.templeId);
  } catch (err) {
    // Log unauthorized refund attempt in audit log (AT-08 requirement)
    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.userContext?.userId || 'UNKNOWN',
      actorRole: 'UNAUTHORIZED',
      action: 'refund.unauthorized_attempt',
      resourceType: 'booking',
      resourceId: input.bookingId,
      changesSummary: {
        reason: input.reason,
        error: (err as Error).message,
      },
    });
    throw err;
  }

  if (bookingRecord.status === 'CANCELLED') {
    throw new ValidationError('Booking is already cancelled');
  }

  return await withTenantContext(input.tenantId, async ({ db: txDb }) => {
    // 1. Release capacity back to the slot if not already released (FR-BOOK-008)
    if (!bookingRecord!.capacityReleased) {
      await txDb
        .update(pujaTimeSlots)
        .set({
          allocatedCapacity: sql`GREATEST(0, ${pujaTimeSlots.allocatedCapacity} - ${bookingRecord!.participantCount})`,
          updatedAt: new Date(),
        })
        .where(eq(pujaTimeSlots.id, bookingRecord!.slotId));
    }

    // 2. Mark booking as CANCELLED
    const [cancelledBooking] = await txDb
      .update(bookings)
      .set({
        status: 'CANCELLED',
        capacityReleased: true,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingRecord!.id))
      .returning();

    // 3. Check if there is an associated successful payment to refund (FR-PAY-008)
    const [payment] = await txDb
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, input.tenantId),
          eq(payments.bookingId, bookingRecord!.id),
          eq(payments.status, 'SUCCEEDED')
        )
      )
      .limit(1);

    let refundRecord: Refund | undefined;

    if (payment) {
      const config = await getTemplePaymentConfig(input.tenantId, bookingRecord!.templeId, payment.provider);
      const adapter = getPaymentAdapter(payment.provider);

      let providerRefundId = `ref_internal_${Date.now()}`;
      if (adapter.createRefund) {
        const refundResult = await adapter.createRefund(
          {
            providerPaymentId: payment.providerPaymentId || payment.providerOrderId,
            amountMinorUnits: payment.amountMinorUnits,
            reason: input.reason,
          },
          config.apiKey
        );
        providerRefundId = refundResult.providerRefundId;
      }

      // Record refund in refunds table
      const [newRefund] = await txDb
        .insert(refunds)
        .values({
          tenantId: input.tenantId,
          templeId: bookingRecord!.templeId,
          paymentId: payment.id,
          bookingId: bookingRecord!.id,
          amountMinorUnits: payment.amountMinorUnits,
          currency: payment.currency,
          reason: input.reason,
          status: 'COMPLETED',
          providerRefundId,
          requestedByUserId: input.userContext.userId,
        })
        .returning();

      refundRecord = newRefund;

      // Update payment status to REFUNDED
      await txDb
        .update(payments)
        .set({
          status: 'REFUNDED',
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));
    }

    // 4. Log cancellation & refund to audit log
    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.userContext.userId,
      actorRole: 'STAFF',
      action: 'booking.cancelled_and_refunded',
      resourceType: 'booking',
      resourceId: bookingRecord!.id,
      changesSummary: {
        reason: input.reason,
        refundId: refundRecord?.id,
        amountRefunded: refundRecord?.amountMinorUnits,
        capacityReleased: bookingRecord!.participantCount,
      },
    });

    return { booking: cancelledBooking, refund: refundRecord };
  });
}
