import { validateSession, SessionWithUser } from '../../modules/auth/auth-service';
import { AuthenticationError, ForbiddenError } from '../errors';
import { enforcePermission, UserContext, AuthorizationResult } from '../rbac/guard';
import { Permission, Role } from '../rbac/permissions';

export interface AuthenticatedRequest {
  user: UserContext;
  sessionToken: string;
}

export async function authenticateHeader(authHeader?: string | null): Promise<SessionWithUser> {
  if (!authHeader) {
    throw new AuthenticationError('Missing Authorization header');
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  if (!token) {
    throw new AuthenticationError('Invalid bearer token');
  }

  return await validateSession(token);
}

export async function authorizeRequest(
  authHeader: string | null | undefined,
  tenantId: string | null,
  requiredPermission: Permission,
  targetTempleId?: string
): Promise<{ userContext: UserContext; authResult: AuthorizationResult }> {
  const { user, memberships } = await authenticateHeader(authHeader);

  const userContext: UserContext = {
    userId: user.id,
    isPlatformAdmin: user.isPlatformAdmin,
    memberships,
  };

  const authResult = enforcePermission(userContext, tenantId, requiredPermission, targetTempleId);

  return { userContext, authResult };
}

export async function getUserContextFromAuth(
  authHeader?: string | null
): Promise<UserContext> {
  const { user, memberships } = await authenticateHeader(authHeader);
  return {
    userId: user.id,
    isPlatformAdmin: user.isPlatformAdmin,
    memberships,
  };
}
