import { getDb } from '../../db/client';
import { tenants, Tenant, NewTenant } from '../../db/schema/tenants';
import { eq } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';
import { logAuditEvent } from '../audit/audit-service';

export function normalizeSlug(slug: string): string {
  const normalized = slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalized || normalized.length < 3) {
    throw new ValidationError('Slug must be at least 3 alphanumeric characters');
  }
  return normalized;
}

export async function createTenant(input: {
  name: string;
  slug: string;
  actorUserId: string;
}): Promise<Tenant> {
  const db = getDb();
  const cleanSlug = normalizeSlug(input.slug);

  const [existing] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, cleanSlug))
    .limit(1);

  if (existing) {
    throw new ConflictError(`Tenant slug '${cleanSlug}' is already taken`);
  }

  const [created] = await db
    .insert(tenants)
    .values({
      name: input.name.trim(),
      slug: cleanSlug,
      status: 'ACTIVE',
    })
    .returning();

  await logAuditEvent({
    tenantId: created.id,
    actorId: input.actorUserId,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    action: 'tenant.created',
    resourceType: 'tenant',
    resourceId: created.id,
    changesSummary: { name: created.name, slug: created.slug },
  });

  return created;
}

export async function updateTenantStatus(input: {
  tenantId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ONBOARDING';
  actorUserId: string;
}): Promise<Tenant> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const [updated] = await db
    .update(tenants)
    .set({
      status: input.status,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, input.tenantId))
    .returning();

  await logAuditEvent({
    tenantId: updated.id,
    actorId: input.actorUserId,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    action: `tenant.${input.status.toLowerCase()}`,
    resourceType: 'tenant',
    resourceId: updated.id,
    changesSummary: { previousStatus: tenant.status, newStatus: input.status },
  });

  return updated;
}

export async function getTenantById(tenantId: string): Promise<Tenant> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }
  return tenant;
}

export async function getTenantBySlug(slug: string): Promise<Tenant> {
  const db = getDb();
  const cleanSlug = normalizeSlug(slug);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, cleanSlug)).limit(1);
  if (!tenant) {
    throw new NotFoundError(`Tenant with slug '${cleanSlug}' not found`);
  }
  return tenant;
}

export async function listTenants(): Promise<Tenant[]> {
  const db = getDb();
  return await db.select().from(tenants);
}
