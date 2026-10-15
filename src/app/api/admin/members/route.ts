import { NextRequest, NextResponse } from 'next/server';
import { inviteMember, listMembersByTenant } from '@/modules/memberships/membership-service';
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
      'members.manage'
    );

    const membership = await inviteMember({
      tenantId,
      email: body.email,
      role: body.role,
      assignedTempleId: body.assignedTempleId,
      invitedByUserId: userContext.userId,
      actorRole: authResult.role,
    });

    return NextResponse.json({ success: true, data: membership }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const tenantId = req.headers.get('x-tenant-id') || req.nextUrl.searchParams.get('tenantId');

    await authorizeRequest(authHeader, tenantId, 'members.read');

    const members = await listMembersByTenant(tenantId!);
    return NextResponse.json({ success: true, data: members });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
