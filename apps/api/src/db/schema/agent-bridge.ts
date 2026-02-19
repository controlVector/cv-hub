import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  pgEnum,
  integer,
  jsonb,
  uniqueIndex,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { repositories } from './repositories';
import { oauthClients } from './oauth';

// ============================================================================
// Enums
// ============================================================================

export const agentTaskStatusEnum = pgEnum('agent_task_status', [
  'pending',
  'queued',
  'assigned',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const agentTaskTypeEnum = pgEnum('agent_task_type', [
  'code_change',
  'review',
  'debug',
  'research',
  'deploy',
  'test',
  'custom',
]);

export const agentTaskPriorityEnum = pgEnum('agent_task_priority', [
  'low',
  'medium',
  'high',
  'critical',
]);

export const executorTypeEnum = pgEnum('executor_type', [
  'claude_code',
  'cv_git',
  'custom',
]);

export const executorStatusEnum = pgEnum('executor_status', [
  'online',
  'offline',
  'busy',
  'error',
]);

export const threadStatusEnum = pgEnum('thread_status', [
  'active',
  'paused',
  'completed',
  'archived',
]);

export const segmentPlatformEnum = pgEnum('segment_platform', [
  'claude_ai',
  'claude_code',
  'cv_hub_api',
]);

export const segmentTypeEnum = pgEnum('segment_type', [
  'planning',
  'execution',
  'review',
  'research',
  'debugging',
]);

export const edgeTypeEnum = pgEnum('edge_type', [
  'continuation',
  'fork',
  'merge',
  'handoff',
]);

export const bridgeTypeEnum = pgEnum('bridge_type', [
  'task_dispatch',
  'result_return',
  'context_share',
  'handoff',
]);

export const bridgeStatusEnum = pgEnum('bridge_status', [
  'pending',
  'accepted',
  'rejected',
  'expired',
]);

export const mcpTransportEnum = pgEnum('mcp_transport', [
  'streamable_http',
  'sse',
]);

export const mcpSessionStatusEnum = pgEnum('mcp_session_status', [
  'active',
  'closed',
  'expired',
]);

// ============================================================================
// Type Definitions (for JSONB columns)
// ============================================================================

export interface TaskInput {
  description?: string;
  context?: string;
  files?: string[];
  instructions?: string[];
  constraints?: string[];
  [key: string]: unknown;
}

export interface TaskResult {
  summary?: string;
  filesModified?: string[];
  filesCreated?: string[];
  output?: string;
  artifacts?: { name: string; path: string; type: string }[];
  [key: string]: unknown;
}

export interface ExecutorCapabilities {
  languages?: string[];
  tools?: string[];
  maxConcurrentTasks?: number;
  supportsDocker?: boolean;
  [key: string]: unknown;
}

export interface ContextSnapshot {
  activeFiles?: string[];
  currentBranch?: string;
  recentCommits?: string[];
  openTasks?: string[];
  keyDecisions?: string[];
  environment?: Record<string, string>;
  [key: string]: unknown;
}

export interface BridgePayload {
  summary?: string;
  context?: string;
  decisions?: string[];
  artifacts?: { name: string; content: string }[];
  taskIds?: string[];
  [key: string]: unknown;
}

// ============================================================================
// Agent Executors (Registered Claude Code / CV-Git Instances)
// ============================================================================

export const agentExecutors = pgTable(
  'agent_executors',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 100 }).notNull(),
    type: executorTypeEnum('type').default('claude_code').notNull(),
    status: executorStatusEnum('status').default('offline').notNull(),

    capabilities: jsonb('capabilities').$type<ExecutorCapabilities>(),
    workspaceRoot: text('workspace_root'),

    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'set null',
    }),

    registrationToken: varchar('registration_token', { length: 64 }),

    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    lastTaskAt: timestamp('last_task_at', { withTimezone: true }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('agent_executors_user_id_idx').on(table.userId),
    index('agent_executors_status_idx').on(table.status),
    index('agent_executors_type_idx').on(table.type),
    index('agent_executors_repo_idx').on(table.repositoryId),
  ]
);

// ============================================================================
// Workflow Threads (Top-Level Thread Grouping)
// ============================================================================

export const workflowThreads = pgTable(
  'workflow_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),

    status: threadStatusEnum('status').default('active').notNull(),

    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'set null',
    }),

    totalSegments: integer('total_segments').default(0).notNull(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('workflow_threads_user_id_idx').on(table.userId),
    index('workflow_threads_status_idx').on(table.status),
    index('workflow_threads_repo_idx').on(table.repositoryId),
  ]
);

// ============================================================================
// Thread Segments (Individual Segments Within Threads)
// ============================================================================

