import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogs } from '@/modules/audit/audit-service';
import { getUserContextFromAuth } from '@/core/tenant/request-context';
import { enforcePermission } from '@/core/rbac/guard';
import { handleApiError } from '@/core/errors/handler';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = req.headers.get('x-tenant-id') || searchParams.get('tenantId');

    const authHeader = req.headers.get('authorization') || req.cookies.get('session_token')?.value;
    const userContext = await getUserContextFromAuth(authHeader);

    // Enforce audit.read permission (FR-AUD-001)
    enforcePermission(userContext, tenantId, 'audit.read');

    const logs = await getAuditLogs({
      tenantId: tenantId || undefined,
      resourceType: searchParams.get('resourceType') || undefined,
      resourceId: searchParams.get('resourceId') || undefined,
      action: searchParams.get('action') || undefined,
      actorId: searchParams.get('actorId') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined,
    });

    return NextResponse.json({ success: true, data: logs });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
