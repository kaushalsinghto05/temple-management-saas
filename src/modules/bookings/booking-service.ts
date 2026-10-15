import { bookings, Booking, DevoteeDetails, pujaServices, pujaTimeSlots } from '../../db/schema';
import { withTenantContext } from '../../db/rls';
import { eq, and, lt, desc, or, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../../core/errors';
import { UserContext } from '../../core/rbac/guard';
import { captureServiceSnapshot } from '../white-label/white-label-service';
import { createPaymentOrder } from '../payments/payment-service';
import { PaymentOrder } from '../payments/adapters/types';
import { generateToken } from '../../core/auth/crypto';
import { logAuditEvent } from '../audit/audit-service';

export interface ReserveSlotInput {
  tenantId: string;
  templeId: string;
  pujaServiceId: string;
  slotId: string;
  participantCount: number;
  devoteeDetails: DevoteeDetails;
  devoteeUserId?: string;
  paymentProvider?: 'RAZORPAY' | 'STRIPE' | 'MOCK';
}

export function generateBookingReference(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomStr = generateToken(4).toUpperCase();
  return `BK-${dateStr}-${randomStr}`;
}

export async function reservePujaSlot(
  input: ReserveSlotInput
): Promise<{ booking: Booking; paymentOrder: PaymentOrder }> {
  if (input.participantCount <= 0) {
    throw new ValidationError('Participant count must be at least 1');
  }
  if (!input.devoteeDetails.name) {
    throw new ValidationError('Devotee name is required');
  }

  return await withTenantContext(input.tenantId, async ({ tx, db }) => {
    // 1. Authoritative price calculation (FR-BOOK-002)
    const [puja] = await db
      .select()
      .from(pujaServices)
      .where(
        and(
          eq(pujaServices.id, input.pujaServiceId),
          eq(pujaServices.templeId, input.templeId),
          eq(pujaServices.tenantId, input.tenantId),
          eq(pujaServices.status, 'PUBLISHED')
        )
      )
      .limit(1);

    if (!puja) {
      throw new NotFoundError('Published puja service not found in this temple');
    }

    // Authoritative pricing: client cannot supply or override price (FR-BOOK-002)
    const totalPriceMinorUnits = puja.priceMinorUnits * input.participantCount;

    // 2. Atomic capacity reservation with row-level locking (FR-BOOK-003, AT-02)
    // Only succeeds if remaining capacity >= requested participant count
    const updateRes = await tx.query(
      `
      UPDATE puja_time_slots
      SET allocated_capacity = allocated_capacity + $1,
          availability_status = CASE WHEN allocated_capacity + $1 >= total_capacity THEN 'FULL' ELSE 'AVAILABLE' END,
          updated_at = NOW()
      WHERE id = $2
        AND tenant_id = $3
        AND availability_status = 'AVAILABLE'
        AND (total_capacity - allocated_capacity) >= $1
      RETURNING id, total_capacity, allocated_capacity, availability_status;
    `,
      [input.participantCount, input.slotId, input.tenantId]
    );

    if (updateRes.rows.length === 0) {
      throw new ConflictError('Capacity exceeded: requested seats are no longer available');
    }

    // 3. Capture historical snapshot (FR-PUJA-006)
    const serviceSnapshot = captureServiceSnapshot(puja);

    // 4. Create pending booking with 10-minute hold TTL (FR-BOOK-004)
    const bookingReference = generateBookingReference();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry TTL

    const [booking] = await db
      .insert(bookings)
      .values({
        tenantId: input.tenantId,
        templeId: input.templeId,
        pujaServiceId: input.pujaServiceId,
        slotId: input.slotId,
        devoteeUserId: input.devoteeUserId || null,
        bookingReference,
        participantCount: input.participantCount,
        totalPriceMinorUnits,
        currency: puja.currency,
        serviceSnapshot,
        devoteeDetails: input.devoteeDetails,
        status: 'PENDING_PAYMENT',
        fulfillmentStatus: 'UNFULFILLED',
        expiresAt,
        capacityReleased: false,
      })
      .returning();

    // 5. Create payment order attempt via provider adapter (FR-PAY-002)
    const { paymentOrder } = await createPaymentOrder({
      tenantId: input.tenantId,
      templeId: input.templeId,
      referenceId: booking.id,
      referenceType: 'BOOKING',
      amountMinorUnits: totalPriceMinorUnits,
      currency: puja.currency,
      customer: {
        name: input.devoteeDetails.name,
        email: input.devoteeDetails.email,
        phone: input.devoteeDetails.phone,
      },
      provider: input.paymentProvider || 'MOCK',
    });

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.devoteeUserId || 'ANONYMOUS_DEVOTEE',
      actorRole: 'DEVOTEE',
      action: 'booking.reserved',
      resourceType: 'booking',
      resourceId: booking.id,
      changesSummary: {
        reference: booking.bookingReference,
        totalPrice: booking.totalPriceMinorUnits,
        expiresAt: booking.expiresAt,
      },
    });

    return { booking, paymentOrder };
  });
}

