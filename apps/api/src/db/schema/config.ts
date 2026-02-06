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
import { repositories } from './repositories';
import { organizations } from './organizations';

// ============================================================================
// Enums
// ============================================================================

export const configStoreTypeEnum = pgEnum('config_store_type', [
  'builtin',
  'aws_ssm',
  'hashicorp_vault',
  'azure_keyvault',
  'gcp_secrets',
]);

export const configValueTypeEnum = pgEnum('config_value_type', [
  'string',
  'number',
  'boolean',
  'json',
  'secret',
]);

export const configScopeEnum = pgEnum('config_scope', [
  'repository',
  'organization',
  'environment',
]);

export const configValidatorTypeEnum = pgEnum('config_validator_type', [
  'regex',
  'range',
  'enum',
  'dependency',
  'custom',
]);

export const configExportFormatEnum = pgEnum('config_export_format', [
  'dotenv',
  'json',
  'yaml',
  'k8s_configmap',
  'k8s_secret',
  'terraform',
]);

export const configTokenPermissionEnum = pgEnum('config_token_permission', [
  'read',
  'write',
  'admin',
]);

// ============================================================================
// Type Definitions (for JSONB columns)
// ============================================================================

export interface ConfigSchemaKeyDefinition {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'secret';
  required?: boolean;
  default?: unknown;
  description?: string;
  pattern?: string;
  enum?: string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  deprecated?: boolean;
  deprecationMessage?: string;
}

export interface ConfigSchemaDefinition {
  version: string;
  keys: ConfigSchemaKeyDefinition[];
}

export interface ConfigStoreCredentials {
  [key: string]: string | undefined;
  // AWS SSM
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  awsRoleArn?: string;
  // HashiCorp Vault
  vaultAddress?: string;
  vaultToken?: string;
  vaultNamespace?: string;
  vaultPath?: string;
  // Azure Key Vault
  azureClientId?: string;
  azureClientSecret?: string;
  azureTenantId?: string;
  azureVaultUrl?: string;
  // GCP Secrets
  gcpProjectId?: string;
  gcpServiceAccountKey?: string;
}

export interface ConfigExportDestination {
  type: 'webhook' | 'git' | 's3' | 'local';
  // Webhook
  webhookUrl?: string;
  webhookHeaders?: Record<string, string>;
  // Git
  gitRepoUrl?: string;
  gitBranch?: string;
  gitPath?: string;
  // S3
  s3Bucket?: string;
  s3Key?: string;
  s3Region?: string;
}

export interface ConfigValidatorRule {
  type: 'regex' | 'range' | 'enum' | 'dependency' | 'custom';
  pattern?: string;
  min?: number;
  max?: number;
  values?: string[];
  dependsOn?: string;
  dependsOnValue?: unknown;
  customScript?: string;
  errorMessage: string;
}

// ============================================================================
// Config Schemas (Defines valid keys and their types)
// ============================================================================

export const configSchemas = pgTable(
  'config_schemas',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Ownership (either repository OR organization, not both)
    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),

    // Identity
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),

    // Schema definition
    definition: jsonb('definition').notNull().$type<ConfigSchemaDefinition>(),

    // Versioning
    version: integer('version').default(1).notNull(),
    previousVersionId: uuid('previous_version_id'),

    // Status
    isActive: boolean('is_active').default(true).notNull(),

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
    index('config_schemas_repo_idx').on(table.repositoryId),
    index('config_schemas_org_idx').on(table.organizationId),
    index('config_schemas_name_idx').on(table.name),
    index('config_schemas_active_idx').on(table.isActive),
  ]
);

// ============================================================================
// Config Stores (Storage backends)
// ============================================================================

export const configStores = pgTable(
  'config_stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Ownership
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Identity
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),

    // Store type
    type: configStoreTypeEnum('type').notNull(),

    // Encrypted credentials for external stores
    encryptedCredentials: text('encrypted_credentials'),
    credentialsIv: varchar('credentials_iv', { length: 32 }),

    // Status
    isDefault: boolean('is_default').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),

    // Connection status
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestSuccess: boolean('last_test_success'),
    lastTestError: text('last_test_error'),

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
    uniqueIndex('config_stores_org_name_idx').on(
      table.organizationId,
      table.name
    ),
    index('config_stores_org_idx').on(table.organizationId),
    index('config_stores_type_idx').on(table.type),
    index('config_stores_default_idx').on(table.organizationId, table.isDefault),
  ]
);

