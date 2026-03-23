/**
 * Context Versions Schema
 * Stores context manifold snapshots keyed by repository + commit SHA.
 * Each row captures the full state of project knowledge (decisions, goals,
 * constraints, architecture, etc.) at a specific point in time.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { repositories } from './repositories';

export const contextVersions = pgTable(
  'context_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),

    /** Git commit SHA this snapshot corresponds to */
    commitSha: varchar('commit_sha', { length: 40 }).notNull(),

    /** Serialized context nodes (AnyContextNode[]) */
    nodes: jsonb('nodes').$type<unknown[]>().notNull().default([]),

    /** Serialized context edges (ContextEdge[]) */
    edges: jsonb('edges').$type<unknown[]>().notNull().default([]),

    /** Number of nodes in this snapshot */
    nodeCount: integer('node_count').notNull().default(0),

    /** Human-readable summary of changes from previous version */
    changesSummary: text('changes_summary'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('context_versions_repo_idx').on(table.repositoryId),
    index('context_versions_commit_idx').on(table.commitSha),
    uniqueIndex('context_versions_repo_commit_idx').on(table.repositoryId, table.commitSha),
  ],
);

export const contextVersionsRelations = relations(contextVersions, ({ one }) => ({
  repository: one(repositories, {
    fields: [contextVersions.repositoryId],
    references: [repositories.id],
  }),
}));

export type ContextVersionRow = typeof contextVersions.$inferSelect;
export type NewContextVersionRow = typeof contextVersions.$inferInsert;
