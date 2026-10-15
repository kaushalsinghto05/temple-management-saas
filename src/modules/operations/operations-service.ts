import { eq, and, desc, gte, lte, or, ilike, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { withTenantContext } from '../../db/rls';
import {
  bookings,
  Booking,
  payments,
  Payment,
  temples,
  tenants,
  pujaServices,
  pujaTimeSlots,
} from '../../db/schema';
import { UserContext, enforcePermission } from '../../core/rbac/guard';
import { NotFoundError, ValidationError, ForbiddenError } from '../../core/errors';
import { logAuditEvent } from '../audit/audit-service';
import { getLocalDateString } from '../reports/report-service';

export async function checkInBooking(input: {
  tenantId: string;
  bookingId: string;
  userContext: UserContext;
}): Promise<Booking> {
  return await withTenantContext(input.tenantId, async ({ db }) => {
    // 1. Fetch booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, input.tenantId), eq(bookings.id, input.bookingId)))
      .limit(1);

    if (!booking) {
      throw new NotFoundError(`Booking '${input.bookingId}' not found in this tenant`);
    }

    // 2. Enforce permission: bookings.check_in within temple scope (FR-BOOK-007)
    enforcePermission(input.userContext, input.tenantId, 'bookings.check_in', booking.templeId);

    // 3. Validation
    if (booking.status !== 'CONFIRMED') {
      throw new ValidationError(`Cannot check in booking with status '${booking.status}'. Only CONFIRMED bookings can be checked in.`);
    }

    if (booking.fulfillmentStatus === 'FULFILLED') {
      throw new ValidationError('Booking is already fulfilled / checked in');
    }

    // 4. Mark fulfillment status
    const [updated] = await db
      .update(bookings)
      .set({
        fulfillmentStatus: 'FULFILLED',
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id))
      .returning();

    // 5. Log audit trail
    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.userContext.userId,
      actorRole: 'STAFF',
      action: 'booking.checked_in',
      resourceType: 'booking',
      resourceId: booking.id,
      changesSummary: {
        bookingReference: booking.bookingReference,
        participantCount: booking.participantCount,
        previousFulfillment: 'UNFULFILLED',
        newFulfillment: 'FULFILLED',
      },
    });

    return updated;
  });
}

export async function searchBookings(input: {
  tenantId: string;
  templeId: string;
  userContext: UserContext;
  status?: string;
  fulfillmentStatus?: string;
  pujaServiceId?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}): Promise<Booking[]> {
  enforcePermission(input.userContext, input.tenantId, 'bookings.read', input.templeId);

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const conditions = [
      eq(bookings.tenantId, input.tenantId),
      eq(bookings.templeId, input.templeId),
    ];

    if (input.status) {
      conditions.push(eq(bookings.status, input.status));
    }

    if (input.fulfillmentStatus) {
      conditions.push(eq(bookings.fulfillmentStatus, input.fulfillmentStatus));
    }

    if (input.pujaServiceId) {
      conditions.push(eq(bookings.pujaServiceId, input.pujaServiceId));
    }

    if (input.searchQuery && input.searchQuery.trim().length > 0) {
      const q = `%${input.searchQuery.trim()}%`;
      conditions.push(
        or(
          ilike(bookings.bookingReference, q),
          sql`${bookings.devoteeDetails}::text ILIKE ${q}`
        )!
      );
    }

    return await db
      .select()
      .from(bookings)
      .where(and(...conditions))
      .orderBy(desc(bookings.createdAt))
      .limit(input.limit || 50)
      .offset(input.offset || 0);
  });
}

export async function getReconciliationQueue(input: {
  tenantId: string;
  templeId?: string;
  userContext: UserContext;
}): Promise<Payment[]> {
  enforcePermission(input.userContext, input.tenantId, 'reports.finance.read', input.templeId);

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const conditions = [
      eq(payments.tenantId, input.tenantId),
      eq(payments.status, 'RECONCILIATION_REQUIRED'),
    ];

    if (input.templeId) {
      conditions.push(eq(payments.templeId, input.templeId));
    }

    return await db
      .select()
      .from(payments)
      .where(and(...conditions))
      .orderBy(desc(payments.createdAt));
  });
}

