import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  pgEnum,
  jsonb,
  integer,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { organizations } from './organizations';

// ============================================================================
// Enums
// ============================================================================

export const flagValueTypeEnum = pgEnum('flag_value_type', [
  'boolean',
  'string',
  'number',
  'json',
]);

export const flagRuleOperatorEnum = pgEnum('flag_rule_operator', [
  'eq',        // equals
  'neq',       // not equals
  'in',        // in list
  'notIn',     // not in list
  'contains',  // string contains
  'startsWith',
  'endsWith',
  'matches',   // regex
  'gt',        // greater than
  'gte',       // greater than or equal
  'lt',        // less than
  'lte',       // less than or equal
  'exists',    // attribute exists
  'notExists', // attribute doesn't exist
  'semverGt',  // semver greater than
  'semverGte',
  'semverLt',
  'semverLte',
  'semverEq',
]);

// ============================================================================
// Type Definitions
// ============================================================================

export type FlagRuleOperator = typeof flagRuleOperatorEnum.enumValues[number];

export interface FlagRuleCondition {
  attribute: string;
  operator: FlagRuleOperator;
  values: unknown[];
}

export interface FlagRule {
  id: string;
  conditions: FlagRuleCondition[];
  segmentId?: string;
  percentage?: number;
  serveValue: unknown;
  priority: number;
}

export interface SegmentRule {
  attribute: string;
  operator: FlagRuleOperator;
  values: unknown[];
}

// ============================================================================
// Feature Flags
// ============================================================================

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Organization scope
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Identity
    key: varchar('key', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),

    // Type and default value
    valueType: flagValueTypeEnum('value_type').notNull().default('boolean'),
    defaultValue: jsonb('default_value').notNull().$type<unknown>(),

    // Organization
    tags: jsonb('tags').$type<string[]>().default([]),

    // Status
    isArchived: boolean('is_archived').default(false).notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Metadata
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('feature_flags_org_key_idx').on(table.organizationId, table.key),
    index('feature_flags_org_idx').on(table.organizationId),
    index('feature_flags_archived_idx').on(table.isArchived),
    index('feature_flags_tags_idx').using('gin', table.tags),
  ]
);

// ============================================================================
// Feature Flag Environments
// ============================================================================

export const featureFlagEnvironments = pgTable(
  'feature_flag_environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Parent flag
    flagId: uuid('flag_id')
      .notNull()
      .references(() => featureFlags.id, { onDelete: 'cascade' }),

    // Environment name
    environment: varchar('environment', { length: 50 }).notNull(),

    // State
    isEnabled: boolean('is_enabled').default(false).notNull(),

    // Override value (null = use flag default)
    overrideValue: jsonb('override_value').$type<unknown>(),

    // Global rollout percentage (0-100, null = 100%)
    rolloutPercentage: integer('rollout_percentage'),

    // Targeting rules (stored as JSON array for simplicity)
    rules: jsonb('rules').$type<FlagRule[]>().default([]),

    // Metadata
    updatedBy: uuid('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('feature_flag_env_flag_env_idx').on(table.flagId, table.environment),
    index('feature_flag_env_flag_idx').on(table.flagId),
    index('feature_flag_env_enabled_idx').on(table.isEnabled),
  ]
);

// ============================================================================
// Feature Flag Segments
// ============================================================================

export const featureFlagSegments = pgTable(
  'feature_flag_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Organization scope
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Identity
    key: varchar('key', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),

    // Matching rules (AND logic within, defines segment membership)
    rules: jsonb('rules').$type<SegmentRule[]>().notNull().default([]),

    // Match mode: all rules must match (AND) or any rule (OR)
    matchMode: varchar('match_mode', { length: 10 }).default('all').notNull(),

    // Metadata
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('feature_flag_segments_org_key_idx').on(table.organizationId, table.key),
    index('feature_flag_segments_org_idx').on(table.organizationId),
  ]
);

// ============================================================================
// Feature Flag History
// ============================================================================

export const featureFlagHistory = pgTable(
  'feature_flag_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Parent flag
    flagId: uuid('flag_id')
      .notNull()
      .references(() => featureFlags.id, { onDelete: 'cascade' }),

    // Optional environment (null = flag-level change)
    environment: varchar('environment', { length: 50 }),

    // Change details
    changeType: varchar('change_type', { length: 30 }).notNull(),
    previousValue: jsonb('previous_value').$type<unknown>(),
    newValue: jsonb('new_value').$type<unknown>(),
    changeDescription: text('change_description'),

    // Who made the change
    changedBy: uuid('changed_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Request metadata
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('feature_flag_history_flag_idx').on(table.flagId),
    index('feature_flag_history_env_idx').on(table.environment),
    index('feature_flag_history_created_idx').on(table.createdAt),
  ]
);

// ============================================================================
// Feature Flag API Keys (for SDK access)
// ============================================================================

