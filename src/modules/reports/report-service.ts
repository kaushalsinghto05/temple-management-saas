import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { withTenantContext } from '../../db/rls';
import {
  payments,
  refunds,
  bookings,
  donations,
  donationCampaigns,
  receipts,
  temples,
  pujaServices,
} from '../../db/schema';
import { UserContext, enforcePermission } from '../../core/rbac/guard';
import { NotFoundError } from '../../core/errors';

export function getLocalDateString(date: Date, timezone: string = 'Asia/Kolkata'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    // Fallback if invalid timezone string
    return date.toISOString().slice(0, 10);
  }
}

export interface DailyFinancialRecord {
  businessDate: string; // YYYY-MM-DD in temple timezone
  grossCollectionsMinorUnits: number;
  netSettlementMinorUnits: number;
  feeMinorUnits: number;
  refundsMinorUnits: number;
  bookingRevenueMinorUnits: number;
  donationRevenueMinorUnits: number;
  transactionCount: number;
}

export interface FinancialReportResult {
  tenantId: string;
  templeId: string;
  timezone: string;
  currency: string;
  totals: {
    totalGrossCollectionsMinorUnits: number;
    totalNetSettlementMinorUnits: number;
    totalFeeMinorUnits: number;
    totalRefundsMinorUnits: number;
    totalBookingRevenueMinorUnits: number;
    totalDonationRevenueMinorUnits: number;
    totalTransactionsCount: number;
  };
  dailyRecords: DailyFinancialRecord[];
}

export interface PujaOperationalRecord {
  pujaServiceId: string;
  pujaName: string;
  totalBookings: number;
  totalParticipants: number;
  fulfilledCount: number;
  unfulfilledCount: number;
  fulfillmentRatePercentage: number;
  totalRevenueMinorUnits: number;
}

export interface BookingReportItem {
  bookingId: string;
  bookingReference: string;
  businessDate: string; // YYYY-MM-DD in temple timezone
  createdAt: string;    // ISO
  pujaServiceId: string;
  pujaName: string;
  slotId: string;
  status: string;
  fulfillmentStatus: string;
  participantCount: number;
  totalPriceMinorUnits: number;
  currency: string;
  devoteeName: string;
  devoteePhone?: string;
  devoteeEmail?: string;
  gotra?: string;
  nakshatra?: string;
}

export interface BookingReportResult {
  tenantId: string;
  templeId: string;
  timezone: string;
  totalBookings: number;
  totalParticipants: number;
  totalRevenueMinorUnits: number;
  bookings: BookingReportItem[];
}

export interface DonationReportItem {
  donationId: string;
  businessDate: string; // YYYY-MM-DD in temple timezone
  createdAt: string;    // ISO
  campaignId: string;
  campaignName: string;
  donorName: string;
  donorEmail?: string;
  donorPhone?: string;
  donorPan?: string;
  amountMinorUnits: number;
  currency: string;
  status: string;
  receiptNumber?: string;
  taxExemptionEligible: boolean;
  taxExemptionSection?: string;
}

export interface DonationReportResult {
  tenantId: string;
  templeId: string;
  timezone: string;
  totalDonations: number;
  totalAmountMinorUnits: number;
  donations: DonationReportItem[];
}

