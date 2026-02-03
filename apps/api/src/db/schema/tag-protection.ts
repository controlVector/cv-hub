import { pgTable, uuid, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositories } from './repositories';
import { users } from './users';

// ============================================================================
// Tag Protection Rules
// ============================================================================

export const tagProtectionRules = pgTable('tag_protection_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  // Pattern for matching tags (e.g., 'v*', 'release-*')
  pattern: varchar('pattern', { length: 255 }).notNull(),

  // Whether admins can bypass this protection
  allowAdminOverride: boolean('allow_admin_override').default(true).notNull(),

  // Who created this rule
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('tag_protection_rules_repo_id_idx').on(table.repositoryId),
]);

// ============================================================================
// Relations
// ============================================================================

export const tagProtectionRulesRelations = relations(tagProtectionRules, ({ one }) => ({
  repository: one(repositories, {
    fields: [tagProtectionRules.repositoryId],
    references: [repositories.id],
  }),
  creator: one(users, {
    fields: [tagProtectionRules.createdBy],
    references: [users.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type TagProtectionRule = typeof tagProtectionRules.$inferSelect;
export type NewTagProtectionRule = typeof tagProtectionRules.$inferInsert;