export const threadSegments = pgTable(
  'thread_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    threadId: uuid('thread_id')
      .notNull()
      .references(() => workflowThreads.id, { onDelete: 'cascade' }),

    platform: segmentPlatformEnum('platform').notNull(),
    sessionIdentifier: varchar('session_identifier', { length: 255 }),

    segmentType: segmentTypeEnum('segment_type').default('execution').notNull(),
    title: varchar('title', { length: 255 }),
    summary: text('summary'),

    contextSnapshot: jsonb('context_snapshot').$type<ContextSnapshot>(),
    resultSnapshot: jsonb('result_snapshot').$type<ContextSnapshot>(),
    toolsUsed: jsonb('tools_used').$type<string[]>(),
    filesModified: jsonb('files_modified').$type<string[]>(),

    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('thread_segments_thread_id_idx').on(table.threadId),
    index('thread_segments_platform_idx').on(table.platform),
    index('thread_segments_session_idx').on(table.sessionIdentifier),
    index('thread_segments_type_idx').on(table.segmentType),
  ]
);

// ============================================================================
// Thread Segment Edges (DAG Edges Between Segments)
// ============================================================================

export const threadSegmentEdges = pgTable(
  'thread_segment_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    threadId: uuid('thread_id')
      .notNull()
      .references(() => workflowThreads.id, { onDelete: 'cascade' }),

    fromSegmentId: uuid('from_segment_id')
      .notNull()
      .references(() => threadSegments.id, { onDelete: 'cascade' }),

    toSegmentId: uuid('to_segment_id')
      .notNull()
      .references(() => threadSegments.id, { onDelete: 'cascade' }),

    edgeType: edgeTypeEnum('edge_type').default('continuation').notNull(),

    bridgeId: uuid('bridge_id').references(() => contextBridges.id, {
      onDelete: 'set null',
    }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('thread_segment_edges_thread_idx').on(table.threadId),
    index('thread_segment_edges_from_idx').on(table.fromSegmentId),
    index('thread_segment_edges_to_idx').on(table.toSegmentId),
    unique('thread_segment_edges_unique').on(
      table.fromSegmentId,
      table.toSegmentId,
      table.edgeType
    ),
  ]
);

// ============================================================================
// Context Bridges (Cross-Platform Context Snapshots)
// ============================================================================

export const contextBridges = pgTable(
  'context_bridges',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    threadId: uuid('thread_id')
      .notNull()
      .references(() => workflowThreads.id, { onDelete: 'cascade' }),

    fromSegmentId: uuid('from_segment_id')
      .notNull()
      .references(() => threadSegments.id, { onDelete: 'cascade' }),

    toSegmentId: uuid('to_segment_id').references(() => threadSegments.id, {
      onDelete: 'set null',
    }),

    bridgeType: bridgeTypeEnum('bridge_type')
      .default('context_share')
      .notNull(),

    contextPayload: jsonb('context_payload').$type<BridgePayload>().notNull(),

    status: bridgeStatusEnum('status').default('pending').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('context_bridges_thread_idx').on(table.threadId),
    index('context_bridges_from_segment_idx').on(table.fromSegmentId),
    index('context_bridges_status_idx').on(table.status),
  ]
);

// ============================================================================
// Agent Tasks (Task Relay Between Platforms)
// ============================================================================

export const agentTasks = pgTable(
  'agent_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    executorId: uuid('executor_id').references(() => agentExecutors.id, {
      onDelete: 'set null',
    }),

    threadId: uuid('thread_id').references(() => workflowThreads.id, {
      onDelete: 'set null',
    }),

    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),

    taskType: agentTaskTypeEnum('task_type').default('custom').notNull(),
    status: agentTaskStatusEnum('status').default('pending').notNull(),
    priority: agentTaskPriorityEnum('priority').default('medium').notNull(),

    input: jsonb('input').$type<TaskInput>(),
    result: jsonb('result').$type<TaskResult>(),
    error: text('error'),

    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'set null',
    }),
    branch: varchar('branch', { length: 255 }),
    filePaths: jsonb('file_paths').$type<string[]>(),

    mcpSessionId: uuid('mcp_session_id').references(() => mcpSessions.id, {
      onDelete: 'set null',
    }),

    parentTaskId: uuid('parent_task_id'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    timeoutAt: timestamp('timeout_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('agent_tasks_user_id_idx').on(table.userId),
    index('agent_tasks_executor_id_idx').on(table.executorId),
    index('agent_tasks_thread_id_idx').on(table.threadId),
    index('agent_tasks_status_idx').on(table.status),
    index('agent_tasks_priority_idx').on(table.priority),
    index('agent_tasks_repo_idx').on(table.repositoryId),
    index('agent_tasks_mcp_session_idx').on(table.mcpSessionId),
    index('agent_tasks_parent_idx').on(table.parentTaskId),
  ]
);

// ============================================================================
// MCP Sessions (Streamable HTTP Session Tracking)
// ============================================================================

export const mcpSessions = pgTable(
  'mcp_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    sessionToken: varchar('session_token', { length: 128 }).notNull().unique(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    clientId: uuid('client_id').references(() => oauthClients.id, {
      onDelete: 'set null',
    }),

    transport: mcpTransportEnum('transport')
      .default('streamable_http')
      .notNull(),
    status: mcpSessionStatusEnum('status').default('active').notNull(),

    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('mcp_sessions_token_idx').on(table.sessionToken),
    index('mcp_sessions_user_id_idx').on(table.userId),
    index('mcp_sessions_status_idx').on(table.status),
    index('mcp_sessions_expires_idx').on(table.expiresAt),
  ]
);

