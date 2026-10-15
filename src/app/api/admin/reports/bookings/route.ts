import { NextRequest, NextResponse } from 'next/server';
import { getBookingReport, exportToCsv, BookingReportItem } from '@/modules/reports/report-service';
import { getUserContextFromAuth } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = req.headers.get('x-tenant-id') || searchParams.get('tenantId');
    const templeId = searchParams.get('templeId');

    if (!tenantId || !templeId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'tenantId and templeId are required' } },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const userContext = await getUserContextFromAuth(authHeader);

    const report = await getBookingReport({
      tenantId,
      templeId,
      userContext,
      fromDate: searchParams.get('fromDate') || undefined,
      toDate: searchParams.get('toDate') || undefined,
      status: searchParams.get('status') || undefined,
      pujaServiceId: searchParams.get('pujaServiceId') || undefined,
    });

    const format = searchParams.get('format') || '';
    const acceptHeader = req.headers.get('accept') || '';

    if (format.toLowerCase() === 'csv' || acceptHeader.includes('text/csv')) {
      const csv = exportToCsv<BookingReportItem>(
        [
          { header: 'Booking Reference', key: 'bookingReference' },
          { header: 'Business Date', key: 'businessDate' },
          { header: 'Puja Name', key: 'pujaName' },
          { header: 'Status', key: 'status' },
          { header: 'Fulfillment', key: 'fulfillmentStatus' },
          { header: 'Participants', key: 'participantCount' },
          { header: 'Total Price (₹)', key: (r) => (r.totalPriceMinorUnits / 100).toFixed(2) },
          { header: 'Devotee Name', key: 'devoteeName' },
          { header: 'Phone', key: (r) => r.devoteePhone || '' },
          { header: 'Email', key: (r) => r.devoteeEmail || '' },
          { header: 'Gotra', key: (r) => r.gotra || '' },
          { header: 'Nakshatra', key: (r) => r.nakshatra || '' },
        ],
        report.bookings
      );

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="booking-report-${report.templeId}-${Date.now()}.csv"`,
        },
      });
    }

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
