import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  bigint,
  pgEnum,
  integer,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { repositories } from './repositories';
import { organizations } from './organizations';

// ============================================================================
// Enums
// ============================================================================

export const pipelineTriggerEnum = pgEnum('pipeline_trigger', [
  'push',
  'pull_request',
  'schedule',
  'manual',
  'api',
  'tag',
  'release',
  'workflow_call',
]);

export const pipelineRunStatusEnum = pgEnum('pipeline_run_status', [
  'pending',
  'running',
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'queued',
  'running',
  'success',
  'failure',
  'cancelled',
  'skipped',
]);

export const runnerStatusEnum = pgEnum('runner_status', [
  'offline',
  'idle',
  'busy',
  'maintenance',
  'draining',
]);

export const runnerTypeEnum = pgEnum('runner_type', [
  'hosted',
  'self-hosted',
  'ephemeral',
]);

export const artifactTypeEnum = pgEnum('artifact_type', [
  'build',
  'test',
  'logs',
  'cache',
  'report',
]);

export const secretScopeEnum = pgEnum('secret_scope', [
  'repository',
  'organization',
  'environment',
]);

// ============================================================================
// Type Definitions (for JSONB columns)
// ============================================================================

export interface PipelineDefinition {
  version: string;
  name: string;
  env?: Record<string, string>;
  stages: PipelineStage[];
  on?: {
    push?: { branches?: string[]; tags?: string[]; paths?: string[] };
    pull_request?: { branches?: string[]; paths?: string[] };
    schedule?: { cron: string }[];
    workflow_dispatch?: { inputs?: Record<string, WorkflowInput> };
  };
}

export interface PipelineStage {
  name: string;
  jobs: PipelineJobDef[];
}

export interface PipelineJobDef {
  name: string;
  key: string;
  runsOn?: string | string[];
  container?: { image: string; env?: Record<string, string> };
  needs?: string[];
  if?: string;
  env?: Record<string, string>;
  steps: JobStep[];
  outputs?: Record<string, string>;
  timeout?: number;
  retries?: number;
  services?: Record<string, ServiceDef>;
}

export interface ServiceDef {
  image: string;
  env?: Record<string, string>;
  ports?: number[];
}

export interface JobStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  workingDirectory?: string;
  shell?: string;
  timeout?: number;
  continueOnError?: boolean;
}

