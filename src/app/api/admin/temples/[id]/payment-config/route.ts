import { NextRequest, NextResponse } from 'next/server';
import { configureTemplePayment } from '@/modules/payments/payment-service';
import { authorizeRequest } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: templeId } = await params;
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const body = await req.json();
    const tenantId = req.headers.get('x-tenant-id') || body.tenantId;

    const { userContext, authResult } = await authorizeRequest(
      authHeader,
      tenantId,
      'temples.write',
      templeId
    );

    const config = await configureTemplePayment({
      tenantId,
      templeId,
      provider: body.provider || 'MOCK',
      merchantAccountId: body.merchantAccountId,
      webhookSecret: body.webhookSecret,
      apiKey: body.apiKey,
      actorUserId: userContext.userId,
      actorRole: authResult.role,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: config.id,
        templeId: config.templeId,
        provider: config.provider,
        merchantAccountId: config.merchantAccountId,
        status: config.status,
      },
    }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
