import { User, TenantMembership } from '../../db/schema';
import { Role, Permission, hasPermission, ROLE_PERMISSIONS } from './permissions';
import { ForbiddenError, AuthenticationError } from '../errors';

export interface UserContext {
  userId: string;
  isPlatformAdmin: boolean;
  memberships: TenantMembership[];
}

export interface AuthorizationResult {
  role: Role;
  membership: TenantMembership | null;
}

/**
 * Enforces server-side authorization:
 * 1. Checks platform privileges if applicable.
 * 2. Resolves membership strictly from server-validated records, ignoring any client-provided role claim (FR-RBAC-002).
 * 3. Enforces that the user belongs to the requested tenant (FR-RBAC-004, AT-01).
 * 4. Checks temple branch assignment if the role is temple-scoped.
 * 5. Validates granular permission requirements (FR-RBAC-003).
 */
export function enforcePermission(
  context: UserContext,
  tenantId: string | null,
  requiredPermission: Permission,
  targetTempleId?: string
): AuthorizationResult {
  if (!context || !context.userId) {
    throw new AuthenticationError('Unauthenticated request');
  }

  // Handle platform-level permissions
  if (context.isPlatformAdmin) {
    const platformPerms = ROLE_PERMISSIONS['PLATFORM_SUPER_ADMIN'];
    if (platformPerms.includes(requiredPermission)) {
      return {
        role: 'PLATFORM_SUPER_ADMIN',
        membership: null,
      };
    }
  }

  // Tenant-scoped permissions require a valid tenantId
  if (!tenantId) {
    throw new ForbiddenError('Tenant context required for this operation');
  }

  // Find validated membership in this tenant
  const activeMemberships = context.memberships.filter(
    (m) => m.tenantId === tenantId && m.status === 'ACTIVE'
  );

  if (activeMemberships.length === 0) {
    throw new ForbiddenError('Access denied: user has no authorized membership in this tenant');
  }

  // Check each membership to see if any grants the required permission within temple scope
  for (const membership of activeMemberships) {
    const role = membership.role as Role;

    // Check if role has the permission
    if (hasPermission(role, requiredPermission)) {
      // If role is scoped to a specific temple, check temple match
      if (membership.assignedTempleId && targetTempleId) {
        if (membership.assignedTempleId !== targetTempleId) {
          continue; // Does not match temple scope, try next membership
        }
      }
      return { role, membership };
    }
  }

  throw new ForbiddenError(
    `Access denied: insufficient permissions. Required: '${requiredPermission}'`
  );
}
