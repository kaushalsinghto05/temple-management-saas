import { NextRequest, NextResponse } from 'next/server';
import { setPujaStatus } from '@/modules/pujas/puja-service';
import { authorizeRequest } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const body = await req.json();
    const tenantId = req.headers.get('x-tenant-id') || body.tenantId;

    const { userContext, authResult } = await authorizeRequest(
      authHeader,
      tenantId,
      'pujas.write'
    );

    const updated = await setPujaStatus(
      tenantId!,
      id,
      body.status, // 'PUBLISHED', 'DRAFT', 'ARCHIVED'
      userContext.userId,
      authResult.role
    );

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
