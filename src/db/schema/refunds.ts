import { pgTable, uuid, varchar, text, timestamp, bigint, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { temples } from './temples';
import { payments } from './payments';
import { bookings } from './bookings';
import { donations } from './donations';
import { users } from './users';

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temples.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    donationId: uuid('donation_id').references(() => donations.id, { onDelete: 'set null' }),
    amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).default('INR').notNull(),
    reason: text('reason').notNull(),
    status: varchar('status', { length: 50 }).default('PENDING').notNull(), // 'PENDING', 'COMPLETED', 'FAILED'
    providerRefundId: varchar('provider_refund_id', { length: 255 }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('refunds_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
