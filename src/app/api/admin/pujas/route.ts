import { NextRequest, NextResponse } from 'next/server';
import { createPujaService, listPujaServices } from '@/modules/pujas/puja-service';
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
      'pujas.write',
      body.templeId
    );

    const puja = await createPujaService({
      tenantId,
      templeId: body.templeId,
      name: body.name,
      description: body.description,
      durationMinutes: body.durationMinutes,
      priceMinorUnits: body.priceMinorUnits,
      currency: body.currency,
      actorUserId: userContext.userId,
      actorRole: authResult.role,
    });

    return NextResponse.json({ success: true, data: puja }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const tenantId = req.headers.get('x-tenant-id') || req.nextUrl.searchParams.get('tenantId');
    const templeId = req.nextUrl.searchParams.get('templeId');

    await authorizeRequest(authHeader, tenantId, 'pujas.read', templeId || undefined);

    const pujas = await listPujaServices(tenantId!, templeId!);
    return NextResponse.json({ success: true, data: pujas });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