export interface StepResult {
  name: string;
  status: 'success' | 'failure' | 'skipped' | 'cancelled';
  exitCode?: number;
  output?: string;
  error?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface WorkflowInput {
  description?: string;
  required?: boolean;
  default?: string;
  type?: 'string' | 'boolean' | 'choice';
  options?: string[];
}

export interface RunnerCapabilities {
  os: string;
  arch: string;
  docker: boolean;
  gpu?: boolean;
  memory?: number;
  cpus?: number;
  labels: string[];
}

export interface RunContext {
  ref: string;
  sha: string;
  branch?: string;
  tag?: string;
  actor: string;
  actorId?: string;
  event: string;
  repository: {
    id: string;
    name: string;
    owner: string;
    defaultBranch?: string;
  };
  pullRequest?: {
    number: number;
    head: string;
    base: string;
    title?: string;
  };
  inputs?: Record<string, string>;
}

export interface AIFailureAnalysis {
  summary: string;
  rootCause: string;
  category: 'build' | 'test' | 'dependency' | 'config' | 'infrastructure' | 'unknown';
  confidence: number;
  relatedLogs: string[];
  similarFailures?: { runId: string; similarity: number }[];
}

export interface AISuggestedFix {
  title: string;
  description: string;
  confidence: number;
  codeChanges?: { file: string; diff: string }[];
  commands?: string[];
  docsUrl?: string;
}

export interface AIPerformanceInsight {
  type: 'slow_step' | 'cache_miss' | 'parallel_opportunity' | 'resource_waste';
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  suggestion: string;
}

export interface AISuggestion {
  type: string;
  title: string;
  description: string;
  priority: number;
}

export interface AIStepSuggestion {
  stepName: string;
  suggestion: string;
  reason: string;
}

export interface RepoAnalysis {
  languages: { name: string; percentage: number }[];
  frameworks: string[];
  packageManagers: string[];
  hasTests: boolean;
  testFrameworks: string[];
  buildTools: string[];
  deploymentTargets: string[];
}

export interface AlternativePipeline {
  name: string;
  description: string;
  yaml: string;
}

// ============================================================================
// Pipelines (Workflow Definitions)
// ============================================================================

export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),

    // Identity
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),

    // Definition source
    filePath: varchar('file_path', { length: 500 })
      .default('.cv-hub/pipeline.yaml')
      .notNull(),
    definitionFormat: varchar('definition_format', { length: 20 })
      .default('yaml')
      .notNull(),

    // Parsed/compiled definition (JSON)
    definition: jsonb('definition').notNull().$type<PipelineDefinition>(),
    definitionHash: varchar('definition_hash', { length: 64 }).notNull(),

    // AI-generated metadata
    aiGeneratedDescription: text('ai_generated_description'),
    aiSuggestedOptimizations: jsonb('ai_suggested_optimizations').$type<
      AISuggestion[]
    >(),

    // Status
    isActive: boolean('is_active').default(true).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),

    // Stats
    totalRuns: integer('total_runs').default(0).notNull(),
    successfulRuns: integer('successful_runs').default(0).notNull(),
    failedRuns: integer('failed_runs').default(0).notNull(),
    avgDurationMs: integer('avg_duration_ms'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('pipelines_repo_slug_idx').on(table.repositoryId, table.slug),
    index('pipelines_repo_active_idx').on(table.repositoryId, table.isActive),
    index('pipelines_last_run_idx').on(table.lastRunAt),
  ]
);

// ============================================================================
// Pipeline Runs (Execution Instances)
// ============================================================================

export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),

    // Run number (per pipeline)
    number: integer('number').notNull(),

    // Trigger info
    trigger: pipelineTriggerEnum('trigger').notNull(),
    triggeredBy: uuid('triggered_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    triggerRef: varchar('trigger_ref', { length: 255 }),
    triggerSha: varchar('trigger_sha', { length: 40 }),

    // PR info (if triggered by PR)
    pullRequestNumber: integer('pull_request_number'),

    // Status
    status: pipelineRunStatusEnum('status').default('pending').notNull(),
    conclusion: varchar('conclusion', { length: 50 }),

    // Timing
    queuedAt: timestamp('queued_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),

    // AI Analysis
    aiFailureAnalysis: jsonb('ai_failure_analysis').$type<AIFailureAnalysis>(),
    aiSuggestedFixes: jsonb('ai_suggested_fixes').$type<AISuggestedFix[]>(),
    aiPerformanceInsights: jsonb('ai_performance_insights').$type<
      AIPerformanceInsight[]
    >(),

    // Error tracking
    errorMessage: text('error_message'),
    errorDetails: jsonb('error_details'),

    // Context (frozen at run time)
    contextSnapshot: jsonb('context_snapshot').$type<RunContext>(),

    // Workflow inputs (for manual triggers)
    workflowInputs: jsonb('workflow_inputs').$type<Record<string, string>>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('pipeline_runs_pipeline_number_idx').on(
      table.pipelineId,
      table.number
    ),
    index('pipeline_runs_repo_idx').on(table.repositoryId),
    index('pipeline_runs_status_idx').on(table.status),
    index('pipeline_runs_trigger_idx').on(table.trigger),
    index('pipeline_runs_queued_at_idx').on(table.queuedAt),
    index('pipeline_runs_trigger_sha_idx').on(table.triggerSha),
  ]
);

// ============================================================================
// Pipeline Jobs (Steps within Runs)
// ============================================================================

