import { pgTable, uuid, varchar, text, boolean, timestamp, index, pgEnum, jsonb, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

// Billing interval enum
export const billingIntervalEnum = pgEnum('billing_interval', [
  'monthly',
  'annual',
]);

// Quote request status enum
export const quoteStatusEnum = pgEnum('quote_status', [
  'pending',      // Awaiting review
  'contacted',    // Sales has reached out
  'qualified',    // Lead is qualified
  'closed_won',   // Deal closed
  'closed_lost',  // Deal lost
]);

// Pricing tiers table (configurable tier packages)
export const pricingTiers = pgTable('pricing_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 32 }).notNull().unique(), // 'starter', 'pro', 'enterprise'
  displayName: varchar('display_name', { length: 64 }).notNull(), // 'Starter', 'Pro', 'Enterprise'
  description: text('description'),

  // Pricing (in cents, null = custom pricing)
  basePriceMonthly: integer('base_price_monthly'), // Monthly price in cents (null for Enterprise)
  basePriceAnnual: integer('base_price_annual'),   // Annual price in cents (null for Enterprise)

  // Limits (null = unlimited)
  limits: jsonb('limits').$type<{
    environments: number | null;    // Max environments
    repositories: number | null;    // Max repositories
    teamMembers: number | null;     // Max team members
    storageGb: number | null;       // Max storage in GB
    buildMinutes: number | null;    // Monthly build minutes
    configSets: number | null;      // Max config sets (0 = disabled)
    configSchemas: number | null;   // Max config schemas
    configHistoryDays: number | null; // Config history retention in days
  }>().notNull(),

  // Features included in this tier
  features: jsonb('features').$type<{
    branchProtection: boolean;
    sso: boolean;
    customDomain: boolean;
    analytics: boolean;
    auditLogs: boolean;
    prioritySupport: boolean;
    sla: boolean;
    dedicatedInstance: boolean;
    ipAllowlisting: boolean;
    webhooks: boolean;
    apiAccess: boolean;
    configManagement: boolean;        // Config management feature
    configExternalStores: boolean;    // External config stores (AWS SSM, Vault, etc.)
    configExports: boolean;           // Config export functionality
  }>().notNull(),

  // Display configuration
  isPopular: boolean('is_popular').default(false).notNull(),       // Show "Most Popular" badge
  isCustomPricing: boolean('is_custom_pricing').default(false).notNull(), // Requires quote
  sortOrder: integer('sort_order').default(0).notNull(),

  // Active status
  isActive: boolean('is_active').default(true).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('pricing_tiers_name_idx').on(table.name),
  index('pricing_tiers_is_active_idx').on(table.isActive),
  index('pricing_tiers_sort_order_idx').on(table.sortOrder),
]);

// Quote requests table (customer quote submissions)
export const quoteRequests = pgTable('quote_requests', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Contact information
  contactName: varchar('contact_name', { length: 100 }).notNull(),
  contactEmail: varchar('contact_email', { length: 255 }).notNull(),
  contactPhone: varchar('contact_phone', { length: 32 }),
  companyName: varchar('company_name', { length: 200 }),
  companySize: varchar('company_size', { length: 32 }), // '1-10', '11-50', '51-200', '201-500', '500+'

  // Requested tier (usually 'enterprise')
  requestedTier: varchar('requested_tier', { length: 32 }).notNull(),
  billingInterval: billingIntervalEnum('billing_interval').default('annual').notNull(),

  // Requirements
  requirements: jsonb('requirements').$type<{
    environments?: number;
    repositories?: number;
    teamMembers?: number;
    storageGb?: number;
    buildMinutes?: number;
    additionalNotes?: string;
  }>(),

  // Optional: linked user (if authenticated when submitting)
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

  // Status tracking
  status: quoteStatusEnum('status').default('pending').notNull(),
  assignedTo: varchar('assigned_to', { length: 100 }), // Sales rep name/email
  notes: text('notes'), // Internal notes

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (table) => [
  index('quote_requests_status_idx').on(table.status),
  index('quote_requests_user_id_idx').on(table.userId),
  index('quote_requests_created_at_idx').on(table.createdAt),
  index('quote_requests_contact_email_idx').on(table.contactEmail),
]);

// Customer environments table (for Phase 3 provisioning)
export const customerEnvironments = pgTable('customer_environments', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Owner
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Environment details
  name: varchar('name', { length: 64 }).notNull(),
  slug: varchar('slug', { length: 64 }).notNull(),
  type: varchar('type', { length: 32 }).notNull(), // 'development', 'staging', 'production'

  // Subscription
  pricingTierId: uuid('pricing_tier_id').references(() => pricingTiers.id),
  billingInterval: billingIntervalEnum('billing_interval').default('monthly').notNull(),

  // Configuration
  config: jsonb('config').$type<{
    region?: string;
    customDomain?: string;
    ipAllowlist?: string[];
  }>(),

  // Status
  status: varchar('status', { length: 32 }).default('active').notNull(), // 'pending', 'active', 'suspended', 'deleted'

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
}, (table) => [
  index('customer_environments_user_id_idx').on(table.userId),
  index('customer_environments_slug_idx').on(table.slug),
  index('customer_environments_status_idx').on(table.status),
]);

// Relations
export const pricingTiersRelations = relations(pricingTiers, ({ many }) => ({
  customerEnvironments: many(customerEnvironments),
}));

export const quoteRequestsRelations = relations(quoteRequests, ({ one }) => ({
  user: one(users, {
    fields: [quoteRequests.userId],
    references: [users.id],
  }),
}));

export const customerEnvironmentsRelations = relations(customerEnvironments, ({ one }) => ({
  user: one(users, {
    fields: [customerEnvironments.userId],
    references: [users.id],
  }),
  pricingTier: one(pricingTiers, {
    fields: [customerEnvironments.pricingTierId],
    references: [pricingTiers.id],
  }),
}));

// Type exports
export type PricingTier = typeof pricingTiers.$inferSelect;
export type NewPricingTier = typeof pricingTiers.$inferInsert;
export type QuoteRequest = typeof quoteRequests.$inferSelect;
export type NewQuoteRequest = typeof quoteRequests.$inferInsert;
export type CustomerEnvironment = typeof customerEnvironments.$inferSelect;
export type NewCustomerEnvironment = typeof customerEnvironments.$inferInsert;

export type BillingInterval = typeof billingIntervalEnum.enumValues[number];
export type QuoteStatus = typeof quoteStatusEnum.enumValues[number];

// Type for pricing tier limits
export type PricingTierLimits = NonNullable<PricingTier['limits']>;
export type PricingTierFeatures = NonNullable<PricingTier['features']>;
export type QuoteRequirements = NonNullable<QuoteRequest['requirements']>;
