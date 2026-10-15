import { NextRequest, NextResponse } from 'next/server';
import { resolveReconciliationException } from '@/modules/operations/operations-service';
import { getUserContextFromAuth } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const tenantId = req.headers.get('x-tenant-id') || body.tenantId;

    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'tenantId is required' } },
        { status: 400 }
      );
    }

    if (!body.resolutionAction || !['MANUAL_REFUND', 'FORCE_CONFIRM', 'IGNORE'].includes(body.resolutionAction)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'resolutionAction must be MANUAL_REFUND, FORCE_CONFIRM, or IGNORE' } },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const userContext = await getUserContextFromAuth(authHeader);

    const updated = await resolveReconciliationException({
      tenantId,
      paymentId: id,
      userContext,
      resolutionAction: body.resolutionAction,
      notes: body.notes,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const { status, body: errBody } = handleApiError(error);
    return NextResponse.json(errBody, { status });
  }
}