export const pipelineJobs = pgTable(
  'pipeline_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),

    // Job identity
    name: varchar('name', { length: 100 }).notNull(),
    jobKey: varchar('job_key', { length: 100 }).notNull(),

    // Execution order
    stageIndex: integer('stage_index').default(0).notNull(),
    jobIndex: integer('job_index').default(0).notNull(),

    // Dependencies
    dependsOn: jsonb('depends_on').$type<string[]>().default([]),

    // Runner assignment
    runnerId: uuid('runner_id').references(() => runners.id, {
      onDelete: 'set null',
    }),
    runnerName: varchar('runner_name', { length: 100 }),

    // Status
    status: jobStatusEnum('status').default('pending').notNull(),
    exitCode: integer('exit_code'),

    // Timing
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),

    // Execution context
    containerImage: varchar('container_image', { length: 500 }),
    environment: jsonb('environment').$type<Record<string, string>>().default({}),

    // Step definitions and outputs
    steps: jsonb('steps').$type<JobStep[]>(),
    stepResults: jsonb('step_results').$type<StepResult[]>(),

    // Outputs (for downstream jobs)
    outputs: jsonb('outputs').$type<Record<string, string>>().default({}),

    // AI assistance
    aiStepSuggestions: jsonb('ai_step_suggestions').$type<AIStepSuggestion[]>(),

    // Logs location
    logsPath: text('logs_path'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('pipeline_jobs_run_key_idx').on(table.runId, table.jobKey),
    index('pipeline_jobs_run_idx').on(table.runId),
    index('pipeline_jobs_status_idx').on(table.status),
    index('pipeline_jobs_runner_idx').on(table.runnerId),
  ]
);

// ============================================================================
// Runners (Execution Agents)
// ============================================================================

export const runners = pgTable(
  'runners',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Ownership (null = global hosted runner)
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),

    // Identity
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),

    // Type
    type: runnerTypeEnum('type').default('hosted').notNull(),

    // Status
    status: runnerStatusEnum('status').default('offline').notNull(),

    // Registration
    registrationToken: varchar('registration_token', { length: 64 }),
    registeredAt: timestamp('registered_at', { withTimezone: true }),

    // Capabilities
    labels: jsonb('labels').$type<string[]>().default([]),
    capabilities: jsonb('capabilities').$type<RunnerCapabilities>(),

    // Runtime info
    os: varchar('os', { length: 50 }),
    arch: varchar('arch', { length: 20 }),
    version: varchar('version', { length: 20 }),

    // Current job
    currentJobId: uuid('current_job_id'),

    // Health
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    lastJobCompletedAt: timestamp('last_job_completed_at', {
      withTimezone: true,
    }),

    // Stats
    totalJobsRun: integer('total_jobs_run').default(0).notNull(),
    totalJobTime: bigint('total_job_time', { mode: 'number' }).default(0).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('runners_name_org_idx').on(table.name, table.organizationId),
    index('runners_status_idx').on(table.status),
    index('runners_type_idx').on(table.type),
    index('runners_org_idx').on(table.organizationId),
    index('runners_repo_idx').on(table.repositoryId),
  ]
);

// ============================================================================
// Artifacts (Build Outputs)
// ============================================================================

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => pipelineJobs.id, {
      onDelete: 'cascade',
    }),

    // Identity
    name: varchar('name', { length: 255 }).notNull(),
    type: artifactTypeEnum('type').default('build').notNull(),

    // Storage
    storagePath: text('storage_path').notNull(),
    downloadUrl: text('download_url'),

    // Metadata
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    fileHash: varchar('file_hash', { length: 64 }),
    mimeType: varchar('mime_type', { length: 100 }),
    fileCount: integer('file_count').default(1),

    // Retention
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    retainForever: boolean('retain_forever').default(false).notNull(),

    // Download tracking
    downloadCount: integer('download_count').default(0).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('artifacts_run_idx').on(table.runId),
    index('artifacts_job_idx').on(table.jobId),
    index('artifacts_type_idx').on(table.type),
    index('artifacts_expires_idx').on(table.expiresAt),
  ]
);

