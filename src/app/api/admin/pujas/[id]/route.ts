import { NextRequest, NextResponse } from 'next/server';
import { getPujaServiceById, updatePujaService } from '@/modules/pujas/puja-service';
import { authorizeRequest } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const tenantId = req.headers.get('x-tenant-id') || req.nextUrl.searchParams.get('tenantId');

    await authorizeRequest(authHeader, tenantId, 'pujas.read');

    const puja = await getPujaServiceById(tenantId!, id);
    return NextResponse.json({ success: true, data: puja });
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
    const body = await req.json();
    const tenantId = req.headers.get('x-tenant-id') || body.tenantId;

    const { userContext, authResult } = await authorizeRequest(
      authHeader,
      tenantId,
      'pujas.write'
    );

    const updated = await updatePujaService({
      tenantId: tenantId!,
      pujaId: id,
      name: body.name,
      description: body.description,
      durationMinutes: body.durationMinutes,
      priceMinorUnits: body.priceMinorUnits,
      currency: body.currency,
      actorUserId: userContext.userId,
      actorRole: authResult.role,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
