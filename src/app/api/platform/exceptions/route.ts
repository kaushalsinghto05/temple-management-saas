import { NextRequest, NextResponse } from 'next/server';
import { getOperationsExceptionsQueue } from '@/modules/operations/operations-service';
import { getUserContextFromAuth } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = req.headers.get('x-tenant-id') || searchParams.get('tenantId') || undefined;

    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const userContext = await getUserContextFromAuth(authHeader);

    const exceptions = await getOperationsExceptionsQueue({
      userContext,
      tenantId,
    });

    return NextResponse.json({ success: true, data: exceptions });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
