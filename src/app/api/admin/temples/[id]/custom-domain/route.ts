import { NextRequest, NextResponse } from 'next/server';
import { configureCustomDomain } from '@/modules/white-label/white-label-service';
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

    const { userContext } = await authorizeRequest(
      authHeader,
      tenantId,
      'temples.write',
      templeId
    );

    const configured = await configureCustomDomain({
      tenantId: tenantId!,
      templeId,
      domain: body.domain,
      userContext,
      requestId: req.headers.get('x-request-id') || undefined,
    });

    return NextResponse.json({ success: true, data: configured }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
