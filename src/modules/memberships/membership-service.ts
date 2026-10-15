import { tenantMemberships, TenantMembership, users } from '../../db/schema';
import { withTenantContext } from '../../db/rls';
import { eq, and } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors';
import { Role } from '../../core/rbac/permissions';
import { logAuditEvent } from '../audit/audit-service';

export interface InviteMemberInput {
  tenantId: string;
  email: string;
  role: Role;
  assignedTempleId?: string;
  invitedByUserId: string;
  actorRole: string;
}

export interface UpdateMemberRoleInput {
  tenantId: string;
  membershipId: string;
  newRole: Role;
  assignedTempleId?: string;
  actorUserId: string;
  actorRole: string;
}

export interface RevokeMemberInput {
  tenantId: string;
  membershipId: string;
  actorUserId: string;
  actorRole: string;
}

const FORBIDDEN_INVITE_ROLES: Role[] = [
  'PLATFORM_SUPER_ADMIN',
  'PLATFORM_SUPPORT',
  'PLATFORM_FINANCE',
];

export async function inviteMember(input: InviteMemberInput): Promise<TenantMembership> {
  if (FORBIDDEN_INVITE_ROLES.includes(input.role)) {
    throw new ForbiddenError('Cannot assign platform-level roles via tenant invitations');
  }

  const emailClean = input.email.toLowerCase().trim();

  return await withTenantContext(input.tenantId, async ({ db }) => {
    // Check if user already exists
    let [targetUser] = await db.select().from(users).where(eq(users.email, emailClean)).limit(1);

    if (!targetUser) {
      // Auto-create invited user record
      [targetUser] = await db
        .insert(users)
        .values({
          email: emailClean,
          fullName: emailClean.split('@')[0],
          isPlatformAdmin: false,
        })
        .returning();
    }

    // Check if already a member with same role and scope
    const [existing] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, input.tenantId),
          eq(tenantMemberships.userId, targetUser.id),
          eq(tenantMemberships.role, input.role)
        )
      )
      .limit(1);

    if (existing) {
      if (existing.status === 'ACTIVE') {
        throw new ConflictError(`User is already an active member with role ${input.role}`);
      }
      // Re-activate if was revoked
      const [reactivated] = await db
        .update(tenantMemberships)
        .set({
          status: 'ACTIVE',
          assignedTempleId: input.assignedTempleId || null,
          updatedAt: new Date(),
        })
        .where(eq(tenantMemberships.id, existing.id))
        .returning();

      await logAuditEvent({
        tenantId: input.tenantId,
        actorId: input.invitedByUserId,
        actorRole: input.actorRole,
        action: 'member.reactivated',
        resourceType: 'membership',
        resourceId: reactivated.id,
        changesSummary: { role: input.role, userEmail: emailClean },
      });

      return reactivated;
    }

    const [created] = await db
      .insert(tenantMemberships)
      .values({
        tenantId: input.tenantId,
        userId: targetUser.id,
        role: input.role,
        assignedTempleId: input.assignedTempleId || null,
        status: 'ACTIVE',
        invitedByUserId: input.invitedByUserId,
      })
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.invitedByUserId,
      actorRole: input.actorRole,
      action: 'member.invited',
      resourceType: 'membership',
      resourceId: created.id,
      changesSummary: { role: input.role, userEmail: emailClean },
    });

    return created;
  });
}

export async function updateMemberRole(input: UpdateMemberRoleInput): Promise<TenantMembership> {
  if (FORBIDDEN_INVITE_ROLES.includes(input.newRole)) {
    throw new ForbiddenError('Cannot elevate tenant member to platform role');
  }

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [existing] = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.id, input.membershipId), eq(tenantMemberships.tenantId, input.tenantId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundError('Membership not found in tenant');
    }

    const [updated] = await db
      .update(tenantMemberships)
      .set({
        role: input.newRole,
        assignedTempleId: input.assignedTempleId || null,
        updatedAt: new Date(),
      })
      .where(and(eq(tenantMemberships.id, input.membershipId), eq(tenantMemberships.tenantId, input.tenantId)))
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'member.role_changed',
      resourceType: 'membership',
      resourceId: updated.id,
      changesSummary: { oldRole: existing.role, newRole: input.newRole },
    });

    return updated;
  });
}

export async function revokeMember(input: RevokeMemberInput): Promise<TenantMembership> {
  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [existing] = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.id, input.membershipId), eq(tenantMemberships.tenantId, input.tenantId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundError('Membership not found in tenant');
    }

    const [revoked] = await db
      .update(tenantMemberships)
      .set({
        status: 'REVOKED',
        updatedAt: new Date(),
      })
      .where(and(eq(tenantMemberships.id, input.membershipId), eq(tenantMemberships.tenantId, input.tenantId)))
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'member.revoked',
      resourceType: 'membership',
      resourceId: revoked.id,
      changesSummary: { role: existing.role },
    });

    return revoked;
  });
}

export async function listMembersByTenant(tenantId: string): Promise<TenantMembership[]> {
  return await withTenantContext(tenantId, async ({ db }) => {
    return await db.select().from(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId));
  });
}
