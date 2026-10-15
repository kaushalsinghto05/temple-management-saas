import { pgTable, uuid, varchar, text, timestamp, integer, bigint, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { temples } from './temples';

export const pujaServices = pgTable(
  'puja_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temples.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes').notNull(),
    priceMinorUnits: bigint('price_minor_units', { mode: 'number' }).notNull(), // e.g. 50100 for ₹501.00
    currency: varchar('currency', { length: 3 }).default('INR').notNull(),
    status: varchar('status', { length: 50 }).default('DRAFT').notNull(), // DRAFT, PUBLISHED, ARCHIVED
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('pujas_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export const pujaTimeSlots = pgTable(
  'puja_time_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temples.id, { onDelete: 'cascade' }),
    pujaServiceId: uuid('puja_service_id')
      .notNull()
      .references(() => pujaServices.id, { onDelete: 'cascade' }),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    totalCapacity: integer('total_capacity').notNull(),
    allocatedCapacity: integer('allocated_capacity').default(0).notNull(),
    availabilityStatus: varchar('availability_status', { length: 50 }).default('AVAILABLE').notNull(), // AVAILABLE, FULL, CANCELLED
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('slots_id_tenant_unique').on(table.id, table.tenantId),
    check('slots_capacity_check', sql`${table.allocatedCapacity} <= ${table.totalCapacity}`),
    check('slots_time_check', sql`${table.endTime} > ${table.startTime}`),
  ]
);

export type PujaService = typeof pujaServices.$inferSelect;
export type NewPujaService = typeof pujaServices.$inferInsert;

export type PujaTimeSlot = typeof pujaTimeSlots.$inferSelect;
export type NewPujaTimeSlot = typeof pujaTimeSlots.$inferInsert;
