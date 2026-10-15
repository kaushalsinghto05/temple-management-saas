import { NextRequest, NextResponse } from 'next/server';
import { checkInBooking } from '@/modules/operations/operations-service';
import { getUserContextFromAuth } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookingId } = await params;
    const body = await req.json().catch(() => ({}));
    const tenantId = req.headers.get('x-tenant-id') || body.tenantId;

    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Tenant context required' } },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const userContext = await getUserContextFromAuth(authHeader);

    const booking = await checkInBooking({
      tenantId,
      bookingId,
      userContext,
    });

    return NextResponse.json({ success: true, data: booking });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
