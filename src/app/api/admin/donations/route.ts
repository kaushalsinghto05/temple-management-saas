import { NextRequest, NextResponse } from 'next/server';
import { searchDonations } from '@/modules/donations/donation-service';
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

    const results = await searchDonations(userContext, {
      tenantId,
      templeId,
      campaignId: searchParams.get('campaignId') || undefined,
      status: searchParams.get('status') || undefined,
    });

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
