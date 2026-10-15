import { temples, Temple, TempleAddress, TempleBranding } from '../../db/schema/temples';
import { withTenantContext } from '../../db/rls';
import { eq, and } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError, TenantMismatchError } from '../../core/errors';
import { normalizeSlug } from '../tenants/tenant-service';
import { logAuditEvent } from '../audit/audit-service';

export interface CreateTempleInput {
  tenantId: string;
  name: string;
  slug: string;
  timezone?: string;
  address: TempleAddress;
  contactEmail?: string;
  contactPhone?: string;
  branding?: TempleBranding;
  operatingStatus?: string;
  published?: boolean;
  actorUserId: string;
  actorRole: string;
}

export interface UpdateTempleInput {
  tenantId: string;
  templeId: string;
  name?: string;
  timezone?: string;
  address?: Partial<TempleAddress>;
  contactEmail?: string;
  contactPhone?: string;
  branding?: Partial<TempleBranding>;
  operatingStatus?: string;
  published?: boolean;
  actorUserId: string;
  actorRole: string;
}

export async function createTemple(input: CreateTempleInput): Promise<Temple> {
  const cleanSlug = normalizeSlug(input.slug);

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // Check if slug exists in this tenant (FR-TEN-005)
    const [existing] = await db
      .select()
      .from(temples)
      .where(and(eq(temples.tenantId, input.tenantId), eq(temples.slug, cleanSlug)))
      .limit(1);

    if (existing) {
      throw new ConflictError(`Temple slug '${cleanSlug}' already exists in this tenant`);
    }

    const [created] = await db
      .insert(temples)
      .values({
        tenantId: input.tenantId,
        name: input.name.trim(),
        slug: cleanSlug,
        timezone: input.timezone || 'Asia/Kolkata',
        address: input.address,
        contactEmail: input.contactEmail || null,
        contactPhone: input.contactPhone || null,
        branding: input.branding || {},
        operatingStatus: input.operatingStatus || 'ACTIVE',
        published: !!input.published,
      })
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'temple.created',
      resourceType: 'temple',
      resourceId: created.id,
      changesSummary: { name: created.name, slug: created.slug },
    });

    return created;
  });
}

export async function getTempleById(tenantId: string, templeId: string): Promise<Temple> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [temple] = await db
      .select()
      .from(temples)
      .where(and(eq(temples.id, templeId), eq(temples.tenantId, tenantId)))
      .limit(1);

    if (!temple) {
      throw new NotFoundError(`Temple not found in tenant scope`);
    }

    return temple;
  });
}

export async function listTemplesByTenant(tenantId: string): Promise<Temple[]> {
  return await withTenantContext(tenantId, async ({ db }) => {
    return await db.select().from(temples).where(eq(temples.tenantId, tenantId));
  });
}

export async function updateTemple(input: UpdateTempleInput): Promise<Temple> {
  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [existing] = await db
      .select()
      .from(temples)
      .where(and(eq(temples.id, input.templeId), eq(temples.tenantId, input.tenantId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundError('Temple not found in tenant scope');
    }

    const updatedAddress = input.address
      ? { ...existing.address, ...input.address }
      : existing.address;

    const updatedBranding = input.branding
      ? { ...existing.branding, ...input.branding }
      : existing.branding;

    const [updated] = await db
      .update(temples)
      .set({
        name: input.name?.trim() ?? existing.name,
        timezone: input.timezone ?? existing.timezone,
        address: updatedAddress,
        contactEmail: input.contactEmail ?? existing.contactEmail,
        contactPhone: input.contactPhone ?? existing.contactPhone,
        branding: updatedBranding,
        operatingStatus: input.operatingStatus ?? existing.operatingStatus,
        published: input.published ?? existing.published,
        updatedAt: new Date(),
      })
      .where(and(eq(temples.id, input.templeId), eq(temples.tenantId, input.tenantId)))
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'temple.updated',
      resourceType: 'temple',
      resourceId: updated.id,
      changesSummary: {
        fieldsUpdated: Object.keys(input).filter((k) => !['tenantId', 'templeId', 'actorUserId', 'actorRole'].includes(k)),
      },
    });

    return updated;
  });
}