export async function getDailyFinancialReport(input: {
  tenantId: string;
  templeId: string;
  userContext: UserContext;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;   // YYYY-MM-DD
}): Promise<FinancialReportResult> {
  enforcePermission(input.userContext, input.tenantId, 'reports.finance.read', input.templeId);

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // 1. Fetch temple to determine local timezone
    const [temple] = await db
      .select()
      .from(temples)
      .where(and(eq(temples.tenantId, input.tenantId), eq(temples.id, input.templeId)))
      .limit(1);

    if (!temple) {
      throw new NotFoundError(`Temple '${input.templeId}' not found`);
    }

    const timezone = temple.timezone || 'Asia/Kolkata';

    // 2. Fetch all payments for this temple
    const paymentRecords = await db
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, input.tenantId), eq(payments.templeId, input.templeId)));

    // 3. Fetch all refunds for this temple
    const refundRecords = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.tenantId, input.tenantId), eq(refunds.templeId, input.templeId)));

    // 4. Group by local business date in the temple's timezone (FR-REP-001)
    const map = new Map<string, DailyFinancialRecord>();

    const getOrCreateDaily = (dateStr: string): DailyFinancialRecord => {
      let r = map.get(dateStr);
      if (!r) {
        r = {
          businessDate: dateStr,
          grossCollectionsMinorUnits: 0,
          netSettlementMinorUnits: 0,
          feeMinorUnits: 0,
          refundsMinorUnits: 0,
          bookingRevenueMinorUnits: 0,
          donationRevenueMinorUnits: 0,
          transactionCount: 0,
        };
        map.set(dateStr, r);
      }
      return r;
    };

    for (const p of paymentRecords) {
      if (p.status !== 'SUCCEEDED' && p.status !== 'REFUNDED') {
        continue;
      }

      const businessDate = getLocalDateString(new Date(p.createdAt), timezone);
      if (input.fromDate && businessDate < input.fromDate) continue;
      if (input.toDate && businessDate > input.toDate) continue;

      const daily = getOrCreateDaily(businessDate);
      daily.grossCollectionsMinorUnits += p.amountMinorUnits;
      daily.transactionCount += 1;

      const fee = p.feeMinorUnits || 0;
      daily.feeMinorUnits += fee;
      daily.netSettlementMinorUnits += (p.netSettlementMinorUnits ?? (p.amountMinorUnits - fee));

      if (p.referenceType === 'BOOKING') {
        daily.bookingRevenueMinorUnits += p.amountMinorUnits;
      } else if (p.referenceType === 'DONATION') {
        daily.donationRevenueMinorUnits += p.amountMinorUnits;
      }
    }

    for (const ref of refundRecords) {
      if (ref.status !== 'COMPLETED') continue;

      const businessDate = getLocalDateString(new Date(ref.createdAt), timezone);
      if (input.fromDate && businessDate < input.fromDate) continue;
      if (input.toDate && businessDate > input.toDate) continue;

      const daily = getOrCreateDaily(businessDate);
      daily.refundsMinorUnits += ref.amountMinorUnits;
      daily.netSettlementMinorUnits -= ref.amountMinorUnits;
    }

    // Sort daily records ascending
    const dailyRecords = Array.from(map.values()).sort((a, b) =>
      a.businessDate.localeCompare(b.businessDate)
    );

    // Compute grand totals
    const totals = {
      totalGrossCollectionsMinorUnits: dailyRecords.reduce((sum, r) => sum + r.grossCollectionsMinorUnits, 0),
      totalNetSettlementMinorUnits: dailyRecords.reduce((sum, r) => sum + r.netSettlementMinorUnits, 0),
      totalFeeMinorUnits: dailyRecords.reduce((sum, r) => sum + r.feeMinorUnits, 0),
      totalRefundsMinorUnits: dailyRecords.reduce((sum, r) => sum + r.refundsMinorUnits, 0),
      totalBookingRevenueMinorUnits: dailyRecords.reduce((sum, r) => sum + r.bookingRevenueMinorUnits, 0),
      totalDonationRevenueMinorUnits: dailyRecords.reduce((sum, r) => sum + r.donationRevenueMinorUnits, 0),
      totalTransactionsCount: dailyRecords.reduce((sum, r) => sum + r.transactionCount, 0),
    };

    return {
      tenantId: input.tenantId,
      templeId: input.templeId,
      timezone,
      currency: 'INR',
      totals,
      dailyRecords,
    };
  });
}

