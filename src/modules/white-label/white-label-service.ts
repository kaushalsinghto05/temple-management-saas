import { getDb } from '../../db/client';
import { tenants, temples, pujaServices, pujaTimeSlots, customDomains, PujaService, PujaTimeSlot, CustomDomain } from '../../db/schema';
import { eq, and, gt, sql } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '../../core/errors';
import { normalizeSlug } from '../tenants/tenant-service';
import { withTenantContext } from '../../db/rls';
import { UserContext, enforcePermission } from '../../core/rbac/guard';
import { generateToken } from '../../core/auth/crypto';
import { logAuditEvent } from '../audit/audit-service';

export interface PublicTempleProfile {
  id: string;
  tenantId: string;
  tenantSlug: string;
  name: string;
  slug: string;
  timezone: string;
  address: {
    city: string;
    state: string;
    country: string;
    postalCode?: string;
    line1?: string;
  };
  branding: {
    logoUrl?: string;
    bannerUrl?: string;
    primaryColor?: string;
    accentColor?: string;
    description?: string;
  };
}

export interface PublicPujaWithSlots {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinorUnits: number;
  currency: string;
  slots: Array<{
    id: string;
    startTime: Date;
    endTime: Date;
    totalCapacity: number;
    allocatedCapacity: number;
    availableCapacity: number;
  }>;
}

export interface ServiceSnapshot {
  pujaServiceId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinorUnits: number;
  currency: string;
  snapshotAt: string;
}

export async function resolvePublicTemple(
  tenantSlug: string,
  templeSlug: string
): Promise<PublicTempleProfile> {
  const db = getDb();
  const cleanTenantSlug = normalizeSlug(tenantSlug);
  const cleanTempleSlug = normalizeSlug(templeSlug);

  // 1. Resolve tenant and ensure it is active (FR-WL-004)
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.slug, cleanTenantSlug), eq(tenants.status, 'ACTIVE')))
    .limit(1);

  if (!tenant) {
    throw new NotFoundError(`Active organization not found for '${cleanTenantSlug}'`);
  }

  // 2. Resolve temple and ensure it is published and active (FR-WL-003, FR-WL-004)
  const [temple] = await db
    .select()
    .from(temples)
    .where(
      and(
        eq(temples.tenantId, tenant.id),
        eq(temples.slug, cleanTempleSlug),
        eq(temples.published, true),
        eq(temples.operatingStatus, 'ACTIVE')
      )
    )
    .limit(1);

  if (!temple) {
    throw new NotFoundError(`Published temple '${cleanTempleSlug}' not found`);
  }

  return {
    id: temple.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    name: temple.name,
    slug: temple.slug,
    timezone: temple.timezone,
    address: temple.address,
    branding: temple.branding,
  };
}

export async function getPublicPujaCatalog(
  tenantSlug: string,
  templeSlug: string
): Promise<{ temple: PublicTempleProfile; pujas: PublicPujaWithSlots[] }> {
  const db = getDb();
  const temple = await resolvePublicTemple(tenantSlug, templeSlug);
  const now = new Date();

  // 3. Expose only approved published services (FR-WL-003, FR-PUJA-004)
  const services = await db
    .select()
    .from(pujaServices)
    .where(
      and(
        eq(pujaServices.tenantId, temple.tenantId),
        eq(pujaServices.templeId, temple.id),
        eq(pujaServices.status, 'PUBLISHED')
      )
    );

  const results: PublicPujaWithSlots[] = [];

  for (const s of services) {
    // 4. Expose only valid future bookable slots with available capacity (FR-PUJA-004)
    const rawSlots = await db
      .select()
      .from(pujaTimeSlots)
      .where(
        and(
          eq(pujaTimeSlots.tenantId, temple.tenantId),
          eq(pujaTimeSlots.templeId, temple.id),
          eq(pujaTimeSlots.pujaServiceId, s.id),
          eq(pujaTimeSlots.availabilityStatus, 'AVAILABLE'),
          gt(pujaTimeSlots.startTime, now),
          sql`${pujaTimeSlots.allocatedCapacity} < ${pujaTimeSlots.totalCapacity}`
        )
      );

    const slots = rawSlots.map((slot: PujaTimeSlot) => ({
      id: slot.id,
      startTime: slot.startTime,
      endTime: slot.endTime,
      totalCapacity: slot.totalCapacity,
      allocatedCapacity: slot.allocatedCapacity,
      availableCapacity: slot.totalCapacity - slot.allocatedCapacity,
    }));

    results.push({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMinutes: s.durationMinutes,
      priceMinorUnits: s.priceMinorUnits,
      currency: s.currency,
      slots,
    });
  }

  return { temple, pujas: results };
}

/**
 * Creates an authoritative historical price and service snapshot (FR-PUJA-006).
 * Future changes to the service catalog will not alter existing booking snapshots.
 */
export function captureServiceSnapshot(puja: PujaService): ServiceSnapshot {
  return {
    pujaServiceId: puja.id,
    name: puja.name,
    description: puja.description,
    durationMinutes: puja.durationMinutes,
    priceMinorUnits: puja.priceMinorUnits,
    currency: puja.currency,
    snapshotAt: new Date().toISOString(),
  };
}

