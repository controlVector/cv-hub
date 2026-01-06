/**
 * Embeddings Schema
 * Usage tracking and configuration for embedding generation
 *
 * Supports tiered configuration:
 * 1. Repository-level (BYOK)
 * 2. Organization-level (BYOK)
 * 3. Platform default (with quotas)
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  timestamp,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './index';

// ============================================================================
// Embedding Configuration
// ============================================================================

/**
 * Organization-level embedding settings
 * Allows orgs to bring their own API keys
 */
export const organizationEmbeddingConfig = pgTable('organization_embedding_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().unique(),

  // BYOK - encrypted API key (null = use platform default)
  apiKeyEncrypted: text('api_key_encrypted'),
  apiKeyProvider: varchar('api_key_provider', { length: 50 }), // 'openrouter', 'openai', etc.

  // Model preference
  embeddingModel: varchar('embedding_model', { length: 100 }),

  // Quota settings (null = unlimited for BYOK, platform limits for default)
  monthlyQuota: integer('monthly_quota'), // embeddings per month
  quotaResetDay: integer('quota_reset_day').default(1), // day of month to reset

  // Feature flags
  enabled: boolean('enabled').default(true),
  semanticSearchEnabled: boolean('semantic_search_enabled').default(true),
  aiAssistantEnabled: boolean('ai_assistant_enabled').default(true),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Repository-level embedding settings
 * Overrides org settings if specified
 */
export const repositoryEmbeddingConfig = pgTable('repository_embedding_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().unique(),

  // BYOK - encrypted API key (null = inherit from org or platform)
  apiKeyEncrypted: text('api_key_encrypted'),
  apiKeyProvider: varchar('api_key_provider', { length: 50 }),

  // Model preference (null = inherit)
  embeddingModel: varchar('embedding_model', { length: 100 }),

  // Override org quota (null = inherit)
  monthlyQuota: integer('monthly_quota'),

  // Feature flags (null = inherit from org)
  enabled: boolean('enabled'),
  semanticSearchEnabled: boolean('semantic_search_enabled'),
  aiAssistantEnabled: boolean('ai_assistant_enabled'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Usage Tracking
// ============================================================================

/**
 * Embedding usage records
 * Tracks every embedding generation for billing/quotas
 */
export const embeddingUsage = pgTable('embedding_usage', {
  id: uuid('id').primaryKey().defaultRandom(),

  // What generated the embeddings
  repositoryId: uuid('repository_id').notNull(),
  organizationId: uuid('organization_id'), // null for personal repos

  // Usage details
  operation: varchar('operation', { length: 50 }).notNull(), // 'sync', 'search', 'assistant'
  model: varchar('model', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(), // 'openrouter', 'openai', 'platform'

  // Metrics
  tokensUsed: integer('tokens_used').notNull(),
  embeddingsGenerated: integer('embeddings_generated').notNull(),

  // Cost tracking (in microdollars for precision)
  costMicrodollars: integer('cost_microdollars').default(0),

  // Who paid (for attribution)
  billedTo: varchar('billed_to', { length: 20 }).notNull(), // 'platform', 'organization', 'repository'
  billedToId: uuid('billed_to_id'), // org or repo id if not platform

  // Metadata
  metadata: jsonb('metadata'), // additional context (file paths, etc.)

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  repoIdx: index('embedding_usage_repo_idx').on(table.repositoryId),
  orgIdx: index('embedding_usage_org_idx').on(table.organizationId),
  createdAtIdx: index('embedding_usage_created_at_idx').on(table.createdAt),
  billedToIdx: index('embedding_usage_billed_to_idx').on(table.billedTo, table.billedToId),
}));

/**
 * Monthly usage summary (materialized for fast quota checks)
 */
export const embeddingUsageSummary = pgTable('embedding_usage_summary', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Period
  year: integer('year').notNull(),
  month: integer('month').notNull(),

  // Entity
  entityType: varchar('entity_type', { length: 20 }).notNull(), // 'organization', 'repository', 'platform'
  entityId: uuid('entity_id'), // null for platform totals

  // Aggregates
  totalTokens: bigint('total_tokens', { mode: 'number' }).default(0),
  totalEmbeddings: bigint('total_embeddings', { mode: 'number' }).default(0),
  totalCostMicrodollars: bigint('total_cost_microdollars', { mode: 'number' }).default(0),

  // Breakdown by operation
  syncEmbeddings: integer('sync_embeddings').default(0),
  searchEmbeddings: integer('search_embeddings').default(0),
  assistantEmbeddings: integer('assistant_embeddings').default(0),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  periodIdx: index('embedding_usage_summary_period_idx').on(table.year, table.month),
  entityIdx: index('embedding_usage_summary_entity_idx').on(table.entityType, table.entityId),
  uniqueIdx: index('embedding_usage_summary_unique_idx').on(table.year, table.month, table.entityType, table.entityId),
}));

// ============================================================================
// Platform Tiers (for future pricing)
// ============================================================================

/**
 * Platform embedding tiers
 * Defines quotas and pricing for different user tiers
 */
export const embeddingTiers = pgTable('embedding_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull().unique(), // 'free', 'pro', 'enterprise'

  // Quotas
  monthlyEmbeddings: integer('monthly_embeddings').notNull(),
  monthlySearches: integer('monthly_searches').notNull(),
  monthlyAssistantQueries: integer('monthly_assistant_queries').notNull(),

  // Features
  semanticSearchEnabled: boolean('semantic_search_enabled').default(true),
  aiAssistantEnabled: boolean('ai_assistant_enabled').default(true),
  byokAllowed: boolean('byok_allowed').default(false),

  // Pricing (in cents per month, 0 = free)
  priceMonthly: integer('price_monthly').default(0),

  // Display
  displayOrder: integer('display_order').default(0),
  description: text('description'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Types
// ============================================================================

export type OrganizationEmbeddingConfig = typeof organizationEmbeddingConfig.$inferSelect;
export type NewOrganizationEmbeddingConfig = typeof organizationEmbeddingConfig.$inferInsert;

export type RepositoryEmbeddingConfig = typeof repositoryEmbeddingConfig.$inferSelect;
export type NewRepositoryEmbeddingConfig = typeof repositoryEmbeddingConfig.$inferInsert;

export type EmbeddingUsage = typeof embeddingUsage.$inferSelect;
export type NewEmbeddingUsage = typeof embeddingUsage.$inferInsert;

export type EmbeddingUsageSummary = typeof embeddingUsageSummary.$inferSelect;
export type EmbeddingTier = typeof embeddingTiers.$inferSelect;
