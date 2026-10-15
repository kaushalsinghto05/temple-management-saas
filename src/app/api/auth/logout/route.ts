import { NextRequest, NextResponse } from 'next/server';
import { revokeSession } from '@/modules/auth/auth-service';
import { authenticateHeader } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const { session, user } = await authenticateHeader(authHeader);

    await revokeSession(session.id, user.id);

    const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
    response.cookies.delete('session_token');
    return response;
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
