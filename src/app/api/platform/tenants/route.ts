import { NextRequest, NextResponse } from 'next/server';
import { createTenant, listTenants } from '@/modules/tenants/tenant-service';
import { authorizeRequest } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const { userContext } = await authorizeRequest(authHeader, null, 'tenants.manage');
    const body = await req.json();

    const tenant = await createTenant({
      name: body.name,
      slug: body.slug,
      actorUserId: userContext.userId,
    });

    return NextResponse.json({ success: true, data: tenant }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    await authorizeRequest(authHeader, null, 'tenants.read');

    const tenantsList = await listTenants();
    return NextResponse.json({ success: true, data: tenantsList });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
