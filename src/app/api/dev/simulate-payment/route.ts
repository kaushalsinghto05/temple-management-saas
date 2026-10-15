import { NextRequest, NextResponse } from 'next/server';
import { processWebhookEvent, getTemplePaymentConfig } from '@/modules/payments/payment-service';
import { MockPaymentAdapter } from '@/modules/payments/adapters/mock-adapter';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, templeId, providerOrderId, amountMinorUnits, currency = 'INR', provider = 'MOCK' } = body;

    if (!tenantId || !templeId || !providerOrderId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Missing tenantId, templeId, or providerOrderId' } },
        { status: 400 }
      );
    }

    const config = await getTemplePaymentConfig(tenantId, templeId, provider);
    const eventId = `evt_sim_${Date.now()}`;
    const rawPayload = JSON.stringify({
      id: eventId,
      event: 'payment.captured',
      order_id: providerOrderId,
      payment_id: `pay_sim_${Date.now()}`,
      amount: amountMinorUnits,
      currency,
    });

    const signature = MockPaymentAdapter.signPayload(rawPayload, config.webhookSecret);

    const result = await processWebhookEvent({
      provider,
      tenantId,
      templeId,
      headers: {
        'x-webhook-signature': signature,
      },
      rawBody: rawPayload,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
