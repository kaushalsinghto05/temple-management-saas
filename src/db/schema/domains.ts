import { pgTable, uuid, varchar, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { temples } from './temples';

export const customDomains = pgTable(
  'custom_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temples.id, { onDelete: 'cascade' }),
    domain: varchar('domain', { length: 255 }).unique().notNull(),
    verificationToken: varchar('verification_token', { length: 100 }).notNull(),
    status: varchar('status', { length: 50 }).default('PENDING_VERIFICATION').notNull(), // 'PENDING_VERIFICATION', 'ACTIVE', 'FAILED'
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('custom_domains_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export type CustomDomain = typeof customDomains.$inferSelect;
export type NewCustomDomain = typeof customDomains.$inferInsert;
