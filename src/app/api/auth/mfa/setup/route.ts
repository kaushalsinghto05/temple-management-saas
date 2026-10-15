import { NextRequest, NextResponse } from 'next/server';
import { setupMfa, verifyAndEnableMfa } from '@/modules/auth/auth-service';
import { authenticateHeader } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const { user } = await authenticateHeader(authHeader);

    const mfa = await setupMfa(user.id);
    return NextResponse.json({
      success: true,
      data: {
        secret: mfa.secret,
        uri: mfa.uri,
      },
    });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
