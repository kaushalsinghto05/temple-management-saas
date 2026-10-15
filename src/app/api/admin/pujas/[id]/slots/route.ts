import { NextRequest, NextResponse } from 'next/server';
import { createPujaTimeSlot, listSlotsForPuja } from '@/modules/pujas/puja-service';
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

    const slot = await createPujaTimeSlot({
      tenantId: tenantId!,
      templeId: body.templeId,
      pujaServiceId: id,
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
      totalCapacity: body.totalCapacity,
      actorUserId: userContext.userId,
      actorRole: authResult.role,
    });

    return NextResponse.json({ success: true, data: slot }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const tenantId = req.headers.get('x-tenant-id') || req.nextUrl.searchParams.get('tenantId');

    await authorizeRequest(authHeader, tenantId, 'pujas.read');

    const slots = await listSlotsForPuja(tenantId!, id);
    return NextResponse.json({ success: true, data: slots });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
