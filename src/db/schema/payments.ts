import { pgTable, uuid, varchar, text, timestamp, bigint, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { temples } from './temples';

export const templePaymentConfigs = pgTable(
  'temple_payment_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temples.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull(), // 'RAZORPAY', 'STRIPE', 'MOCK'
    merchantAccountId: varchar('merchant_account_id', { length: 255 }).notNull(),
    webhookSecret: text('webhook_secret').notNull(),
    apiKey: text('api_key').notNull(),
    status: varchar('status', { length: 50 }).default('ELIGIBLE').notNull(), // 'ELIGIBLE', 'PENDING', 'SUSPENDED'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('payment_configs_temple_provider_unique').on(table.templeId, table.provider),
    unique('payment_configs_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temples.id, { onDelete: 'cascade' }),
    referenceType: varchar('reference_type', { length: 50 }).notNull(), // 'BOOKING', 'DONATION'
    bookingId: uuid('booking_id'),
    donationId: uuid('donation_id'),
    provider: varchar('provider', { length: 50 }).notNull(), // 'RAZORPAY', 'STRIPE', 'MOCK'
    providerOrderId: varchar('provider_order_id', { length: 255 }).notNull(),
    providerPaymentId: varchar('provider_payment_id', { length: 255 }),
    amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).default('INR').notNull(),
    feeMinorUnits: bigint('fee_minor_units', { mode: 'number' }),
    netSettlementMinorUnits: bigint('net_settlement_minor_units', { mode: 'number' }),
    status: varchar('status', { length: 50 }).default('PENDING').notNull(), // 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'RECONCILIATION_REQUIRED'
    reconciliationReason: text('reconciliation_reason'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('payments_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 50 }).notNull(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: text('payload').notNull(),
    status: varchar('status', { length: 50 }).notNull(), // 'PROCESSED', 'DUPLICATE', 'QUARANTINED', 'FAILED'
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('webhook_events_provider_event_unique').on(table.provider, table.eventId),
  ]
);

export type TemplePaymentConfig = typeof templePaymentConfigs.$inferSelect;
export type NewTemplePaymentConfig = typeof templePaymentConfigs.$inferInsert;

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;
export type NewPaymentWebhookEvent = typeof paymentWebhookEvents.$inferInsert;
