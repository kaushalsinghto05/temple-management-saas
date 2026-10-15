import { NextRequest, NextResponse } from 'next/server';
import { resolveTempleByCustomDomain } from '@/modules/white-label/white-label-service';
import { handleApiError } from '@/core/errors/handler';

export async function GET(req: NextRequest) {
  try {
    const domain = req.nextUrl.searchParams.get('domain');
    if (!domain) {
      return NextResponse.json({ success: false, error: 'Domain query parameter is required' }, { status: 400 });
    }

    const temple = await resolveTempleByCustomDomain(domain);
    return NextResponse.json({ success: true, data: temple });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
