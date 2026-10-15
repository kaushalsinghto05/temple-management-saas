import { RateLimitExceededError } from '../errors';

interface RateLimitRecord {
  attempts: number[];
}

export class MemoryRateLimiter {
  private records: Map<string, RateLimitRecord> = new Map();
  private maxAttempts: number;
  private windowMs: number;

  constructor(maxAttempts: number = 5, windowMs: number = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  public check(key: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const record = this.records.get(key) || { attempts: [] };

    // Filter out attempts older than windowMs
    record.attempts = record.attempts.filter((timestamp) => now - timestamp < this.windowMs);

    if (record.attempts.length >= this.maxAttempts) {
      const oldestAttempt = record.attempts[0];
      const resetMs = this.windowMs - (now - oldestAttempt);
      return {
        allowed: false,
        remaining: 0,
        resetMs: Math.max(0, resetMs),
      };
    }

    return {
      allowed: true,
      remaining: this.maxAttempts - record.attempts.length,
      resetMs: this.windowMs,
    };
  }

  public recordAttempt(key: string): void {
    const now = Date.now();
    const record = this.records.get(key) || { attempts: [] };
    record.attempts = record.attempts.filter((timestamp) => now - timestamp < this.windowMs);
    record.attempts.push(now);
    this.records.set(key, record);
  }

  public enforce(key: string): void {
    const status = this.check(key);
    if (!status.allowed) {
      throw new RateLimitExceededError(`Too many attempts. Please try again in ${Math.ceil(status.resetMs / 1000)} seconds.`);
    }
    this.recordAttempt(key);
  }

  public reset(key: string): void {
    this.records.delete(key);
  }

  public clear(): void {
    this.records.clear();
  }
}

export const authRateLimiter = new MemoryRateLimiter(5, 15 * 60 * 1000);