// ============================================================================
// CI Secrets (Encrypted Variables)
// ============================================================================

export const ciSecrets = pgTable(
  'ci_secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Scope
    scope: secretScopeEnum('scope').notNull(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),
    environmentName: varchar('environment_name', { length: 50 }),

    // Secret data
    name: varchar('name', { length: 100 }).notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    encryptionIv: varchar('encryption_iv', { length: 32 }).notNull(),

    // Metadata
    description: text('description'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    lastUpdatedBy: uuid('last_updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Usage tracking
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    usageCount: integer('usage_count').default(0).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('ci_secrets_scope_name_idx').on(
      table.scope,
      table.organizationId,
      table.repositoryId,
      table.environmentName,
      table.name
    ),
    index('ci_secrets_org_idx').on(table.organizationId),
    index('ci_secrets_repo_idx').on(table.repositoryId),
  ]
);

// ============================================================================
// CI Environments (Deployment Targets)
// ============================================================================

export const ciEnvironments = pgTable(
  'ci_environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 50 }).notNull(),
    description: text('description'),

    // Protection rules
    requireApproval: boolean('require_approval').default(false).notNull(),
    requiredReviewers: jsonb('required_reviewers').$type<string[]>().default([]),
    waitTimer: integer('wait_timer'),

    // Branch restrictions
    branchPatterns: jsonb('branch_patterns').$type<string[]>().default([]),

    // Deployment info
    lastDeployedAt: timestamp('last_deployed_at', { withTimezone: true }),
    lastDeployedRunId: uuid('last_deployed_run_id'),
    activeDeploymentUrl: text('active_deployment_url'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('ci_environments_repo_name_idx').on(
      table.repositoryId,
      table.name
    ),
  ]
);

// ============================================================================
// AI Pipeline Generations (Natural Language -> Pipeline)
// ============================================================================

export const aiPipelineGenerations = pgTable(
  'ai_pipeline_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Input
    prompt: text('prompt').notNull(),
    repoAnalysis: jsonb('repo_analysis').$type<RepoAnalysis>(),

    // Output
    generatedYaml: text('generated_yaml'),
    generatedDefinition: jsonb('generated_definition').$type<PipelineDefinition>(),

    // AI metadata
    model: varchar('model', { length: 100 }),
    confidence: integer('confidence'),
    reasoning: text('reasoning'),
    alternatives: jsonb('alternatives').$type<AlternativePipeline[]>(),

    // Feedback
    wasAccepted: boolean('was_accepted'),
    feedbackRating: integer('feedback_rating'),
    feedbackText: text('feedback_text'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('ai_pipeline_generations_repo_idx').on(table.repositoryId),
    index('ai_pipeline_generations_user_idx').on(table.userId),
  ]
);

// ============================================================================
// CI API Keys (for automation)
// ============================================================================

export const ciApiKeys = pgTable(
  'ci_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Ownership
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),

    // Key data
    name: varchar('name', { length: 100 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 10 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),

    // Permissions
    scopes: jsonb('scopes').$type<string[]>().default([]),

    // Status
    isActive: boolean('is_active').default(true).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Usage tracking
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    usageCount: integer('usage_count').default(0).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('ci_api_keys_hash_idx').on(table.keyHash),
    index('ci_api_keys_user_idx').on(table.userId),
    index('ci_api_keys_org_idx').on(table.organizationId),
    index('ci_api_keys_repo_idx').on(table.repositoryId),
  ]
);

// ============================================================================
// Relations
// ============================================================================

export const pipelinesRelations = relations(pipelines, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [pipelines.repositoryId],
    references: [repositories.id],
  }),
  runs: many(pipelineRuns),
}));

