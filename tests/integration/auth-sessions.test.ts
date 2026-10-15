import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';
import {
  registerUser,
  signIn,
  setupMfa,
  verifyAndEnableMfa,
  validateSession,
  revokeSession,
  getUserIdentity,
} from '@/modules/auth/auth-service';
import { AuthenticationError, RateLimitExceededError } from '@/core/errors';
import * as OTPAuth from 'otpauth';

describe('Integration: Identity & Sessions (FR-AUTH-001 to 005)', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await teardownTestDatabase();
  });

  it('FR-AUTH-001 & 002: should register user, sign in, create session, and revoke upon logout', async () => {
    const user = await registerUser({
      email: 'devotee@example.com',
      password: 'DevoteePassword123!',
      fullName: 'Ramesh Sharma',
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('devotee@example.com');

    // Sign in
    const authResult = await signIn({
      identifier: 'devotee@example.com',
      password: 'DevoteePassword123!',
      ipAddress: '10.0.0.1',
    });

    expect(authResult.session.token).toBeDefined();
    expect(authResult.user.id).toBe(user.id);

    // Validate active session
    const validated = await validateSession(authResult.session.token);
    expect(validated.user.id).toBe(user.id);

    // Revoke session (logout)
    await revokeSession(authResult.session.id, user.id);

    // Validating revoked session must fail
    await expect(validateSession(authResult.session.token)).rejects.toThrow(AuthenticationError);
  });

  it('FR-AUTH-004: should require and verify MFA for privileged platform accounts', async () => {
    // Register platform admin
    const admin = await registerUser({
      email: 'platform.admin@trustsaas.com',
      password: 'AdminMasterKey2026!',
      fullName: 'Chief Platform Officer',
      isPlatformAdmin: true,
    });

    // Setup MFA
    const mfa = await setupMfa(admin.id);
    expect(mfa.secret).toBeDefined();

    // Generate valid TOTP token
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(mfa.secret),
      digits: 6,
      period: 30,
    });
    const validToken = totp.generate();

    // Enable MFA
    await verifyAndEnableMfa(admin.id, validToken);

    // Attempt sign-in without MFA token -> should fail
    await expect(
      signIn({
        identifier: 'platform.admin@trustsaas.com',
        password: 'AdminMasterKey2026!',
        ipAddress: '10.0.0.2',
      })
    ).rejects.toThrow(AuthenticationError);

    // Attempt sign-in with invalid MFA token -> should fail
    await expect(
      signIn({
        identifier: 'platform.admin@trustsaas.com',
        password: 'AdminMasterKey2026!',
        mfaToken: '999999',
        ipAddress: '10.0.0.2',
      })
    ).rejects.toThrow(AuthenticationError);

    // Attempt sign-in with valid MFA token -> should succeed
    const validSignIn = await signIn({
      identifier: 'platform.admin@trustsaas.com',
      password: 'AdminMasterKey2026!',
      mfaToken: totp.generate(),
      ipAddress: '10.0.0.2',
    });

    expect(validSignIn.session.token).toBeDefined();
    expect(validSignIn.user.isPlatformAdmin).toBe(true);
  });

  it('FR-AUTH-005: should prevent account enumeration by returning identical error for nonexistent user', async () => {
    // Existing user wrong password
    await registerUser({
      email: 'known@temple.org',
      password: 'KnownPassword123!',
      fullName: 'Known Devotee',
    });

    let error1: any;
    try {
      await signIn({
        identifier: 'known@temple.org',
        password: 'WrongPassword!',
        ipAddress: '10.0.0.3',
      });
    } catch (err) {
      error1 = err;
    }

    let error2: any;
    try {
      await signIn({
        identifier: 'nonexistent@temple.org',
        password: 'WrongPassword!',
        ipAddress: '10.0.0.3',
      });
    } catch (err) {
      error2 = err;
    }

    expect(error1).toBeInstanceOf(AuthenticationError);
    expect(error2).toBeInstanceOf(AuthenticationError);
    expect(error1.message).toBe('Invalid credentials');
    expect(error2.message).toBe('Invalid credentials');
  });

  it('FR-AUTH-003: should retrieve user identity and memberships', async () => {
    const user = await registerUser({
      email: 'priest@shivatrust.org',
      password: 'PriestPassword!',
      fullName: 'Shri Sharma',
    });

    const identity = await getUserIdentity(user.id);
    expect(identity.user.fullName).toBe('Shri Sharma');
    expect(Array.isArray(identity.memberships)).toBe(true);
  });
});
