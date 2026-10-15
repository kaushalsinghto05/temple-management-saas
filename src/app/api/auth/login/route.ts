import { NextRequest, NextResponse } from 'next/server';
import { signIn } from '@/modules/auth/auth-service';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    const { session, user, memberships } = await signIn({
      identifier: body.identifier,
      password: body.password,
      mfaToken: body.mfaToken,
      ipAddress,
      userAgent,
    });

    const response = NextResponse.json(
      {
        success: true,
        data: {
          token: session.token,
          expiresAt: session.expiresAt,
          user: {
            id: user.id,
            email: user.email,
            phone: user.phone,
            fullName: user.fullName,
            isPlatformAdmin: user.isPlatformAdmin,
          },
          memberships,
        },
      },
      { status: 200 }
    );

    // Set secure HTTP-only cookie
    response.cookies.set('session_token', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: new Date(session.expiresAt),
    });

    return response;
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
