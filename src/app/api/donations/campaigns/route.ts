import { NextRequest, NextResponse } from 'next/server';
import { createDonationCampaign, getCampaigns } from '@/modules/donations/donation-service';
import { getUserContextFromAuth } from '@/core/tenant/request-context';
import { handleApiError } from '@/core/errors/handler';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');
    const templeId = searchParams.get('templeId');

    if (!tenantId || !templeId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'tenantId and templeId are required query parameters' } },
        { status: 400 }
      );
    }

    const campaigns = await getCampaigns(tenantId, templeId);
    return NextResponse.json({ success: true, data: campaigns });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const userContext = await getUserContextFromAuth(authHeader);
    const body = await req.json();

    const campaign = await createDonationCampaign(userContext, {
      tenantId: body.tenantId,
      templeId: body.templeId,
      name: body.name,
      purpose: body.purpose,
      recipientLegalEntity: body.recipientLegalEntity,
      suggestedAmountsMinorUnits: body.suggestedAmountsMinorUnits,
      minAmountMinorUnits: body.minAmountMinorUnits,
      maxAmountMinorUnits: body.maxAmountMinorUnits,
      taxExemptionEligible: body.taxExemptionEligible,
      taxExemptionSection: body.taxExemptionSection,
    });

    return NextResponse.json({ success: true, data: campaign }, { status: 201 });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