// ============================================================================
// Config Sets (Named collections of configs)
// ============================================================================

export const configSets = pgTable(
  'config_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Storage
    storeId: uuid('store_id')
      .notNull()
      .references(() => configStores.id, { onDelete: 'cascade' }),

    // Optional schema
    schemaId: uuid('schema_id').references(() => configSchemas.id, {
      onDelete: 'set null',
    }),

    // Scope (repository, organization, or environment)
    scope: configScopeEnum('scope').notNull(),
    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),

    // Identity
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),

    // Environment (e.g., development, staging, production)
    environment: varchar('environment', { length: 50 }),

    // Inheritance
    parentSetId: uuid('parent_set_id'),
    hierarchyRank: integer('hierarchy_rank').default(0).notNull(),

    // Status
    isActive: boolean('is_active').default(true).notNull(),
    isLocked: boolean('is_locked').default(false).notNull(),
    lockedReason: text('locked_reason'),
    lockedBy: uuid('locked_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),

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
    uniqueIndex('config_sets_scope_name_env_idx').on(
      table.scope,
      table.repositoryId,
      table.organizationId,
      table.name,
      table.environment
    ),
    index('config_sets_store_idx').on(table.storeId),
    index('config_sets_schema_idx').on(table.schemaId),
    index('config_sets_repo_idx').on(table.repositoryId),
    index('config_sets_org_idx').on(table.organizationId),
    index('config_sets_parent_idx').on(table.parentSetId),
    index('config_sets_environment_idx').on(table.environment),
  ]
);

// ============================================================================
// Config Values (The actual key-value pairs)
// ============================================================================