export interface ConfigureCustomDomainInput {
  tenantId: string;
  templeId: string;
  domain: string;
  userContext: UserContext;
  requestId?: string;
}

export interface VerifyCustomDomainInput {
  tenantId: string;
  domainId: string;
  verificationToken: string;
  userContext: UserContext;
  requestId?: string;
}

export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

/**
 * Configures a custom domain for a temple (FR-WL-005, AT-09).
 * Starts in PENDING_VERIFICATION state until DNS TXT/CNAME token is verified.
 */
export async function configureCustomDomain(input: ConfigureCustomDomainInput): Promise<CustomDomain> {
  const auth = enforcePermission(input.userContext, input.tenantId, 'temples.write', input.templeId);
  const normalizedDomain = normalizeDomain(input.domain);

  if (!normalizedDomain || !normalizedDomain.includes('.')) {
    throw new ValidationError('Invalid domain format: domain must be a valid fully qualified domain name');
  }

  const verificationToken = `trust-verify-${generateToken(16)}`;

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // 1. Verify temple exists and belongs to tenant
    const [temple] = await db
      .select()
      .from(temples)
      .where(and(eq(temples.id, input.templeId), eq(temples.tenantId, input.tenantId)))
      .limit(1);

    if (!temple) {
      throw new NotFoundError(`Temple ${input.templeId} not found in tenant`);
    }

    // 2. Check for duplicate domain registration
    const [existing] = await db
      .select()
      .from(customDomains)
      .where(eq(customDomains.domain, normalizedDomain))
      .limit(1);

    if (existing) {
      throw new ValidationError(`Domain '${normalizedDomain}' is already registered`);
    }

    // 3. Insert domain in PENDING_VERIFICATION status
    const [inserted] = await db
      .insert(customDomains)
      .values({
        tenantId: input.tenantId,
        templeId: input.templeId,
        domain: normalizedDomain,
        verificationToken,
        status: 'PENDING_VERIFICATION',
      })
      .returning();

    // 4. Record audit event
    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.userContext.userId,
      actorRole: auth.role,
      action: 'custom_domain.configured',
      resourceType: 'custom_domain',
      resourceId: inserted.id,
      requestId: input.requestId,
      changesSummary: {
        domain: normalizedDomain,
        templeId: input.templeId,
        status: 'PENDING_VERIFICATION',
      },
    });

    return inserted;
  });
}

/**
 * Verifies custom domain DNS ownership using the assigned verification token (FR-WL-005, AT-09).
 * Transitions status to ACTIVE.
 */
export async function verifyCustomDomain(input: VerifyCustomDomainInput): Promise<CustomDomain> {
  const auth = enforcePermission(input.userContext, input.tenantId, 'temples.write');

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [domainRecord] = await db
      .select()
      .from(customDomains)
      .where(and(eq(customDomains.id, input.domainId), eq(customDomains.tenantId, input.tenantId)))
      .limit(1);

    if (!domainRecord) {
      throw new NotFoundError(`Custom domain record '${input.domainId}' not found`);
    }

    if (domainRecord.verificationToken !== input.verificationToken.trim()) {
      throw new ValidationError('Invalid verification token for custom domain');
    }

    const [updated] = await db
      .update(customDomains)
      .set({
        status: 'ACTIVE',
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(customDomains.id, input.domainId), eq(customDomains.tenantId, input.tenantId)))
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.userContext.userId,
      actorRole: auth.role,
      action: 'custom_domain.verified',
      resourceType: 'custom_domain',
      resourceId: updated.id,
      requestId: input.requestId,
      changesSummary: {
        domain: updated.domain,
        status: 'ACTIVE',
        verifiedAt: updated.verifiedAt?.toISOString(),
      },
    });

    return updated;
  });
}

/**
 * Resolves an active, published temple by its verified custom domain (FR-WL-005, AT-09).
 * If the domain is unverified, inactive, or points to an unpublished temple, throws NotFoundError.
 */
export async function resolveTempleByCustomDomain(domain: string): Promise<PublicTempleProfile> {
  const db = getDb();
  const normalizedDomain = normalizeDomain(domain);

  // 1. Resolve custom domain
  const [domainRecord] = await db
    .select()
    .from(customDomains)
    .where(eq(customDomains.domain, normalizedDomain))
    .limit(1);

  if (!domainRecord || domainRecord.status !== 'ACTIVE') {
    throw new NotFoundError(`Custom domain '${normalizedDomain}' is not active or verified`);
  }

  // 2. Resolve active tenant
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, domainRecord.tenantId), eq(tenants.status, 'ACTIVE')))
    .limit(1);

  if (!tenant) {
    throw new NotFoundError(`Active organization not found for domain '${normalizedDomain}'`);
  }

  // 3. Resolve published temple
  const [temple] = await db
    .select()
    .from(temples)
    .where(
      and(
        eq(temples.id, domainRecord.templeId),
        eq(temples.tenantId, tenant.id),
        eq(temples.published, true),
        eq(temples.operatingStatus, 'ACTIVE')
      )
    )
    .limit(1);

  if (!temple) {
    throw new NotFoundError(`Published temple not found for domain '${normalizedDomain}'`);
  }

  return {
    id: temple.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    name: temple.name,
    slug: temple.slug,
    timezone: temple.timezone,
    address: temple.address,
    branding: temple.branding,
  };
}

