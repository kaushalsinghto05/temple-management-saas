import { NextRequest, NextResponse } from 'next/server';
import { getDevoteeBookings } from '@/modules/bookings/booking-service';
import { getUserContextFromAuth } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = req.headers.get('x-tenant-id') || searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'tenantId is required' } },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const userContext = await getUserContextFromAuth(authHeader);

    const emailOrPhone = searchParams.get('email') || searchParams.get('phone') || undefined;

    const results = await getDevoteeBookings({
      tenantId,
      userContext,
      emailOrPhone,
    });

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
