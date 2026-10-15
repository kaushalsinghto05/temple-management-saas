import { NextRequest, NextResponse } from 'next/server';
import { releaseExpiredReservations } from '@/modules/bookings/booking-service';
import { listTenants } from '@/modules/tenants/tenant-service';
import { handleApiError } from '@/core/errors/handler';

export async function POST(req: NextRequest) {
  try {
    const tenantsList = await listTenants();
    let totalReleased = 0;

    for (const t of tenantsList) {
      if (t.status === 'ACTIVE') {
        const released = await releaseExpiredReservations(t.id);
        totalReleased += released;
      }
    }

    return NextResponse.json({
      success: true,
      releasedCount: totalReleased,
    });
  } catch (error) {
    const { status, body } = handleApiError(error);
    return NextResponse.json(body, { status });
  }
}
