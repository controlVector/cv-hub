import { pgTable, uuid, varchar, text, boolean, timestamp, index, integer, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositories } from './repositories';
import { organizations } from './organizations';
import { users } from './users';

// ============================================================================
// Enums
// ============================================================================

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'pending',
  'delivered',
  'failed',
]);

// ============================================================================
// Webhooks
// ============================================================================

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Scope: repo-level or org-wide
  repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),

  // Endpoint configuration
  url: text('url').notNull(),
  secret: varchar('secret', { length: 255 }).notNull(), // Hashed secret for HMAC signing
  contentType: varchar('content_type', { length: 50 }).default('application/json').notNull(),

  // Event subscriptions (e.g., ['push', 'pull_request', 'issues'])
  events: jsonb('events').$type<string[]>().default([]).notNull(),

  // Status
  active: boolean('active').default(true).notNull(),

  // Creator
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('webhooks_repository_id_idx').on(table.repositoryId),
  index('webhooks_organization_id_idx').on(table.organizationId),
  index('webhooks_active_idx').on(table.active),
]);

// ============================================================================
// Webhook Deliveries
// ============================================================================

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),

  // Event info
  event: varchar('event', { length: 50 }).notNull(), // e.g., 'push', 'pull_request'
  action: varchar('action', { length: 50 }), // e.g., 'opened', 'merged' (null for push)

  // Request/response
  payload: jsonb('payload').notNull(),
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  responseTimeMs: integer('response_time_ms'),

  // Retry tracking
  retryCount: integer('retry_count').default(0).notNull(),
  status: deliveryStatusEnum('status').default('pending').notNull(),
  error: text('error'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
}, (table) => [
  index('webhook_deliveries_webhook_id_idx').on(table.webhookId),
  index('webhook_deliveries_status_idx').on(table.status),
  index('webhook_deliveries_created_at_idx').on(table.createdAt),
]);

// ============================================================================
// Relations
// ============================================================================

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [webhooks.repositoryId],
    references: [repositories.id],
  }),
  organization: one(organizations, {
    fields: [webhooks.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [webhooks.createdBy],
    references: [users.id],
  }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookDeliveries.webhookId],
    references: [webhooks.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type DeliveryStatus = typeof deliveryStatusEnum.enumValues[number];
