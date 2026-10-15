import { NextRequest, NextResponse } from 'next/server';
import { initiateDonation } from '@/modules/donations/donation-service';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { donation, payment, paymentOrder } = await initiateDonation({
      tenantId: body.tenantId,
      templeId: body.templeId,
      campaignId: body.campaignId,
      donorUserId: body.donorUserId,
      amountMinorUnits: body.amountMinorUnits,
      currency: body.currency,
      donorName: body.donorName,
      donorEmail: body.donorEmail,
      donorPhone: body.donorPhone,
      donorPan: body.donorPan,
      provider: body.provider,
    });

    return NextResponse.json({
      success: true,
      data: {
        donationId: donation.id,
        amountMinorUnits: donation.amountMinorUnits,
        currency: donation.currency,
        status: donation.status,
        paymentId: payment.id,
        paymentOrder,
      },
    }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