export interface TempleDashboardData {
  tenantId: string;
  templeId: string;
  templeName: string;
  timezone: string;
  businessDate: string; // YYYY-MM-DD
  metrics: {
    todaysBookingsCount: number;
    todaysParticipantsCount: number;
    pendingPaymentCount: number;
    confirmedBookingsCount: number;
    fulfilledCount: number;
    unfulfilledCount: number;
    upcomingSlotsCount: number;
    operationalExceptionsCount: number;
    todaysRevenueMinorUnits: number;
  };
  todaysBookings: Booking[];
  upcomingSlots: Array<{
    slotId: string;
    pujaName: string;
    startTime: string;
    endTime: string;
    totalCapacity: number;
    allocatedCapacity: number;
    availabilityStatus: string;
  }>;
  operationalExceptions: Payment[];
}

/**
 * Temple daily operations dashboard (FR-BOOK-006, Section 7 Temple Dashboard).
 */
export async function getTempleDashboard(input: {
  tenantId: string;
  templeId: string;
  userContext: UserContext;
  date?: string; // Optional YYYY-MM-DD override
}): Promise<TempleDashboardData> {
  enforcePermission(input.userContext, input.tenantId, 'bookings.read', input.templeId);

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // 1. Fetch temple
    const [temple] = await db
      .select()
      .from(temples)
      .where(and(eq(temples.tenantId, input.tenantId), eq(temples.id, input.templeId)))
      .limit(1);

    if (!temple) {
      throw new NotFoundError(`Temple '${input.templeId}' not found`);
    }

    const timezone = temple.timezone || 'Asia/Kolkata';
    const businessDate = input.date || getLocalDateString(new Date(), timezone);

    // 2. Fetch all bookings for this temple
    const allBookings = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, input.tenantId), eq(bookings.templeId, input.templeId)))
      .orderBy(desc(bookings.createdAt));

    // Filter today's bookings
    const todaysBookings = allBookings.filter((b: any) => {
      const bDate = getLocalDateString(new Date(b.createdAt), timezone);
      return bDate === businessDate;
    });

    const confirmedToday = todaysBookings.filter((b: any) => b.status === 'CONFIRMED' || b.status === 'COMPLETED');
    const pendingToday = todaysBookings.filter((b: any) => b.status === 'PENDING_PAYMENT');
    const fulfilledToday = todaysBookings.filter((b: any) => b.fulfillmentStatus === 'FULFILLED');
    const unfulfilledToday = confirmedToday.filter((b: any) => b.fulfillmentStatus === 'UNFULFILLED');
    const todaysParticipants = confirmedToday.reduce((sum: number, b: any) => sum + b.participantCount, 0);
    const todaysRevenue = confirmedToday.reduce((sum: number, b: any) => sum + b.totalPriceMinorUnits, 0);

    // 3. Fetch upcoming slots
    const now = new Date();
    const rawSlots = await db
      .select({
        slotId: pujaTimeSlots.id,
        startTime: pujaTimeSlots.startTime,
        endTime: pujaTimeSlots.endTime,
        totalCapacity: pujaTimeSlots.totalCapacity,
        allocatedCapacity: pujaTimeSlots.allocatedCapacity,
        availabilityStatus: pujaTimeSlots.availabilityStatus,
        pujaName: pujaServices.name,
      })
      .from(pujaTimeSlots)
      .innerJoin(pujaServices, eq(pujaTimeSlots.pujaServiceId, pujaServices.id))
      .where(
        and(
          eq(pujaTimeSlots.tenantId, input.tenantId),
          eq(pujaTimeSlots.templeId, input.templeId),
          gte(pujaTimeSlots.startTime, now)
        )
      )
      .orderBy(pujaTimeSlots.startTime)
      .limit(20);

    const upcomingSlots = rawSlots.map((s: any) => ({
      slotId: s.slotId,
      pujaName: s.pujaName,
      startTime: s.startTime.toISOString(),
      endTime: s.endTime.toISOString(),
      totalCapacity: s.totalCapacity,
      allocatedCapacity: s.allocatedCapacity,
      availabilityStatus: s.availabilityStatus,
    }));

    // 4. Fetch operational exceptions
    const exceptions = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, input.tenantId),
          eq(payments.templeId, input.templeId),
          eq(payments.status, 'RECONCILIATION_REQUIRED')
        )
      );

    return {
      tenantId: input.tenantId,
      templeId: input.templeId,
      templeName: temple.name,
      timezone,
      businessDate,
      metrics: {
        todaysBookingsCount: todaysBookings.length,
        todaysParticipantsCount: todaysParticipants,
        pendingPaymentCount: pendingToday.length,
        confirmedBookingsCount: confirmedToday.length,
        fulfilledCount: fulfilledToday.length,
        unfulfilledCount: unfulfilledToday.length,
        upcomingSlotsCount: upcomingSlots.length,
        operationalExceptionsCount: exceptions.length,
        todaysRevenueMinorUnits: todaysRevenue,
      },
      todaysBookings,
      upcomingSlots,
      operationalExceptions: exceptions,
    };
  });
}

