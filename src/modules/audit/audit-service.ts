import { getDb } from '../../db/client';
import { auditLogs, NewAuditLog } from '../../db/schema/audit';
import { desc, eq, and } from 'drizzle-orm';
import { generateUUID } from '../../core/auth/crypto';

export interface AuditEventInput {
  tenantId?: string | null;
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  changesSummary?: Record<string, unknown>;
}

const REDACTED_PATTERNS = ['password', 'secret', 'token', 'apikey', 'api_key', 'auth', 'card', 'cvv', 'key'];

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const pattern of REDACTED_PATTERNS) {
    if (lower.includes(pattern)) return true;
  }
  return false;
}

export function sanitizeAuditData(data?: Record<string, unknown>): Record<string, unknown> {
  if (!data) return {};
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      cleaned[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      cleaned[key] = sanitizeAuditData(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  const db = getDb();
  const sanitizedSummary = sanitizeAuditData(input.changesSummary);

  const entry: NewAuditLog = {
    tenantId: input.tenantId || null,
    actorId: input.actorId || 'SYSTEM',
    actorRole: input.actorRole || 'SYSTEM',
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    requestId: input.requestId || generateUUID(),
    ipAddress: input.ipAddress || null,
    userAgent: input.userAgent || null,
    changesSummary: sanitizedSummary,
  };

  await db.insert(auditLogs).values(entry);
}

export async function getAuditLogs(params: {
  tenantId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  actorId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const conditions = [];

  if (params.tenantId) {
    conditions.push(eq(auditLogs.tenantId, params.tenantId));
  }
  if (params.resourceType) {
    conditions.push(eq(auditLogs.resourceType, params.resourceType));
  }
  if (params.resourceId) {
    conditions.push(eq(auditLogs.resourceId, params.resourceId));
  }
  if (params.action) {
    conditions.push(eq(auditLogs.action, params.action));
  }
  if (params.actorId) {
    conditions.push(eq(auditLogs.actorId, params.actorId));
  }

  return await db
    .select()
    .from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.timestamp))
    .limit(params.limit || 50)
    .offset(params.offset || 0);
}
