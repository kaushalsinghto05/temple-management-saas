import { pgTable, uuid, varchar, text, timestamp, bigint, boolean, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { temples } from './temples';
import { users } from './users';

export const donationCampaigns = pgTable(
  'donation_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temples.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    purpose: text('purpose').notNull(),
    recipientLegalEntity: varchar('recipient_legal_entity', { length: 255 }).notNull(),
    suggestedAmountsMinorUnits: text('suggested_amounts_minor_units').notNull(), // JSON string array of amounts e.g. "[10000, 25000, 50000]"
    minAmountMinorUnits: bigint('min_amount_minor_units', { mode: 'number' }).default(1000).notNull(), // ₹10.00
    maxAmountMinorUnits: bigint('max_amount_minor_units', { mode: 'number' }),
    status: varchar('status', { length: 50 }).default('ACTIVE').notNull(), // 'ACTIVE', 'DRAFT', 'CLOSED'
    taxExemptionEligible: boolean('tax_exemption_eligible').default(false).notNull(),
    taxExemptionSection: varchar('tax_exemption_section', { length: 50 }), // e.g. '80G'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('campaigns_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export const donations = pgTable(
  'donations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templeId: uuid('temple_id')
      .notNull()
      .references(() => temples.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => donationCampaigns.id, { onDelete: 'cascade' }),
    donorUserId: uuid('donor_user_id').references(() => users.id, { onDelete: 'set null' }),
    amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).default('INR').notNull(),
    donorName: varchar('donor_name', { length: 255 }).notNull(),
    donorEmail: varchar('donor_email', { length: 255 }),
    donorPhone: varchar('donor_phone', { length: 50 }),
    donorPan: varchar('donor_pan', { length: 20 }),
    status: varchar('status', { length: 50 }).default('PENDING').notNull(), // 'PENDING', 'PAID', 'FAILED', 'REFUNDED'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('donations_id_tenant_unique').on(table.id, table.tenantId),
  ]
);

export type DonationCampaign = typeof donationCampaigns.$inferSelect;
export type NewDonationCampaign = typeof donationCampaigns.$inferInsert;

export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;
