import { NextRequest, NextResponse } from 'next/server';
import { getDailyFinancialReport, exportToCsv, DailyFinancialRecord } from '@/modules/reports/report-service';
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

    const report = await getDailyFinancialReport({
      tenantId,
      templeId,
      userContext,
      fromDate: searchParams.get('fromDate') || undefined,
      toDate: searchParams.get('toDate') || undefined,
    });

    const format = searchParams.get('format') || '';
    const acceptHeader = req.headers.get('accept') || '';

    if (format.toLowerCase() === 'csv' || acceptHeader.includes('text/csv')) {
      const csv = exportToCsv<DailyFinancialRecord>(
        [
          { header: 'Business Date', key: 'businessDate' },
          { header: 'Transactions', key: 'transactionCount' },
          { header: 'Gross Collections (₹)', key: (r) => (r.grossCollectionsMinorUnits / 100).toFixed(2) },
          { header: 'Gateway Fees (₹)', key: (r) => (r.feeMinorUnits / 100).toFixed(2) },
          { header: 'Refunds (₹)', key: (r) => (r.refundsMinorUnits / 100).toFixed(2) },
          { header: 'Net Settlement (₹)', key: (r) => (r.netSettlementMinorUnits / 100).toFixed(2) },
          { header: 'Pujas Revenue (₹)', key: (r) => (r.bookingRevenueMinorUnits / 100).toFixed(2) },
          { header: 'Donations Revenue (₹)', key: (r) => (r.donationRevenueMinorUnits / 100).toFixed(2) },
        ],
        report.dailyRecords
      );

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="financial-report-${report.templeId}-${Date.now()}.csv"`,
        },
      });
    }

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
