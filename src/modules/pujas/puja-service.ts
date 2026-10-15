import { pujaServices, pujaTimeSlots, PujaService, PujaTimeSlot, temples } from '../../db/schema';
import { withTenantContext } from '../../db/rls';
import { eq, and, gte, lte } from 'drizzle-orm';
import { NotFoundError, ValidationError, ConflictError } from '../../core/errors';
import { logAuditEvent } from '../audit/audit-service';

export interface CreatePujaInput {
  tenantId: string;
  templeId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  priceMinorUnits: number;
  currency?: string;
  actorUserId: string;
  actorRole: string;
}

export interface UpdatePujaInput {
  tenantId: string;
  pujaId: string;
  name?: string;
  description?: string;
  durationMinutes?: number;
  priceMinorUnits?: number;
  currency?: string;
  actorUserId: string;
  actorRole: string;
}

export interface CreateSlotInput {
  tenantId: string;
  templeId: string;
  pujaServiceId: string;
  startTime: Date;
  endTime: Date;
  totalCapacity: number;
  actorUserId: string;
  actorRole: string;
}

export async function createPujaService(input: CreatePujaInput): Promise<PujaService> {
  if (input.durationMinutes <= 0) {
    throw new ValidationError('Duration must be greater than 0 minutes');
  }
  if (input.priceMinorUnits < 0) {
    throw new ValidationError('Price cannot be negative');
  }

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // Validate temple belongs to this tenant (FR-PUJA-005)
    const [temple] = await db
      .select()
      .from(temples)
      .where(and(eq(temples.id, input.templeId), eq(temples.tenantId, input.tenantId)))
      .limit(1);

    if (!temple) {
      throw new NotFoundError('Target temple does not exist in this tenant');
    }

    const [created] = await db
      .insert(pujaServices)
      .values({
        tenantId: input.tenantId,
        templeId: input.templeId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        durationMinutes: input.durationMinutes,
        priceMinorUnits: input.priceMinorUnits,
        currency: input.currency?.toUpperCase() || 'INR',
        status: 'DRAFT',
      })
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'puja.created',
      resourceType: 'puja_service',
      resourceId: created.id,
      changesSummary: { name: created.name, priceMinorUnits: created.priceMinorUnits },
    });

    return created;
  });
}

export async function updatePujaService(input: UpdatePujaInput): Promise<PujaService> {
  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [existing] = await db
      .select()
      .from(pujaServices)
      .where(and(eq(pujaServices.id, input.pujaId), eq(pujaServices.tenantId, input.tenantId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundError('Puja service not found in this tenant');
    }

    if (input.durationMinutes !== undefined && input.durationMinutes <= 0) {
      throw new ValidationError('Duration must be greater than 0 minutes');
    }
    if (input.priceMinorUnits !== undefined && input.priceMinorUnits < 0) {
      throw new ValidationError('Price cannot be negative');
    }

    const [updated] = await db
      .update(pujaServices)
      .set({
        name: input.name?.trim() ?? existing.name,
        description: input.description !== undefined ? input.description?.trim() : existing.description,
        durationMinutes: input.durationMinutes ?? existing.durationMinutes,
        priceMinorUnits: input.priceMinorUnits ?? existing.priceMinorUnits,
        currency: input.currency?.toUpperCase() ?? existing.currency,
        updatedAt: new Date(),
      })
      .where(and(eq(pujaServices.id, input.pujaId), eq(pujaServices.tenantId, input.tenantId)))
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'puja.updated',
      resourceType: 'puja_service',
      resourceId: updated.id,
      changesSummary: {
        previousPrice: existing.priceMinorUnits,
        newPrice: updated.priceMinorUnits,
      },
    });

    return updated;
  });
}

