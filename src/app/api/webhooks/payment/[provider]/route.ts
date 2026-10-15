import { NextRequest, NextResponse } from 'next/server';
import { processWebhookEvent } from '@/modules/payments/payment-service';
import { handleApiError } from '@/core/errors/handler';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    const rawBody = await req.text();

    const templeId = req.headers.get('x-temple-id') || req.nextUrl.searchParams.get('templeId');
    const tenantId = req.headers.get('x-tenant-id') || req.nextUrl.searchParams.get('tenantId');

    if (!templeId || !tenantId) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Missing templeId or tenantId context' } },
        { status: 400 }
      );
    }

    const headers: Record<string, string> = {};
    req.headers.forEach((val, key) => {
      headers[key.toLowerCase()] = val;
    });

    const result = await processWebhookEvent({
      provider: provider.toUpperCase(),
      templeId,
      tenantId,
      headers,
      rawBody,
    });

    return NextResponse.json({
      success: true,
      status: result.status,
      reason: result.reason,
    });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
