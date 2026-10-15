import { NextRequest, NextResponse } from 'next/server';
import { voidReceipt } from '@/modules/receipts/receipt-service';
import { getUserContextFromAuth } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: receiptId } = await params;
    const body = await req.json();
    const tenantId = req.headers.get('x-tenant-id') || body.tenantId;

    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Tenant context required' } },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const userContext = await getUserContextFromAuth(authHeader);

    const result = await voidReceipt({
      tenantId,
      receiptId,
      reason: body.reason,
      userContext,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
