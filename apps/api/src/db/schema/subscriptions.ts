import { pgTable, uuid, varchar, text, boolean, timestamp, index, pgEnum, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organizations';
import { users } from './users';
import { pricingTiers } from './pricing';

// Subscription status (mirrors Stripe statuses)
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

// Payment method type
export const paymentMethodTypeEnum = pgEnum('payment_method_type', [
  'card',
  'bank_account',
  'sepa_debit',
]);

// Invoice status
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'open',
  'paid',
  'uncollectible',
  'void',
]);

// Subscriptions table - links orgs to paid plans
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Link to organization (the "tenant")
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),

  // Stripe IDs
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).notNull(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }).unique(),
  stripePriceId: varchar('stripe_price_id', { length: 255 }),

  // Plan reference
  pricingTierId: uuid('pricing_tier_id').references(() => pricingTiers.id),

  // Status
  status: subscriptionStatusEnum('status').default('incomplete').notNull(),

  // Billing details
  billingInterval: varchar('billing_interval', { length: 16 }), // 'monthly' or 'annual'
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),

  // Trial info
  trialStart: timestamp('trial_start', { withTimezone: true }),
  trialEnd: timestamp('trial_end', { withTimezone: true }),

  // Metadata from Stripe
  metadata: jsonb('metadata').$type<Record<string, string>>(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('subscriptions_org_id_idx').on(table.organizationId),
  index('subscriptions_stripe_customer_idx').on(table.stripeCustomerId),
  index('subscriptions_stripe_subscription_idx').on(table.stripeSubscriptionId),
  index('subscriptions_status_idx').on(table.status),
]);

// Payment methods table
export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Link to organization
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),

  // Stripe IDs
  stripePaymentMethodId: varchar('stripe_payment_method_id', { length: 255 }).notNull().unique(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).notNull(),

  // Type and details
  type: paymentMethodTypeEnum('type').default('card').notNull(),

  // Card details (if type = card)
  cardBrand: varchar('card_brand', { length: 32 }), // visa, mastercard, etc.
  cardLast4: varchar('card_last4', { length: 4 }),
  cardExpMonth: integer('card_exp_month'),
  cardExpYear: integer('card_exp_year'),

  // Bank account details (if type = bank_account)
  bankName: varchar('bank_name', { length: 100 }),
  bankLast4: varchar('bank_last4', { length: 4 }),

  // Status
  isDefault: boolean('is_default').default(false).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('payment_methods_org_id_idx').on(table.organizationId),
  index('payment_methods_stripe_customer_idx').on(table.stripeCustomerId),
]);

// Invoices table - payment history
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Link to organization
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id),

  // Stripe IDs
  stripeInvoiceId: varchar('stripe_invoice_id', { length: 255 }).notNull().unique(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).notNull(),

  // Invoice details
  invoiceNumber: varchar('invoice_number', { length: 64 }),
  status: invoiceStatusEnum('status').default('draft').notNull(),

  // Amounts (in cents)
  amountDue: integer('amount_due').default(0).notNull(),
  amountPaid: integer('amount_paid').default(0).notNull(),
  amountRemaining: integer('amount_remaining').default(0).notNull(),
  subtotal: integer('subtotal').default(0).notNull(),
  tax: integer('tax').default(0),
  total: integer('total').default(0).notNull(),

  // Currency
  currency: varchar('currency', { length: 3 }).default('usd').notNull(),

  // URLs
  hostedInvoiceUrl: text('hosted_invoice_url'),
  invoicePdfUrl: text('invoice_pdf_url'),

  // Dates
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  dueDate: timestamp('due_date', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),

  // Line items summary
  lineItems: jsonb('line_items').$type<{
    description: string;
    quantity: number;
    amount: number;
  }[]>(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('invoices_org_id_idx').on(table.organizationId),
  index('invoices_subscription_id_idx').on(table.subscriptionId),
  index('invoices_stripe_invoice_idx').on(table.stripeInvoiceId),
  index('invoices_status_idx').on(table.status),
]);

// Stripe webhook events (for idempotency tracking)
export const stripeEvents = pgTable('stripe_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  stripeEventId: varchar('stripe_event_id', { length: 255 }).notNull().unique(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  processed: boolean('processed').default(false).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('stripe_events_event_id_idx').on(table.stripeEventId),
  index('stripe_events_processed_idx').on(table.processed),
]);

// Relations
export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [subscriptions.organizationId],
    references: [organizations.id],
  }),
  pricingTier: one(pricingTiers, {
    fields: [subscriptions.pricingTierId],
    references: [pricingTiers.id],
  }),
  invoices: many(invoices),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  organization: one(organizations, {
    fields: [paymentMethods.organizationId],
    references: [organizations.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  organization: one(organizations, {
    fields: [invoices.organizationId],
    references: [organizations.id],
  }),
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
}));

// Type exports
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type NewPaymentMethod = typeof paymentMethods.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type StripeEvent = typeof stripeEvents.$inferSelect;
export type NewStripeEvent = typeof stripeEvents.$inferInsert;

export type SubscriptionStatus = typeof subscriptionStatusEnum.enumValues[number];
export type PaymentMethodType = typeof paymentMethodTypeEnum.enumValues[number];
export type InvoiceStatus = typeof invoiceStatusEnum.enumValues[number];
