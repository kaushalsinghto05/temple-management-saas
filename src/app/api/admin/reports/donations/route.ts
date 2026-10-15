import { NextRequest, NextResponse } from 'next/server';
import { getDonationReport, exportToCsv, DonationReportItem } from '@/modules/reports/report-service';
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

    const report = await getDonationReport({
      tenantId,
      templeId,
      userContext,
      fromDate: searchParams.get('fromDate') || undefined,
      toDate: searchParams.get('toDate') || undefined,
      campaignId: searchParams.get('campaignId') || undefined,
      status: searchParams.get('status') || undefined,
    });

    const format = searchParams.get('format') || '';
    const acceptHeader = req.headers.get('accept') || '';

    if (format.toLowerCase() === 'csv' || acceptHeader.includes('text/csv')) {
      const csv = exportToCsv<DonationReportItem>(
        [
          { header: 'Business Date', key: 'businessDate' },
          { header: 'Campaign', key: 'campaignName' },
          { header: 'Donor Name', key: 'donorName' },
          { header: 'Amount (₹)', key: (r) => (r.amountMinorUnits / 100).toFixed(2) },
          { header: 'Currency', key: 'currency' },
          { header: 'Status', key: 'status' },
          { header: 'Receipt Number', key: (r) => r.receiptNumber || '' },
          { header: 'PAN', key: (r) => r.donorPan || '' },
          { header: '80G Eligible', key: (r) => (r.taxExemptionEligible ? 'YES' : 'NO') },
          { header: '80G Section', key: (r) => r.taxExemptionSection || '' },
          { header: 'Email', key: (r) => r.donorEmail || '' },
          { header: 'Phone', key: (r) => r.donorPhone || '' },
        ],
        report.donations
      );

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="donation-report-${report.templeId}-${Date.now()}.csv"`,
        },
      });
    }

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
