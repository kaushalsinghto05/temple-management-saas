import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword, verifyPassword, generateToken } from '@/core/auth/crypto';
import { generateMfaSecret, verifyMfaToken } from '@/core/auth/mfa';
import { MemoryRateLimiter } from '@/core/auth/rate-limiter';
import { RateLimitExceededError } from '@/core/errors';
import * as OTPAuth from 'otpauth';

describe('Unit: Cryptography, MFA & Rate Limiting', () => {
  it('should hash and verify passwords securely', async () => {
    const password = 'SuperSecurePassword@2026';
    const { hash, salt } = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(salt).toBeDefined();

    const isValid = await verifyPassword(password, hash, salt);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword('WrongPassword', hash, salt);
    expect(isInvalid).toBe(false);
  });

  it('should generate secure random tokens', () => {
    const token1 = generateToken(32);
    const token2 = generateToken(32);
    expect(token1.length).toBe(64); // 32 bytes in hex = 64 chars
    expect(token1).not.toBe(token2);
  });

  it('should generate RFC 6238 TOTP secrets and verify valid tokens', () => {
    const mfa = generateMfaSecret('TrustTemple', 'admin@temple.org');
    expect(mfa.secret).toBeDefined();
    expect(mfa.uri).toContain('otpauth://totp/');

    // Generate valid TOTP token using the secret
    const totp = new OTPAuth.TOTP({
      issuer: 'TrustTemple',
      label: 'admin@temple.org',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(mfa.secret),
    });
    const currentToken = totp.generate();

    const isValid = verifyMfaToken(mfa.secret, currentToken);
    expect(isValid).toBe(true);

    const isInvalid = verifyMfaToken(mfa.secret, '000000');
    expect(isInvalid).toBe(false);
  });

  describe('Rate Limiter (FR-AUTH-005)', () => {
    let limiter: MemoryRateLimiter;

    beforeEach(() => {
      limiter = new MemoryRateLimiter(3, 5000); // 3 attempts per 5 seconds
    });

    it('should allow attempts under threshold and block on excess', () => {
      const key = '192.168.1.1:admin@temple.org';

      expect(() => limiter.enforce(key)).not.toThrow();
      expect(() => limiter.enforce(key)).not.toThrow();
      expect(() => limiter.enforce(key)).not.toThrow();

      // 4th attempt should throw RateLimitExceededError
      expect(() => limiter.enforce(key)).toThrow(RateLimitExceededError);
    });

    it('should reset attempts on successful login', () => {
      const key = '192.168.1.1:admin@temple.org';

      limiter.enforce(key);
      limiter.enforce(key);
      limiter.reset(key);

      // Should allow full quota again
      expect(() => limiter.enforce(key)).not.toThrow();
      expect(() => limiter.enforce(key)).not.toThrow();
      expect(() => limiter.enforce(key)).not.toThrow();
    });
  });
});