export async function getOperationalPujaReport(input: {
  tenantId: string;
  templeId: string;
  userContext: UserContext;
}): Promise<PujaOperationalRecord[]> {
  enforcePermission(input.userContext, input.tenantId, 'reports.view', input.templeId);

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // 1. Fetch all puja services
    const services = await db
      .select()
      .from(pujaServices)
      .where(and(eq(pujaServices.tenantId, input.tenantId), eq(pujaServices.templeId, input.templeId)));

    // 2. Fetch all confirmed bookings
    const confirmedBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, input.tenantId),
          eq(bookings.templeId, input.templeId),
          eq(bookings.status, 'CONFIRMED')
        )
      );

    const report: PujaOperationalRecord[] = [];

    for (const s of services) {
      const sBookings = confirmedBookings.filter((b: any) => b.pujaServiceId === s.id);
      const totalBookings = sBookings.length;
      const totalParticipants = sBookings.reduce((sum: number, b: any) => sum + b.participantCount, 0);
      const fulfilledCount = sBookings.filter((b: any) => b.fulfillmentStatus === 'FULFILLED').length;
      const unfulfilledCount = sBookings.filter((b: any) => b.fulfillmentStatus === 'UNFULFILLED').length;
      const totalRevenue = sBookings.reduce((sum: number, b: any) => sum + b.totalPriceMinorUnits, 0);
      const fulfillmentRate = totalBookings > 0 ? (fulfilledCount / totalBookings) * 100 : 0;

      report.push({
        pujaServiceId: s.id,
        pujaName: s.name,
        totalBookings,
        totalParticipants,
        fulfilledCount,
        unfulfilledCount,
        fulfillmentRatePercentage: Math.round(fulfillmentRate * 100) / 100,
        totalRevenueMinorUnits: totalRevenue,
      });
    }

    return report;
  });
}

/**
 * Timezone-aware booking report with filtering by business date, status, puja service (FR-REP-001, FR-REP-003).
 */
export async function getBookingReport(input: {
  tenantId: string;
  templeId: string;
  userContext: UserContext;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;   // YYYY-MM-DD
  status?: string;
  pujaServiceId?: string;
}): Promise<BookingReportResult> {
  enforcePermission(input.userContext, input.tenantId, 'reports.view', input.templeId);

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // 1. Fetch temple for timezone
    const [temple] = await db
      .select()
      .from(temples)
      .where(and(eq(temples.tenantId, input.tenantId), eq(temples.id, input.templeId)))
      .limit(1);

    if (!temple) {
      throw new NotFoundError(`Temple '${input.templeId}' not found`);
    }

    const timezone = temple.timezone || 'Asia/Kolkata';

    // 2. Query bookings
    const conditions = [
      eq(bookings.tenantId, input.tenantId),
      eq(bookings.templeId, input.templeId),
    ];

    if (input.status) {
      conditions.push(eq(bookings.status, input.status));
    }

    if (input.pujaServiceId) {
      conditions.push(eq(bookings.pujaServiceId, input.pujaServiceId));
    }

    const allBookings = await db
      .select()
      .from(bookings)
      .where(and(...conditions))
      .orderBy(desc(bookings.createdAt));

    // 3. Filter by temple business date
    const filtered: BookingReportItem[] = [];

    for (const b of allBookings) {
      const bDate = getLocalDateString(new Date(b.createdAt), timezone);
      if (input.fromDate && bDate < input.fromDate) continue;
      if (input.toDate && bDate > input.toDate) continue;

      const details = (b.devoteeDetails || {}) as any;
      const snapshot = (b.serviceSnapshot || {}) as any;

      filtered.push({
        bookingId: b.id,
        bookingReference: b.bookingReference,
        businessDate: bDate,
        createdAt: b.createdAt.toISOString(),
        pujaServiceId: b.pujaServiceId,
        pujaName: snapshot.name || 'Puja Service',
        slotId: b.slotId,
        status: b.status,
        fulfillmentStatus: b.fulfillmentStatus,
        participantCount: b.participantCount,
        totalPriceMinorUnits: b.totalPriceMinorUnits,
        currency: b.currency,
        devoteeName: details.name || 'Unknown',
        devoteePhone: details.phone,
        devoteeEmail: details.email,
        gotra: details.gotra,
        nakshatra: details.nakshatra,
      });
    }

    const totalRevenueMinorUnits = filtered
      .filter((b) => b.status === 'CONFIRMED' || b.status === 'COMPLETED')
      .reduce((sum, b) => sum + b.totalPriceMinorUnits, 0);

    const totalParticipants = filtered.reduce((sum, b) => sum + b.participantCount, 0);

    return {
      tenantId: input.tenantId,
      templeId: input.templeId,
      timezone,
      totalBookings: filtered.length,
      totalParticipants,
      totalRevenueMinorUnits,
      bookings: filtered,
    };
  });
}

