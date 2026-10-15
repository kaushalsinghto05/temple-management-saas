import { NextRequest, NextResponse } from 'next/server';
import { createTemple, listTemplesByTenant } from '@/modules/temples/temple-service';
import { authorizeRequest } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const body = await req.json();
    const tenantId = req.headers.get('x-tenant-id') || body.tenantId;

    const { userContext, authResult } = await authorizeRequest(
      authHeader,
      tenantId,
      'temples.create'
    );

    const temple = await createTemple({
      tenantId,
      name: body.name,
      slug: body.slug,
      timezone: body.timezone,
      address: body.address,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      branding: body.branding,
      operatingStatus: body.operatingStatus,
      published: body.published,
      actorUserId: userContext.userId,
      actorRole: authResult.role,
    });

    return NextResponse.json({ success: true, data: temple }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const tenantId = req.headers.get('x-tenant-id') || req.nextUrl.searchParams.get('tenantId');

    await authorizeRequest(authHeader, tenantId, 'temples.read');

    const temples = await listTemplesByTenant(tenantId!);
    return NextResponse.json({ success: true, data: temples });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
