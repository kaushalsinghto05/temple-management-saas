import { pgTable, uuid, varchar, timestamp, integer, bigint, jsonb, boolean, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { temples } from './temples';
import { pujaServices, pujaTimeSlots } from './pujas';
import { users } from './users';

export interface DevoteeDetails {
  name: string;
  email?: string;
  phone?: string;
  gotra?: string;
  nakshatra?: string;
  notes?: string;
}

export const bookings = pgTable(
  'bookings',
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
    slotId: uuid('slot_id')
      .notNull()
      .references(() => pujaTimeSlots.id, { onDelete: 'cascade' }),
    devoteeUserId: uuid('devotee_user_id').references(() => users.id, { onDelete: 'set null' }),
    bookingReference: varchar('booking_reference', { length: 64 }).unique().notNull(),
    participantCount: integer('participant_count').notNull(),
    totalPriceMinorUnits: bigint('total_price_minor_units', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).default('INR').notNull(),
    serviceSnapshot: jsonb('service_snapshot').notNull(),
    devoteeDetails: jsonb('devotee_details').$type<DevoteeDetails>().notNull(),
    status: varchar('status', { length: 50 }).default('PENDING_PAYMENT').notNull(), // PENDING_PAYMENT, CONFIRMED, CANCELLED, EXPIRED, COMPLETED
    fulfillmentStatus: varchar('fulfillment_status', { length: 50 }).default('UNFULFILLED').notNull(), // UNFULFILLED, CHECKED_IN, COMPLETED
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    capacityReleased: boolean('capacity_released').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('bookings_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