/**
 * Timezone-aware donation report with campaign breakdown, receipt numbers, and tax exemption status (FR-REP-002, FR-REP-003).
 */
export async function getDonationReport(input: {
  tenantId: string;
  templeId: string;
  userContext: UserContext;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;   // YYYY-MM-DD
  campaignId?: string;
  status?: string;
}): Promise<DonationReportResult> {
  enforcePermission(input.userContext, input.tenantId, 'reports.finance.read', input.templeId);

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [temple] = await db
      .select()
      .from(temples)
      .where(and(eq(temples.tenantId, input.tenantId), eq(temples.id, input.templeId)))
      .limit(1);

    if (!temple) {
      throw new NotFoundError(`Temple '${input.templeId}' not found`);
    }

    const timezone = temple.timezone || 'Asia/Kolkata';

    // Fetch campaigns for this temple
    const campaigns = await db
      .select()
      .from(donationCampaigns)
      .where(and(eq(donationCampaigns.tenantId, input.tenantId), eq(donationCampaigns.templeId, input.templeId)));

    const campaignMap = new Map(campaigns.map((c: any) => [c.id, c]));

    // Fetch receipts for this temple
    const receiptRecords = await db
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, input.tenantId), eq(receipts.templeId, input.templeId)));

    const receiptByDonationId = new Map(receiptRecords.map((r: any) => [r.donationId, r]));

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

    const allDonations = await db
      .select()
      .from(donations)
      .where(and(...conditions))
      .orderBy(desc(donations.createdAt));

    const filtered: DonationReportItem[] = [];

    for (const d of allDonations) {
      const bDate = getLocalDateString(new Date(d.createdAt), timezone);
      if (input.fromDate && bDate < input.fromDate) continue;
      if (input.toDate && bDate > input.toDate) continue;

      const camp = campaignMap.get(d.campaignId) as any;
      const rec = receiptByDonationId.get(d.id) as any;

      filtered.push({
        donationId: d.id,
        businessDate: bDate,
        createdAt: d.createdAt.toISOString(),
        campaignId: d.campaignId,
        campaignName: camp?.name || 'General Donation',
        donorName: d.donorName,
        donorEmail: d.donorEmail || undefined,
        donorPhone: d.donorPhone || undefined,
        donorPan: d.donorPan || undefined,
        amountMinorUnits: d.amountMinorUnits,
        currency: d.currency,
        status: d.status,
        receiptNumber: rec?.receiptNumber,
        taxExemptionEligible: camp?.taxExemptionEligible ?? false,
        taxExemptionSection: camp?.taxExemptionSection || undefined,
      });
    }

    const totalAmountMinorUnits = filtered
      .filter((d: any) => d.status === 'PAID')
      .reduce((sum: number, d: any) => sum + d.amountMinorUnits, 0);

    return {
      tenantId: input.tenantId,
      templeId: input.templeId,
      timezone,
      totalDonations: filtered.length,
      totalAmountMinorUnits,
      donations: filtered,
    };
  });
}

/**
 * Converts records into standard RFC 4180 CSV string format (FR-REP-004)
 */
export function exportToCsv<T>(
  columns: { header: string; key: keyof T | ((row: T) => string | number | null | undefined) }[],
  data: T[]
): string {
  const escapeCsvField = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = columns.map((c) => escapeCsvField(c.header)).join(',');
  const lines = [headerLine];

  for (const row of data) {
    const values = columns.map((col) => {
      if (typeof col.key === 'function') {
        return escapeCsvField(col.key(row));
      }
      return escapeCsvField(row[col.key]);
    });
    lines.push(values.join(','));
  }

  return lines.join('\r\n');
}
