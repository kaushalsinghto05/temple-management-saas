import { NextRequest, NextResponse } from 'next/server';
import { authenticateHeader } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const { user, memberships } = await authenticateHeader(authHeader);

    return NextResponse.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        isPlatformAdmin: user.isPlatformAdmin,
        mfaEnabled: user.mfaEnabled,
        memberships: memberships.map((m) => ({
          id: m.id,
          tenantId: m.tenantId,
          role: m.role,
          assignedTempleId: m.assignedTempleId,
          status: m.status,
        })),
      },
    });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
