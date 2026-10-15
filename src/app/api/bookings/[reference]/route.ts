import { NextRequest, NextResponse } from 'next/server';
import { getBookingByReference } from '@/modules/bookings/booking-service';
import { handleApiError } from '@/core/errors/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    const { reference } = await params;
    const tenantId = req.headers.get('x-tenant-id') || req.nextUrl.searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'x-tenant-id header or query param required' } },
        { status: 400 }
      );
    }

    const booking = await getBookingByReference(tenantId, reference);

    return NextResponse.json({
      success: true,
      data: {
        bookingReference: booking.bookingReference,
        status: booking.status,
        fulfillmentStatus: booking.fulfillmentStatus,
        participantCount: booking.participantCount,
        totalPriceMinorUnits: booking.totalPriceMinorUnits,
        currency: booking.currency,
        serviceSnapshot: booking.serviceSnapshot,
        devoteeDetails: booking.devoteeDetails,
        expiresAt: booking.expiresAt,
        createdAt: booking.createdAt,
      },
    });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
