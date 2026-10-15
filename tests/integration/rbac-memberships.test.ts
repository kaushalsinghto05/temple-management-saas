import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import { createTenant } from '@/modules/tenants/tenant-service';
import { createTemple } from '@/modules/temples/temple-service';
import { registerUser } from '@/modules/auth/auth-service';
import { inviteMember, updateMemberRole, revokeMember, listMembersByTenant } from '@/modules/memberships/membership-service';
import { enforcePermission } from '@/core/rbac/guard';
import { getAuditLogs } from '@/modules/audit/audit-service';
import { ForbiddenError } from '@/core/errors';

describe('Integration: Memberships & RBAC (FR-RBAC-001 to 005)', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();
  });

  it('FR-RBAC-001 & 002: should invite user, assign validated role, and disallow platform role escalation', async () => {
    const adminUser = await registerUser({
      email: 'trust.admin@shrine.org',
      password: 'AdminPassword123!',
      fullName: 'Trust Chairman',
    });

    const tenant = await createTenant({
      name: 'Shrine Trust',
      slug: 'shrine-trust',
      actorUserId: adminUser.id,
    });

    // Attempt to invite user with PLATFORM_SUPER_ADMIN role -> MUST FAIL (FR-RBAC-002)
    await expect(
      inviteMember({
        tenantId: tenant.id,
        email: 'attacker@evil.com',
        role: 'PLATFORM_SUPER_ADMIN',
        invitedByUserId: adminUser.id,
        actorRole: 'TRUST_ADMIN',
      })
    ).rejects.toThrow(ForbiddenError);

    // Invite user as PUJA_MANAGER
    const membership = await inviteMember({
      tenantId: tenant.id,
      email: 'manager@shrine.org',
      role: 'PUJA_MANAGER',
      invitedByUserId: adminUser.id,
      actorRole: 'TRUST_ADMIN',
    });

    expect(membership.id).toBeDefined();
    expect(membership.role).toBe('PUJA_MANAGER');
    expect(membership.status).toBe('ACTIVE');

    // Verify audit log was created (FR-RBAC-005)
    const logs = await getAuditLogs({ tenantId: tenant.id, resourceType: 'membership' });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].action).toBe('member.invited');
  });

  it('FR-RBAC-003 & 004: should enforce granular permissions and temple scoping', async () => {
    const adminUser = await registerUser({
      email: 'trust.admin2@shrine.org',
      password: 'AdminPassword123!',
      fullName: 'Trust Chairman 2',
    });

    const tenant = await createTenant({
      name: 'Shrine Trust 2',
      slug: 'shrine-trust-2',
      actorUserId: adminUser.id,
    });

    const templeA = await createTemple({
      tenantId: tenant.id,
      name: 'Temple North',
      slug: 'temple-north',
      address: { line1: 'N St', city: 'City', state: 'State', postalCode: '100001', country: 'India' },
      actorUserId: adminUser.id,
      actorRole: 'TRUST_ADMIN',
    });

    const templeB = await createTemple({
      tenantId: tenant.id,
      name: 'Temple South',
      slug: 'temple-south',
      address: { line1: 'S St', city: 'City', state: 'State', postalCode: '100002', country: 'India' },
      actorUserId: adminUser.id,
      actorRole: 'TRUST_ADMIN',
    });

    // Invite priest assigned specifically to Temple North
    const priestMembership = await inviteMember({
      tenantId: tenant.id,
      email: 'priest.north@shrine.org',
      role: 'PRIEST',
      assignedTempleId: templeA.id,
      invitedByUserId: adminUser.id,
      actorRole: 'TRUST_ADMIN',
    });

    const priestContext = {
      userId: priestMembership.userId,
      isPlatformAdmin: false,
      memberships: [priestMembership],
    };

    // Priest has 'bookings.check_in' at Temple North -> allowed
    const authNorth = enforcePermission(priestContext, tenant.id, 'bookings.check_in', templeA.id);
    expect(authNorth.role).toBe('PRIEST');

    // Priest attempts 'bookings.check_in' at Temple South -> denied (temple scope check FR-RBAC-004)
    expect(() =>
      enforcePermission(priestContext, tenant.id, 'bookings.check_in', templeB.id)
    ).toThrow(ForbiddenError);

    // Priest attempts 'reports.finance.read' (lacks permission) -> denied (FR-RBAC-003)
    expect(() =>
      enforcePermission(priestContext, tenant.id, 'reports.finance.read', templeA.id)
    ).toThrow(ForbiddenError);
  });

  it('FR-RBAC-005: should record role changes and revocations in audit trail', async () => {
    const adminUser = await registerUser({
      email: 'trust.admin3@shrine.org',
      password: 'AdminPassword123!',
      fullName: 'Trust Chairman 3',
    });

    const tenant = await createTenant({
      name: 'Shrine Trust 3',
      slug: 'shrine-trust-3',
      actorUserId: adminUser.id,
    });

    const membership = await inviteMember({
      tenantId: tenant.id,
      email: 'staff@shrine.org',
      role: 'PRIEST',
      invitedByUserId: adminUser.id,
      actorRole: 'TRUST_ADMIN',
    });

    // Promote to PUJA_MANAGER
    const updated = await updateMemberRole({
      tenantId: tenant.id,
      membershipId: membership.id,
      newRole: 'PUJA_MANAGER',
      actorUserId: adminUser.id,
      actorRole: 'TRUST_ADMIN',
    });
    expect(updated.role).toBe('PUJA_MANAGER');

    // Revoke member
    const revoked = await revokeMember({
      tenantId: tenant.id,
      membershipId: membership.id,
      actorUserId: adminUser.id,
      actorRole: 'TRUST_ADMIN',
    });
    expect(revoked.status).toBe('REVOKED');

    // Verify audit events
    const logs = await getAuditLogs({ tenantId: tenant.id, resourceType: 'membership' });
    const actions = logs.map((l: any) => l.action);
    expect(actions).toContain('member.invited');
    expect(actions).toContain('member.role_changed');
    expect(actions).toContain('member.revoked');
  });
});
