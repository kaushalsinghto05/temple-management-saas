import { pgTable, uuid, varchar, timestamp, boolean, jsonb, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export interface TempleAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface TempleBranding {
  logoUrl?: string;
  bannerUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  description?: string;
}

export const temples = pgTable(
  'temples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).default('Asia/Kolkata').notNull(),
    address: jsonb('address').$type<TempleAddress>().notNull(),
    contactEmail: varchar('contact_email', { length: 255 }),
    contactPhone: varchar('contact_phone', { length: 50 }),
    branding: jsonb('branding').$type<TempleBranding>().default({}).notNull(),
    operatingStatus: varchar('operating_status', { length: 50 }).default('ACTIVE').notNull(),
    published: boolean('published').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('temples_tenant_slug_unique').on(table.tenantId, table.slug),
    unique('temples_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export type Temple = typeof temples.$inferSelect;
export type NewTemple = typeof temples.$inferInsert;