export async function setPujaStatus(
  tenantId: string,
  pujaId: string,
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
  actorUserId: string,
  actorRole: string
): Promise<PujaService> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [existing] = await db
      .select()
      .from(pujaServices)
      .where(and(eq(pujaServices.id, pujaId), eq(pujaServices.tenantId, tenantId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundError('Puja service not found in this tenant');
    }

    const [updated] = await db
      .update(pujaServices)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(and(eq(pujaServices.id, pujaId), eq(pujaServices.tenantId, tenantId)))
      .returning();

    await logAuditEvent({
      tenantId,
      actorId: actorUserId,
      actorRole,
      action: `puja.${status.toLowerCase()}`,
      resourceType: 'puja_service',
      resourceId: updated.id,
      changesSummary: { previousStatus: existing.status, newStatus: status },
    });

    return updated;
  });
}

export async function getPujaServiceById(tenantId: string, pujaId: string): Promise<PujaService> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [puja] = await db
      .select()
      .from(pujaServices)
      .where(and(eq(pujaServices.id, pujaId), eq(pujaServices.tenantId, tenantId)))
      .limit(1);

    if (!puja) {
      throw new NotFoundError('Puja service not found in this tenant');
    }

    return puja;
  });
}

export async function listPujaServices(
  tenantId: string,
  templeId: string,
  statusFilter?: string
): Promise<PujaService[]> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const conditions = [eq(pujaServices.tenantId, tenantId), eq(pujaServices.templeId, templeId)];
    if (statusFilter) {
      conditions.push(eq(pujaServices.status, statusFilter));
    }
    return await db.select().from(pujaServices).where(and(...conditions));
  });
}

// ----------------- TIME SLOTS -----------------

export async function createPujaTimeSlot(input: CreateSlotInput): Promise<PujaTimeSlot> {
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);

  if (end <= start) {
    throw new ValidationError('Slot end time must be after start time');
  }
  if (input.totalCapacity <= 0) {
    throw new ValidationError('Slot total capacity must be greater than 0');
  }

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // Validate puja service and temple relationship (FR-PUJA-005)
    const [puja] = await db
      .select()
      .from(pujaServices)
      .where(
        and(
          eq(pujaServices.id, input.pujaServiceId),
          eq(pujaServices.templeId, input.templeId),
          eq(pujaServices.tenantId, input.tenantId)
        )
      )
      .limit(1);

    if (!puja) {
      throw new NotFoundError('Puja service does not exist in this temple/tenant scope');
    }

    const [slot] = await db
      .insert(pujaTimeSlots)
      .values({
        tenantId: input.tenantId,
        templeId: input.templeId,
        pujaServiceId: input.pujaServiceId,
        startTime: start,
        endTime: end,
        totalCapacity: input.totalCapacity,
        allocatedCapacity: 0,
        availabilityStatus: 'AVAILABLE',
      })
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'puja_slot.created',
      resourceType: 'puja_time_slot',
      resourceId: slot.id,
      changesSummary: {
        startTime: slot.startTime,
        totalCapacity: slot.totalCapacity,
      },
    });

    return slot;
  });
}

export async function listSlotsForPuja(
  tenantId: string,
  pujaServiceId: string,
  options?: { fromTime?: Date; toTime?: Date; availableOnly?: boolean }
): Promise<PujaTimeSlot[]> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const conditions = [
      eq(pujaTimeSlots.tenantId, tenantId),
      eq(pujaTimeSlots.pujaServiceId, pujaServiceId),
    ];

    if (options?.fromTime) {
      conditions.push(gte(pujaTimeSlots.startTime, options.fromTime));
    }
    if (options?.toTime) {
      conditions.push(lte(pujaTimeSlots.endTime, options.toTime));
    }
    if (options?.availableOnly) {
      conditions.push(eq(pujaTimeSlots.availabilityStatus, 'AVAILABLE'));
    }

    return await db.select().from(pujaTimeSlots).where(and(...conditions));
  });
}

export async function getSlotById(tenantId: string, slotId: string): Promise<PujaTimeSlot> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [slot] = await db
      .select()
      .from(pujaTimeSlots)
      .where(and(eq(pujaTimeSlots.id, slotId), eq(pujaTimeSlots.tenantId, tenantId)))
      .limit(1);

    if (!slot) {
      throw new NotFoundError('Puja time slot not found in this tenant');
    }

    return slot;
  });
}