export const configValues = pgTable(
  'config_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Parent config set
    configSetId: uuid('config_set_id')
      .notNull()
      .references(() => configSets.id, { onDelete: 'cascade' }),

    // Key-value
    key: varchar('key', { length: 255 }).notNull(),
    valueType: configValueTypeEnum('value_type').default('string').notNull(),

    // Encrypted value (AES-256-GCM)
    encryptedValue: text('encrypted_value').notNull(),
    encryptionIv: varchar('encryption_iv', { length: 32 }).notNull(),

    // Flags
    isSecret: boolean('is_secret').default(false).notNull(),
    isEncrypted: boolean('is_encrypted').default(true).notNull(),

    // Versioning
    version: integer('version').default(1).notNull(),

    // Metadata
    description: text('description'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    lastUpdatedBy: uuid('last_updated_by').references(() => users.id, {
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
    uniqueIndex('config_values_set_key_idx').on(table.configSetId, table.key),
    index('config_values_set_idx').on(table.configSetId),
    index('config_values_key_idx').on(table.key),
    index('config_values_secret_idx').on(table.isSecret),
  ]
);

// ============================================================================
// Config Value History (Audit trail)
// ============================================================================

export const configValueHistory = pgTable(
  'config_value_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Parent value
    configValueId: uuid('config_value_id')
      .notNull()
      .references(() => configValues.id, { onDelete: 'cascade' }),
    configSetId: uuid('config_set_id')
      .notNull()
      .references(() => configSets.id, { onDelete: 'cascade' }),

    // Key (denormalized for history queries)
    key: varchar('key', { length: 255 }).notNull(),

    // Previous and new values (encrypted)
    previousEncryptedValue: text('previous_encrypted_value'),
    previousEncryptionIv: varchar('previous_encryption_iv', { length: 32 }),
    newEncryptedValue: text('new_encrypted_value'),
    newEncryptionIv: varchar('new_encryption_iv', { length: 32 }),

    // Version tracking
    previousVersion: integer('previous_version'),
    newVersion: integer('new_version').notNull(),

    // Change metadata
    changedBy: uuid('changed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    changeReason: text('change_reason'),
    changeType: varchar('change_type', { length: 20 }).notNull(), // 'create', 'update', 'delete'

    // Request metadata
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('config_value_history_value_idx').on(table.configValueId),
    index('config_value_history_set_idx').on(table.configSetId),
    index('config_value_history_key_idx').on(table.key),
    index('config_value_history_changed_by_idx').on(table.changedBy),
    index('config_value_history_created_at_idx').on(table.createdAt),
  ]
);

// ============================================================================
// Config Access Tokens (CI/CD integration tokens)
// ============================================================================

export const configAccessTokens = pgTable(
  'config_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Scoped to config sets
    configSetId: uuid('config_set_id')
      .notNull()
      .references(() => configSets.id, { onDelete: 'cascade' }),

    // Token identity
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),

    // Token value (hashed, never stored in plain)
    tokenPrefix: varchar('token_prefix', { length: 10 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),

    // Permissions
    permission: configTokenPermissionEnum('permission').default('read').notNull(),

    // Allowed config sets (if null, only the parent set)
    allowedSetIds: jsonb('allowed_set_ids').$type<string[]>(),

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
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('config_access_tokens_hash_idx').on(table.tokenHash),
    index('config_access_tokens_set_idx').on(table.configSetId),
    index('config_access_tokens_active_idx').on(table.isActive),
    index('config_access_tokens_expires_idx').on(table.expiresAt),
  ]
);

// ============================================================================
// Config Exports (Scheduled exports)
// ============================================================================

export const configExports = pgTable(
  'config_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Source config set
    configSetId: uuid('config_set_id')
      .notNull()
      .references(() => configSets.id, { onDelete: 'cascade' }),

    // Export settings
    name: varchar('name', { length: 100 }).notNull(),
    format: configExportFormatEnum('format').notNull(),

    // Destination
    destination: jsonb('destination').$type<ConfigExportDestination>(),

    // Schedule (cron expression, null = manual only)
    cronSchedule: varchar('cron_schedule', { length: 100 }),
    timezone: varchar('timezone', { length: 50 }).default('UTC'),

    // Export options
    includeSecrets: boolean('include_secrets').default(false).notNull(),
    keyPrefix: varchar('key_prefix', { length: 50 }),
    keyTransform: varchar('key_transform', { length: 20 }), // 'uppercase', 'lowercase', 'none'

    // Status
    isActive: boolean('is_active').default(true).notNull(),
    lastExportAt: timestamp('last_export_at', { withTimezone: true }),
    lastExportSuccess: boolean('last_export_success'),
    lastExportError: text('last_export_error'),
    nextScheduledAt: timestamp('next_scheduled_at', { withTimezone: true }),

    // Stats
    exportCount: integer('export_count').default(0).notNull(),

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
    index('config_exports_set_idx').on(table.configSetId),
    index('config_exports_active_idx').on(table.isActive),
    index('config_exports_next_scheduled_idx').on(table.nextScheduledAt),
  ]
);

// ============================================================================
// Config Validators (Custom validation rules)
// ============================================================================

export const configValidators = pgTable(
  'config_validators',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Parent schema
    schemaId: uuid('schema_id')
      .notNull()
      .references(() => configSchemas.id, { onDelete: 'cascade' }),

    // Target key (or null for cross-key validation)
    targetKey: varchar('target_key', { length: 255 }),

    // Validator definition
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    type: configValidatorTypeEnum('type').notNull(),
    rule: jsonb('rule').notNull().$type<ConfigValidatorRule>(),

    // Priority (lower = run first)
    priority: integer('priority').default(0).notNull(),

    // Status
    isActive: boolean('is_active').default(true).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('config_validators_schema_idx').on(table.schemaId),
    index('config_validators_key_idx').on(table.targetKey),
    index('config_validators_active_idx').on(table.isActive),
    index('config_validators_priority_idx').on(table.priority),
  ]
);

// ============================================================================
// Relations
// ============================================================================

export const configSchemasRelations = relations(configSchemas, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [configSchemas.repositoryId],
    references: [repositories.id],
  }),
  organization: one(organizations, {
    fields: [configSchemas.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [configSchemas.createdBy],
    references: [users.id],
  }),
  configSets: many(configSets),
  validators: many(configValidators),
}));

export const configStoresRelations = relations(configStores, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [configStores.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [configStores.createdBy],
    references: [users.id],
  }),
  configSets: many(configSets),
}));

