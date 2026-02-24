/**
 * Repository Summaries Schema
 * Stores AI-generated summaries at repository level
 * File/symbol summaries are stored as FalkorDB node properties
 */

import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { repositories } from './repositories';

export const repositorySummaries = pgTable('repository_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  // Summary content
  summary: text('summary').notNull(),
  technologies: jsonb('technologies').$type<string[]>().default([]),
  entryPoints: jsonb('entry_points').$type<string[]>().default([]),
  keyPatterns: jsonb('key_patterns').$type<string[]>().default([]),

  // Generation metadata
  model: varchar('model', { length: 100 }).notNull(),
  promptTokens: integer('prompt_tokens').default(0),
  completionTokens: integer('completion_tokens').default(0),
  graphSyncJobId: uuid('graph_sync_job_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  repoIdx: uniqueIndex('repository_summaries_repo_idx').on(table.repositoryId),
}));

export type RepositorySummary = typeof repositorySummaries.$inferSelect;
export type NewRepositorySummary = typeof repositorySummaries.$inferInsert;
