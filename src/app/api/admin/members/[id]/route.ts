import { NextRequest, NextResponse } from 'next/server';
import { updateMemberRole, revokeMember } from '@/modules/memberships/membership-service';
import { authorizeRequest } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function PATCH(
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
      'members.manage'
    );

    const updated = await updateMemberRole({
      tenantId,
      membershipId: id,
      newRole: body.role,
      assignedTempleId: body.assignedTempleId,
      actorUserId: userContext.userId,
      actorRole: authResult.role,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const tenantId = req.headers.get('x-tenant-id') || req.nextUrl.searchParams.get('tenantId');

    const { userContext, authResult } = await authorizeRequest(
      authHeader,
      tenantId,
      'members.manage'
    );

    const revoked = await revokeMember({
      tenantId: tenantId!,
      membershipId: id,
      actorUserId: userContext.userId,
      actorRole: authResult.role,
    });

    return NextResponse.json({ success: true, data: revoked });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
