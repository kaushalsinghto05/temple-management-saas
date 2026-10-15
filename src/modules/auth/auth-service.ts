import { getDb } from '../../db/client';
import { users, sessions, tenantMemberships, User, Session, TenantMembership } from '../../db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { hashPassword, verifyPassword, generateToken, generateUUID } from '../../core/auth/crypto';
import { generateMfaSecret, verifyMfaToken } from '../../core/auth/mfa';
import { authRateLimiter } from '../../core/auth/rate-limiter';
import { AuthenticationError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors';
import { logAuditEvent } from '../audit/audit-service';

export interface RegisterUserInput {
  email?: string;
  phone?: string;
  password?: string;
  fullName: string;
  isPlatformAdmin?: boolean;
}

export interface SignInInput {
  identifier: string; // email or phone
  password?: string;
  mfaToken?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionWithUser {
  session: Session;
  user: User;
  memberships: TenantMembership[];
}

export async function registerUser(input: RegisterUserInput): Promise<User> {
  const db = getDb();
  if (!input.email && !input.phone) {
    throw new ValidationError('Email or phone number is required');
  }

  let passwordHash: string | undefined;
  let salt: string | undefined;

  if (input.password) {
    const hashed = await hashPassword(input.password);
    passwordHash = hashed.hash;
    salt = hashed.salt;
  }

  const [created] = await db
    .insert(users)
    .values({
      email: input.email?.toLowerCase().trim() || null,
      phone: input.phone?.trim() || null,
      passwordHash: passwordHash || null,
      salt: salt || null,
      fullName: input.fullName.trim(),
      isPlatformAdmin: !!input.isPlatformAdmin,
      mfaEnabled: false,
    })
    .returning();

  return created;
}

export async function setupMfa(userId: string): Promise<{ secret: string; uri: string }> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const mfa = generateMfaSecret('TrustTempleSaaS', user.email || user.fullName);
  await db.update(users).set({ mfaSecret: mfa.secret }).where(eq(users.id, userId));

  return mfa;
}

export async function verifyAndEnableMfa(userId: string, token: string): Promise<boolean> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.mfaSecret) {
    throw new ValidationError('MFA secret not initialized');
  }

  const isValid = verifyMfaToken(user.mfaSecret, token);
  if (!isValid) {
    throw new ValidationError('Invalid MFA token');
  }

  await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, userId));
  return true;
}

export async function signIn(input: SignInInput): Promise<SessionWithUser> {
  const rateLimitKey = `${input.ipAddress || 'unknown'}:${input.identifier.toLowerCase().trim()}`;
  authRateLimiter.enforce(rateLimitKey);

  const db = getDb();
  const identifierClean = input.identifier.toLowerCase().trim();

  // Search by email or phone
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, identifierClean))
    .limit(1);

  // Use constant-time dummy verification if user doesn't exist to prevent timing attacks / enumeration
  if (!user || !user.passwordHash || !user.salt) {
    await hashPassword('dummy_constant_time_pass', 'dummy_salt_value');
    throw new AuthenticationError('Invalid credentials');
  }

  if (!input.password) {
    throw new AuthenticationError('Invalid credentials');
  }

  const isPasswordValid = await verifyPassword(input.password, user.passwordHash, user.salt);
  if (!isPasswordValid) {
    throw new AuthenticationError('Invalid credentials');
  }

  // MFA check (mandatory for privileged platform admins or if user enabled MFA) (FR-AUTH-004)
  if (user.isPlatformAdmin || user.mfaEnabled) {
    if (!input.mfaToken) {
      throw new AuthenticationError('MFA verification token required');
    }
    if (!user.mfaSecret) {
      throw new AuthenticationError('MFA configuration error for account');
    }
    const isMfaValid = verifyMfaToken(user.mfaSecret, input.mfaToken);
    if (!isMfaValid) {
      throw new AuthenticationError('Invalid MFA verification token');
    }
  }

  // Reset rate limit on success
  authRateLimiter.reset(rateLimitKey);

  // Create session (expires in 30 days) (FR-AUTH-002)
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      token,
      expiresAt,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    })
    .returning();

  // Fetch authorized memberships (FR-AUTH-003)
  const memberships = await db
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, user.id), eq(tenantMemberships.status, 'ACTIVE')));

  if (user.isPlatformAdmin) {
    await logAuditEvent({
      actorId: user.id,
      actorRole: 'PLATFORM_SUPER_ADMIN',
      action: 'platform.login',
      resourceType: 'session',
      resourceId: session.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }

  return { session, user, memberships };
}

export async function validateSession(token: string): Promise<SessionWithUser> {
  const db = getDb();
  const now = new Date();

  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, token), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);

  if (!session) {
    throw new AuthenticationError('Session expired or revoked');
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) {
    throw new AuthenticationError('User associated with session does not exist');
  }

  const memberships = await db
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, user.id), eq(tenantMemberships.status, 'ACTIVE')));

  return { session, user, memberships };
}

export async function revokeSession(sessionId: string, actorUserId: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, sessionId));

  await logAuditEvent({
    actorId: actorUserId,
    actorRole: 'USER',
    action: 'session.revoked',
    resourceType: 'session',
    resourceId: sessionId,
  });
}

export async function getUserIdentity(userId: string): Promise<{ user: User; memberships: TenantMembership[] }> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const memberships = await db
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, user.id), eq(tenantMemberships.status, 'ACTIVE')));

  return { user, memberships };
}
