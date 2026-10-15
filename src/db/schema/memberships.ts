import { pgTable, uuid, varchar, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { temples } from './temples';

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull(),
    assignedTempleId: uuid('assigned_temple_id').references(() => temples.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 50 }).default('ACTIVE').notNull(), // ACTIVE, INVITED, REVOKED
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('memberships_tenant_user_role_temple_unique').on(
      table.tenantId,
      table.userId,
      table.role,
      table.assignedTempleId
    ),
    unique('memberships_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export type TenantMembership = typeof tenantMemberships.$inferSelect;
export type NewTenantMembership = typeof tenantMemberships.$inferInsert;