export interface PlatformOverviewData {
  totalTenants: number;
  tenantsByStatus: {
    active: number;
    suspended: number;
    pending: number;
  };
  totalTemples: number;
  totalPublishedTemples: number;
  totalExceptionsCount: number;
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: Date;
  }>;
}

/**
 * Platform operational overview (FR-AUD-004, Section 7 Platform Overview).
 */
export async function getPlatformOverview(userContext: UserContext): Promise<PlatformOverviewData> {
  if (!userContext.isPlatformAdmin) {
    throw new ForbiddenError('Platform administration privileges required (FR-AUD-004)');
  }

  const db = getDb();

  const allTenants = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
  const allTemples = await db.select().from(temples);
  const allExceptions = await db
    .select()
    .from(payments)
    .where(eq(payments.status, 'RECONCILIATION_REQUIRED'));

  const activeTenants = allTenants.filter((t: any) => t.status === 'ACTIVE').length;
  const suspendedTenants = allTenants.filter((t: any) => t.status === 'SUSPENDED').length;
  const pendingTenants = allTenants.filter((t: any) => t.status === 'PENDING' || t.status === 'ONBOARDING').length;
  const publishedTemples = allTemples.filter((t: any) => t.published).length;

  return {
    totalTenants: allTenants.length,
    tenantsByStatus: {
      active: activeTenants,
      suspended: suspendedTenants,
      pending: pendingTenants,
    },
    totalTemples: allTemples.length,
    totalPublishedTemples: publishedTemples,
    totalExceptionsCount: allExceptions.length,
    tenants: allTenants.map((t: any) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      createdAt: t.createdAt,
    })),
  };
}

/**
 * Platform operations exceptions queue (FR-AUD-005).
 */
export async function getOperationsExceptionsQueue(input: {
  userContext: UserContext;
  tenantId?: string;
}): Promise<Payment[]> {
  if (!input.userContext.isPlatformAdmin) {
    if (!input.tenantId) {
      throw new ForbiddenError('Tenant ID required for non-platform users');
    }
    enforcePermission(input.userContext, input.tenantId, 'reports.finance.read');
  }

  const db = getDb();
  const conditions = [eq(payments.status, 'RECONCILIATION_REQUIRED')];
  if (input.tenantId) {
    conditions.push(eq(payments.tenantId, input.tenantId));
  }

  return await db
    .select()
    .from(payments)
    .where(and(...conditions))
    .orderBy(desc(payments.createdAt));
}

/**
 * Resolves a payment reconciliation exception with audit logging (FR-AUD-005).
 */
export async function resolveReconciliationException(input: {
  tenantId: string;
  paymentId: string;
  userContext: UserContext;
  resolutionAction: 'MANUAL_REFUND' | 'FORCE_CONFIRM' | 'IGNORE';
  notes?: string;
}): Promise<Payment> {
  enforcePermission(input.userContext, input.tenantId, 'reports.finance.read');

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, input.tenantId), eq(payments.id, input.paymentId)))
      .limit(1);

    if (!payment) {
      throw new NotFoundError(`Payment '${input.paymentId}' not found`);
    }

    let newStatus = payment.status;
    if (input.resolutionAction === 'MANUAL_REFUND') {
      newStatus = 'REFUNDED';
    } else if (input.resolutionAction === 'FORCE_CONFIRM') {
      newStatus = 'SUCCEEDED';
    } else if (input.resolutionAction === 'IGNORE') {
      newStatus = 'FAILED';
    }

    const [updated] = await db
      .update(payments)
      .set({
        status: newStatus,
        reconciliationReason: input.notes
          ? `${payment.reconciliationReason || ''} [Resolved as ${input.resolutionAction}: ${input.notes}]`
          : `${payment.reconciliationReason || ''} [Resolved as ${input.resolutionAction}]`,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.userContext.userId,
      actorRole: 'STAFF',
      action: 'payment.reconciliation_resolved',
      resourceType: 'payment',
      resourceId: payment.id,
      changesSummary: {
        resolutionAction: input.resolutionAction,
        previousStatus: payment.status,
        newStatus,
        notes: input.notes,
      },
    });

    return updated;
  });
}

