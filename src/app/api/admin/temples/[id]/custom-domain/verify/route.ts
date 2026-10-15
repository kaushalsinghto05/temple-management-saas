import { NextRequest, NextResponse } from 'next/server';
import { verifyCustomDomain } from '@/modules/white-label/white-label-service';
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

    const verified = await verifyCustomDomain({
      tenantId: tenantId!,
      domainId: body.domainId,
      verificationToken: body.verificationToken,
      userContext,
      requestId: req.headers.get('x-request-id') || undefined,
    });

    return NextResponse.json({ success: true, data: verified });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
