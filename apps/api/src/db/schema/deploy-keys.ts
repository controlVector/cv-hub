import { pgTable, uuid, varchar, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositories } from './repositories';

// ============================================================================
// Deploy Keys
// ============================================================================

export const deployKeys = pgTable('deploy_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  // Key metadata
  title: varchar('title', { length: 255 }).notNull(),
  publicKey: varchar('public_key', { length: 2048 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  keyType: varchar('key_type', { length: 32 }),

  // Access control
  readOnly: boolean('read_only').default(true).notNull(),

  // Usage tracking
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('deploy_keys_fingerprint_idx').on(table.fingerprint),
  index('deploy_keys_repo_id_idx').on(table.repositoryId),
]);

// ============================================================================
// Relations
// ============================================================================

export const deployKeysRelations = relations(deployKeys, ({ one }) => ({
  repository: one(repositories, {
    fields: [deployKeys.repositoryId],
    references: [repositories.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type DeployKey = typeof deployKeys.$inferSelect;
export type NewDeployKey = typeof deployKeys.$inferInsert;
