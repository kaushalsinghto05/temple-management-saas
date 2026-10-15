import { NextRequest, NextResponse } from 'next/server';
import { getPlatformOverview } from '@/modules/operations/operations-service';
import { getUserContextFromAuth } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const userContext = await getUserContextFromAuth(authHeader);

    const data = await getPlatformOverview(userContext);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