/**
 * Releases capacity for expired reservations exactly once (FR-BOOK-009).
 */
export async function releaseExpiredReservations(tenantId: string): Promise<number> {
  const now = new Date();

  return await withTenantContext(tenantId, async ({ tx, db }) => {
    // Find unreleased expired pending bookings
    const expiredBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.status, 'PENDING_PAYMENT'),
          lt(bookings.expiresAt, now),
          eq(bookings.capacityReleased, false)
        )
      );

    let releasedCount = 0;

    for (const b of expiredBookings) {
      // 1. Mark booking expired and capacity released
      await db
        .update(bookings)
        .set({
          status: 'EXPIRED',
          capacityReleased: true,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, b.id));

      // 2. Decrement allocated capacity on slot atomically (FR-BOOK-009)
      await tx.query(
        `
        UPDATE puja_time_slots
        SET allocated_capacity = GREATEST(0, allocated_capacity - $1),
            availability_status = 'AVAILABLE',
            updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3;
      `,
        [b.participantCount, b.slotId, tenantId]
      );

      releasedCount++;
    }

    return releasedCount;
  });
}

/**
 * Confirms booking payment when verified webhook arrives (FR-BOOK-005).
 * Guards against late payment after expiration (AT-06).
 */
export async function confirmBookingPayment(
  tenantId: string,
  bookingId: string,
  paymentId: string,
  providerPaymentId: string,
  amountMinorUnits: number,
  currency: string
): Promise<{ confirmed: boolean; reason?: string }> {
  const now = new Date();

  return await withTenantContext(tenantId, async ({ db }) => {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
      .limit(1);

    if (!booking) {
      return { confirmed: false, reason: 'Booking not found' };
    }

    // AT-06 Exception Handling: Payment arrived after reservation expired!
    if (booking.status === 'EXPIRED' || booking.expiresAt < now) {
      await logAuditEvent({
        tenantId,
        actorId: 'SYSTEM',
        actorRole: 'WEBHOOK',
        action: 'payment.late_received_after_expiration',
        resourceType: 'booking',
        resourceId: booking.id,
        changesSummary: {
          bookingStatus: booking.status,
          expiresAt: booking.expiresAt,
          paymentId,
        },
      });

      return {
        confirmed: false,
        reason: 'Payment succeeded after reservation expired; quarantined for refund or manual resolution',
      };
    }

    // AT-05: Mismatched amount or currency
    if (
      amountMinorUnits !== booking.totalPriceMinorUnits ||
      currency.toUpperCase() !== booking.currency.toUpperCase()
    ) {
      return {
        confirmed: false,
        reason: `Mismatched amount or currency: expected ${booking.totalPriceMinorUnits} ${booking.currency}, received ${amountMinorUnits} ${currency}`,
      };
    }

    // Success transition (FR-BOOK-005)
    await db
      .update(bookings)
      .set({
        status: 'CONFIRMED',
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    await logAuditEvent({
      tenantId,
      actorId: 'SYSTEM',
      actorRole: 'WEBHOOK',
      action: 'booking.confirmed',
      resourceType: 'booking',
      resourceId: booking.id,
      changesSummary: {
        paymentId,
        providerPaymentId,
        amount: amountMinorUnits,
      },
    });

    return { confirmed: true };
  });
}

export async function getBookingByReference(
  tenantId: string,
  reference: string
): Promise<Booking> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.bookingReference, reference)))
      .limit(1);

    if (!booking) {
      throw new NotFoundError(`Booking reference '${reference}' not found`);
    }

    return booking;
  });
}

/**
 * Devotee self-service booking retrieval (FR-BOOK-010).
 */
export async function getDevoteeBookings(input: {
  tenantId: string;
  userContext: UserContext;
  emailOrPhone?: string;
}): Promise<Booking[]> {
  if (!input.userContext.userId && !input.emailOrPhone) {
    throw new ForbiddenError('Authenticated user or devotee contact identifier is required');
  }

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const conditions = [eq(bookings.tenantId, input.tenantId)];

    if (input.userContext.userId) {
      conditions.push(eq(bookings.devoteeUserId, input.userContext.userId));
    }

    const devoteeBookings = await db
      .select()
      .from(bookings)
      .where(and(...conditions))
      .orderBy(desc(bookings.createdAt));

    if (input.emailOrPhone) {
      const q = input.emailOrPhone.trim().toLowerCase();
      return devoteeBookings.filter((b: any) => {
        const details = b.devoteeDetails as any;
        return (
          details?.email?.toLowerCase() === q ||
          details?.phone === q
        );
      });
    }

    return devoteeBookings;
  });
}