export const pipelineRunsRelations = relations(pipelineRuns, ({ one, many }) => ({
  pipeline: one(pipelines, {
    fields: [pipelineRuns.pipelineId],
    references: [pipelines.id],
  }),
  repository: one(repositories, {
    fields: [pipelineRuns.repositoryId],
    references: [repositories.id],
  }),
  triggeredByUser: one(users, {
    fields: [pipelineRuns.triggeredBy],
    references: [users.id],
  }),
  jobs: many(pipelineJobs),
  artifacts: many(artifacts),
}));

export const pipelineJobsRelations = relations(pipelineJobs, ({ one, many }) => ({
  run: one(pipelineRuns, {
    fields: [pipelineJobs.runId],
    references: [pipelineRuns.id],
  }),
  runner: one(runners, {
    fields: [pipelineJobs.runnerId],
    references: [runners.id],
  }),
  artifacts: many(artifacts),
}));

export const runnersRelations = relations(runners, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [runners.organizationId],
    references: [organizations.id],
  }),
  repository: one(repositories, {
    fields: [runners.repositoryId],
    references: [repositories.id],
  }),
  jobs: many(pipelineJobs),
}));

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  run: one(pipelineRuns, {
    fields: [artifacts.runId],
    references: [pipelineRuns.id],
  }),
  job: one(pipelineJobs, {
    fields: [artifacts.jobId],
    references: [pipelineJobs.id],
  }),
}));

export const ciSecretsRelations = relations(ciSecrets, ({ one }) => ({
  organization: one(organizations, {
    fields: [ciSecrets.organizationId],
    references: [organizations.id],
  }),
  repository: one(repositories, {
    fields: [ciSecrets.repositoryId],
    references: [repositories.id],
  }),
  createdByUser: one(users, {
    fields: [ciSecrets.createdBy],
    references: [users.id],
  }),
  lastUpdatedByUser: one(users, {
    fields: [ciSecrets.lastUpdatedBy],
    references: [users.id],
  }),
}));

export const ciEnvironmentsRelations = relations(ciEnvironments, ({ one }) => ({
  repository: one(repositories, {
    fields: [ciEnvironments.repositoryId],
    references: [repositories.id],
  }),
}));

export const aiPipelineGenerationsRelations = relations(
  aiPipelineGenerations,
  ({ one }) => ({
    repository: one(repositories, {
      fields: [aiPipelineGenerations.repositoryId],
      references: [repositories.id],
    }),
    user: one(users, {
      fields: [aiPipelineGenerations.userId],
      references: [users.id],
    }),
  })
);

export const ciApiKeysRelations = relations(ciApiKeys, ({ one }) => ({
  user: one(users, {
    fields: [ciApiKeys.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [ciApiKeys.organizationId],
    references: [organizations.id],
  }),
  repository: one(repositories, {
    fields: [ciApiKeys.repositoryId],
    references: [repositories.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type Pipeline = typeof pipelines.$inferSelect;
export type NewPipeline = typeof pipelines.$inferInsert;

export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type NewPipelineRun = typeof pipelineRuns.$inferInsert;

export type PipelineJob = typeof pipelineJobs.$inferSelect;
export type NewPipelineJob = typeof pipelineJobs.$inferInsert;

export type Runner = typeof runners.$inferSelect;
export type NewRunner = typeof runners.$inferInsert;

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;

export type CISecret = typeof ciSecrets.$inferSelect;
export type NewCISecret = typeof ciSecrets.$inferInsert;

export type CIEnvironment = typeof ciEnvironments.$inferSelect;
export type NewCIEnvironment = typeof ciEnvironments.$inferInsert;

export type AIPipelineGeneration = typeof aiPipelineGenerations.$inferSelect;
export type NewAIPipelineGeneration = typeof aiPipelineGenerations.$inferInsert;

export type CIApiKey = typeof ciApiKeys.$inferSelect;
export type NewCIApiKey = typeof ciApiKeys.$inferInsert;
