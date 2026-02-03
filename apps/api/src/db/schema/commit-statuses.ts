import { pgTable, uuid, varchar, text, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositories } from './repositories';
import { users } from './users';

// ============================================================================
// Enums
// ============================================================================

export const statusCheckStateEnum = pgEnum('status_check_state', [
  'pending',
  'success',
  'failure',
  'error',
]);

// ============================================================================
// Commit Statuses
// ============================================================================

export const commitStatuses = pgTable('commit_statuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  // The commit SHA this status applies to
  sha: varchar('sha', { length: 40 }).notNull(),

  // Status info
  state: statusCheckStateEnum('state').default('pending').notNull(),
  context: varchar('context', { length: 255 }).default('default').notNull(), // e.g., "ci/tests", "ci/lint"
  description: varchar('description', { length: 255 }),
  targetUrl: text('target_url'), // Link to CI build details

  // Creator (user or token-authenticated CI system)
  creatorId: uuid('creator_id').references(() => users.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('commit_statuses_repo_sha_idx').on(table.repositoryId, table.sha),
  index('commit_statuses_repo_sha_context_idx').on(table.repositoryId, table.sha, table.context),
  index('commit_statuses_state_idx').on(table.state),
  index('commit_statuses_created_at_idx').on(table.createdAt),
]);

// ============================================================================
// Relations
// ============================================================================

export const commitStatusesRelations = relations(commitStatuses, ({ one }) => ({
  repository: one(repositories, {
    fields: [commitStatuses.repositoryId],
    references: [repositories.id],
  }),
  creator: one(users, {
    fields: [commitStatuses.creatorId],
    references: [users.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type CommitStatus = typeof commitStatuses.$inferSelect;
export type NewCommitStatus = typeof commitStatuses.$inferInsert;
export type StatusCheckState = typeof statusCheckStateEnum.enumValues[number];