export const featureFlagApiKeys = pgTable(
  'feature_flag_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Organization scope
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Identity
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),

    // Key (hashed)
    keyPrefix: varchar('key_prefix', { length: 10 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),

    // Permissions
    environment: varchar('environment', { length: 50 }).notNull(),
    canRead: boolean('can_read').default(true).notNull(),
    canWrite: boolean('can_write').default(false).notNull(),

    // Status
    isActive: boolean('is_active').default(true).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Usage tracking
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    usageCount: integer('usage_count').default(0).notNull(),

    // Metadata
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('feature_flag_api_keys_hash_idx').on(table.keyHash),
    index('feature_flag_api_keys_org_idx').on(table.organizationId),
    index('feature_flag_api_keys_active_idx').on(table.isActive),
  ]
);

// ============================================================================
// Feature Flag Analytics (optional - for tracking evaluations)
// ============================================================================

export const featureFlagAnalytics = pgTable(
  'feature_flag_analytics',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Parent flag
    flagId: uuid('flag_id')
      .notNull()
      .references(() => featureFlags.id, { onDelete: 'cascade' }),

    // Environment
    environment: varchar('environment', { length: 50 }).notNull(),

    // Time bucket (hourly aggregation)
    timeBucket: timestamp('time_bucket', { withTimezone: true }).notNull(),

    // Counts
    evaluationCount: integer('evaluation_count').default(0).notNull(),
    trueCount: integer('true_count').default(0).notNull(),
    falseCount: integer('false_count').default(0).notNull(),

    // Unique users (approximate with HyperLogLog would be better, but simple count for now)
    uniqueUsers: integer('unique_users').default(0).notNull(),
  },
  (table) => [
    uniqueIndex('feature_flag_analytics_bucket_idx').on(
      table.flagId,
      table.environment,
      table.timeBucket
    ),
    index('feature_flag_analytics_flag_idx').on(table.flagId),
    index('feature_flag_analytics_time_idx').on(table.timeBucket),
  ]
);

// ============================================================================
// Relations
// ============================================================================

export const featureFlagsRelations = relations(featureFlags, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [featureFlags.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [featureFlags.createdBy],
    references: [users.id],
  }),
  environments: many(featureFlagEnvironments),
  history: many(featureFlagHistory),
  analytics: many(featureFlagAnalytics),
}));

export const featureFlagEnvironmentsRelations = relations(
  featureFlagEnvironments,
  ({ one }) => ({
    flag: one(featureFlags, {
      fields: [featureFlagEnvironments.flagId],
      references: [featureFlags.id],
    }),
    updatedByUser: one(users, {
      fields: [featureFlagEnvironments.updatedBy],
      references: [users.id],
    }),
  })
);

export const featureFlagSegmentsRelations = relations(
  featureFlagSegments,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [featureFlagSegments.organizationId],
      references: [organizations.id],
    }),
    createdByUser: one(users, {
      fields: [featureFlagSegments.createdBy],
      references: [users.id],
    }),
  })
);

export const featureFlagHistoryRelations = relations(
  featureFlagHistory,
  ({ one }) => ({
    flag: one(featureFlags, {
      fields: [featureFlagHistory.flagId],
      references: [featureFlags.id],
    }),
    changedByUser: one(users, {
      fields: [featureFlagHistory.changedBy],
      references: [users.id],
    }),
  })
);

export const featureFlagApiKeysRelations = relations(
  featureFlagApiKeys,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [featureFlagApiKeys.organizationId],
      references: [organizations.id],
    }),
    createdByUser: one(users, {
      fields: [featureFlagApiKeys.createdBy],
      references: [users.id],
    }),
  })
);

export const featureFlagAnalyticsRelations = relations(
  featureFlagAnalytics,
  ({ one }) => ({
    flag: one(featureFlags, {
      fields: [featureFlagAnalytics.flagId],
      references: [featureFlags.id],
    }),
  })
);

// ============================================================================
// Type Exports
// ============================================================================

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type FeatureFlagEnvironment = typeof featureFlagEnvironments.$inferSelect;
export type NewFeatureFlagEnvironment = typeof featureFlagEnvironments.$inferInsert;
export type FeatureFlagSegment = typeof featureFlagSegments.$inferSelect;
export type NewFeatureFlagSegment = typeof featureFlagSegments.$inferInsert;
export type FeatureFlagHistoryEntry = typeof featureFlagHistory.$inferSelect;
export type NewFeatureFlagHistoryEntry = typeof featureFlagHistory.$inferInsert;
export type FeatureFlagApiKey = typeof featureFlagApiKeys.$inferSelect;
export type NewFeatureFlagApiKey = typeof featureFlagApiKeys.$inferInsert;
export type FeatureFlagAnalyticsEntry = typeof featureFlagAnalytics.$inferSelect;
export type NewFeatureFlagAnalyticsEntry = typeof featureFlagAnalytics.$inferInsert;

export type FlagValueType = typeof flagValueTypeEnum.enumValues[number];
