import { NextRequest, NextResponse } from 'next/server';
import { getPublicPujaCatalog } from '@/modules/white-label/white-label-service';
import { handleApiError } from '@/core/errors/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; templeSlug: string }> }
) {
  try {
    const { tenantSlug, templeSlug } = await params;
    const catalog = await getPublicPujaCatalog(tenantSlug, templeSlug);

    return NextResponse.json({
      success: true,
      data: catalog,
    });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
