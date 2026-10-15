import { NextRequest, NextResponse } from 'next/server';
import { resolvePublicTemple } from '@/modules/white-label/white-label-service';
import { handleApiError } from '@/core/errors/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; templeSlug: string }> }
) {
  try {
    const { tenantSlug, templeSlug } = await params;
    const profile = await resolvePublicTemple(tenantSlug, templeSlug);

    return NextResponse.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
