import { NextRequest, NextResponse } from 'next/server';
import { registerUser } from '@/modules/auth/auth-service';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const user = await registerUser(body);
    return NextResponse.json(
      {
        success: true,
        data: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          fullName: user.fullName,
          isPlatformAdmin: user.isPlatformAdmin,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