export const configSetsRelations = relations(configSets, ({ one, many }) => ({
  store: one(configStores, {
    fields: [configSets.storeId],
    references: [configStores.id],
  }),
  schema: one(configSchemas, {
    fields: [configSets.schemaId],
    references: [configSchemas.id],
  }),
  repository: one(repositories, {
    fields: [configSets.repositoryId],
    references: [repositories.id],
  }),
  organization: one(organizations, {
    fields: [configSets.organizationId],
    references: [organizations.id],
  }),
  parentSet: one(configSets, {
    fields: [configSets.parentSetId],
    references: [configSets.id],
    relationName: 'parentChild',
  }),
  childSets: many(configSets, { relationName: 'parentChild' }),
  createdByUser: one(users, {
    fields: [configSets.createdBy],
    references: [users.id],
  }),
  lockedByUser: one(users, {
    fields: [configSets.lockedBy],
    references: [users.id],
  }),
  values: many(configValues),
  accessTokens: many(configAccessTokens),
  exports: many(configExports),
  history: many(configValueHistory),
}));

export const configValuesRelations = relations(configValues, ({ one, many }) => ({
  configSet: one(configSets, {
    fields: [configValues.configSetId],
    references: [configSets.id],
  }),
  createdByUser: one(users, {
    fields: [configValues.createdBy],
    references: [users.id],
  }),
  lastUpdatedByUser: one(users, {
    fields: [configValues.lastUpdatedBy],
    references: [users.id],
  }),
  history: many(configValueHistory),
}));

export const configValueHistoryRelations = relations(configValueHistory, ({ one }) => ({
  configValue: one(configValues, {
    fields: [configValueHistory.configValueId],
    references: [configValues.id],
  }),
  configSet: one(configSets, {
    fields: [configValueHistory.configSetId],
    references: [configSets.id],
  }),
  changedByUser: one(users, {
    fields: [configValueHistory.changedBy],
    references: [users.id],
  }),
}));

export const configAccessTokensRelations = relations(configAccessTokens, ({ one }) => ({
  configSet: one(configSets, {
    fields: [configAccessTokens.configSetId],
    references: [configSets.id],
  }),
  createdByUser: one(users, {
    fields: [configAccessTokens.createdBy],
    references: [users.id],
  }),
}));

export const configExportsRelations = relations(configExports, ({ one }) => ({
  configSet: one(configSets, {
    fields: [configExports.configSetId],
    references: [configSets.id],
  }),
  createdByUser: one(users, {
    fields: [configExports.createdBy],
    references: [users.id],
  }),
}));

export const configValidatorsRelations = relations(configValidators, ({ one }) => ({
  schema: one(configSchemas, {
    fields: [configValidators.schemaId],
    references: [configSchemas.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type ConfigSchema = typeof configSchemas.$inferSelect;
export type NewConfigSchema = typeof configSchemas.$inferInsert;

export type ConfigStore = typeof configStores.$inferSelect;
export type NewConfigStore = typeof configStores.$inferInsert;

export type ConfigSet = typeof configSets.$inferSelect;
export type NewConfigSet = typeof configSets.$inferInsert;

export type ConfigValue = typeof configValues.$inferSelect;
export type NewConfigValue = typeof configValues.$inferInsert;

export type ConfigValueHistoryEntry = typeof configValueHistory.$inferSelect;
export type NewConfigValueHistoryEntry = typeof configValueHistory.$inferInsert;

export type ConfigAccessToken = typeof configAccessTokens.$inferSelect;
export type NewConfigAccessToken = typeof configAccessTokens.$inferInsert;

export type ConfigExport = typeof configExports.$inferSelect;
export type NewConfigExport = typeof configExports.$inferInsert;

export type ConfigValidator = typeof configValidators.$inferSelect;
export type NewConfigValidator = typeof configValidators.$inferInsert;

export type ConfigStoreType = typeof configStoreTypeEnum.enumValues[number];
export type ConfigValueType = typeof configValueTypeEnum.enumValues[number];
export type ConfigScope = typeof configScopeEnum.enumValues[number];
export type ConfigValidatorType = typeof configValidatorTypeEnum.enumValues[number];
export type ConfigExportFormat = typeof configExportFormatEnum.enumValues[number];
export type ConfigTokenPermission = typeof configTokenPermissionEnum.enumValues[number];
