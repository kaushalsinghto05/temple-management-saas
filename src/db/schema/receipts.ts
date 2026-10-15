import { pgTable, uuid, varchar, text, timestamp, bigint, boolean, jsonb, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { temples } from './temples';
import { donations } from './donations';
import { users } from './users';

export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temples.id, { onDelete: 'cascade' }),
    donationId: uuid('donation_id')
      .notNull()
      .unique()
      .references(() => donations.id, { onDelete: 'cascade' }),
    donorUserId: uuid('donor_user_id').references(() => users.id, { onDelete: 'set null' }),
    receiptNumber: varchar('receipt_number', { length: 100 }).notNull(),
    fiscalYear: varchar('fiscal_year', { length: 20 }).notNull(),
    issuingEntity: varchar('recipient_legal_entity', { length: 255 }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).default('INR').notNull(),
    paymentReference: varchar('payment_reference', { length: 255 }).notNull(),
    status: varchar('status', { length: 50 }).default('VALID').notNull(), // 'VALID', 'VOIDED', 'CORRECTED'
    voidedReason: text('voided_reason'),
    voidedByUserId: uuid('voided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    taxDeductionEligible: boolean('tax_deduction_eligible').default(false).notNull(),
    taxDeductionNote: text('tax_deduction_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('receipts_tenant_number_unique').on(table.tenantId, table.receiptNumber),
    unique('receipts_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export const receiptRevisions = pgTable('receipt_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id')
    .notNull()
    .references(() => receipts.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  actorUserId: uuid('actor_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 50 }).notNull(), // 'VOIDED', 'CORRECTED'
  previousState: jsonb('previous_state').notNull(),
  newState: jsonb('new_state').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;

export type ReceiptRevision = typeof receiptRevisions.$inferSelect;
export type NewReceiptRevision = typeof receiptRevisions.$inferInsert;
