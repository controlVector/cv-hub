/**
 * Context Engine Sessions Schema
 * Tracks per-session state for the context engine (injected files/symbols,
 * compaction checkpoints, active concern).
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
import { users } from './users';
import { repositories } from './repositories';
import { agentExecutors } from './agent-bridge';

export const contextEngineSessions = pgTable(
  'context_engine_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    sessionId: varchar('session_id', { length: 128 }).notNull(),

    executorId: uuid('executor_id').references(() => agentExecutors.id, {
      onDelete: 'set null',
    }),

    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    activeConcern: varchar('active_concern', { length: 50 }).default('codebase').notNull(),

    lastTurnCount: integer('last_turn_count').default(0).notNull(),
    lastTokenEst: integer('last_token_est').default(0).notNull(),

    injectedFiles: jsonb('injected_files').$type<string[]>().default([]),
    injectedSymbols: jsonb('injected_symbols').$type<string[]>().default([]),

    checkpointSummary: text('checkpoint_summary'),
    checkpointFiles: jsonb('checkpoint_files').$type<string[]>(),
    checkpointSymbols: jsonb('checkpoint_symbols').$type<string[]>(),

    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('context_engine_sessions_session_repo_idx').on(
      table.sessionId,
      table.repositoryId,
    ),
    index('context_engine_sessions_user_idx').on(table.userId),
    index('context_engine_sessions_repo_idx').on(table.repositoryId),
    index('context_engine_sessions_executor_idx').on(table.executorId),
  ],
);

export const contextEngineSessionsRelations = relations(
  contextEngineSessions,
  ({ one }) => ({
    user: one(users, {
      fields: [contextEngineSessions.userId],
      references: [users.id],
    }),
    repository: one(repositories, {
      fields: [contextEngineSessions.repositoryId],
      references: [repositories.id],
    }),
    executor: one(agentExecutors, {
      fields: [contextEngineSessions.executorId],
      references: [agentExecutors.id],
    }),
  }),
);

export type ContextEngineSession = typeof contextEngineSessions.$inferSelect;
export type NewContextEngineSession = typeof contextEngineSessions.$inferInsert;
