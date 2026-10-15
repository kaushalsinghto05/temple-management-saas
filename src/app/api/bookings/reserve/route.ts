import { NextRequest, NextResponse } from 'next/server';
import { reservePujaSlot } from '@/modules/bookings/booking-service';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { booking, paymentOrder } = await reservePujaSlot({
      tenantId: body.tenantId,
      templeId: body.templeId,
      pujaServiceId: body.pujaServiceId,
      slotId: body.slotId,
      participantCount: body.participantCount,
      devoteeDetails: body.devoteeDetails,
      devoteeUserId: body.devoteeUserId,
      paymentProvider: body.paymentProvider,
    });

    return NextResponse.json({
      success: true,
      data: {
        bookingReference: booking.bookingReference,
        status: booking.status,
        expiresAt: booking.expiresAt,
        totalPriceMinorUnits: booking.totalPriceMinorUnits,
        currency: booking.currency,
        paymentOrder,
      },
    }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