// ============================================================================
// Relations
// ============================================================================

export const agentExecutorsRelations = relations(
  agentExecutors,
  ({ one, many }) => ({
    user: one(users, {
      fields: [agentExecutors.userId],
      references: [users.id],
    }),
    repository: one(repositories, {
      fields: [agentExecutors.repositoryId],
      references: [repositories.id],
    }),
    tasks: many(agentTasks),
  })
);

export const workflowThreadsRelations = relations(
  workflowThreads,
  ({ one, many }) => ({
    user: one(users, {
      fields: [workflowThreads.userId],
      references: [users.id],
    }),
    repository: one(repositories, {
      fields: [workflowThreads.repositoryId],
      references: [repositories.id],
    }),
    segments: many(threadSegments),
    edges: many(threadSegmentEdges),
    bridges: many(contextBridges),
    tasks: many(agentTasks),
  })
);

export const threadSegmentsRelations = relations(
  threadSegments,
  ({ one, many }) => ({
    thread: one(workflowThreads, {
      fields: [threadSegments.threadId],
      references: [workflowThreads.id],
    }),
    outgoingEdges: many(threadSegmentEdges, { relationName: 'fromSegment' }),
    incomingEdges: many(threadSegmentEdges, { relationName: 'toSegment' }),
    outgoingBridges: many(contextBridges, { relationName: 'fromBridge' }),
    incomingBridges: many(contextBridges, { relationName: 'toBridge' }),
  })
);

export const threadSegmentEdgesRelations = relations(
  threadSegmentEdges,
  ({ one }) => ({
    thread: one(workflowThreads, {
      fields: [threadSegmentEdges.threadId],
      references: [workflowThreads.id],
    }),
    fromSegment: one(threadSegments, {
      fields: [threadSegmentEdges.fromSegmentId],
      references: [threadSegments.id],
      relationName: 'fromSegment',
    }),
    toSegment: one(threadSegments, {
      fields: [threadSegmentEdges.toSegmentId],
      references: [threadSegments.id],
      relationName: 'toSegment',
    }),
    bridge: one(contextBridges, {
      fields: [threadSegmentEdges.bridgeId],
      references: [contextBridges.id],
    }),
  })
);

export const contextBridgesRelations = relations(
  contextBridges,
  ({ one }) => ({
    thread: one(workflowThreads, {
      fields: [contextBridges.threadId],
      references: [workflowThreads.id],
    }),
    fromSegment: one(threadSegments, {
      fields: [contextBridges.fromSegmentId],
      references: [threadSegments.id],
      relationName: 'fromBridge',
    }),
    toSegment: one(threadSegments, {
      fields: [contextBridges.toSegmentId],
      references: [threadSegments.id],
      relationName: 'toBridge',
    }),
  })
);

export const agentTasksRelations = relations(agentTasks, ({ one }) => ({
  user: one(users, {
    fields: [agentTasks.userId],
    references: [users.id],
  }),
  executor: one(agentExecutors, {
    fields: [agentTasks.executorId],
    references: [agentExecutors.id],
  }),
  thread: one(workflowThreads, {
    fields: [agentTasks.threadId],
    references: [workflowThreads.id],
  }),
  repository: one(repositories, {
    fields: [agentTasks.repositoryId],
    references: [repositories.id],
  }),
  mcpSession: one(mcpSessions, {
    fields: [agentTasks.mcpSessionId],
    references: [mcpSessions.id],
  }),
  parentTask: one(agentTasks, {
    fields: [agentTasks.parentTaskId],
    references: [agentTasks.id],
  }),
}));

export const mcpSessionsRelations = relations(
  mcpSessions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [mcpSessions.userId],
      references: [users.id],
    }),
    client: one(oauthClients, {
      fields: [mcpSessions.clientId],
      references: [oauthClients.id],
    }),
    tasks: many(agentTasks),
  })
);

// ============================================================================
// Type Exports
// ============================================================================

export type AgentExecutor = typeof agentExecutors.$inferSelect;
export type NewAgentExecutor = typeof agentExecutors.$inferInsert;

export type WorkflowThread = typeof workflowThreads.$inferSelect;
export type NewWorkflowThread = typeof workflowThreads.$inferInsert;

export type ThreadSegment = typeof threadSegments.$inferSelect;
export type NewThreadSegment = typeof threadSegments.$inferInsert;

export type ThreadSegmentEdge = typeof threadSegmentEdges.$inferSelect;
export type NewThreadSegmentEdge = typeof threadSegmentEdges.$inferInsert;

export type ContextBridge = typeof contextBridges.$inferSelect;
export type NewContextBridge = typeof contextBridges.$inferInsert;

export type AgentTask = typeof agentTasks.$inferSelect;
export type NewAgentTask = typeof agentTasks.$inferInsert;

export type McpSession = typeof mcpSessions.$inferSelect;
export type NewMcpSession = typeof mcpSessions.$inferInsert;
