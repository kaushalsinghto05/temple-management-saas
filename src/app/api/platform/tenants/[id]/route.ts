import { NextRequest, NextResponse } from 'next/server';
import { getTenantById, updateTenantStatus } from '@/modules/tenants/tenant-service';
import { authorizeRequest } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    await authorizeRequest(authHeader, null, 'tenants.read');

    const tenant = await getTenantById(id);
    return NextResponse.json({ success: true, data: tenant });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const { userContext } = await authorizeRequest(authHeader, null, 'tenants.manage');
    const body = await req.json();

    const updated = await updateTenantStatus({
      tenantId: id,
      status: body.status,
      actorUserId: userContext.userId,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
