import { pgTable, uuid, varchar, text, boolean, timestamp, index, bigint, pgEnum, integer, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { organizations } from './organizations';

// ============================================================================
// Enums
// ============================================================================

export const repoVisibilityEnum = pgEnum('repo_visibility', [
  'public',    // Anyone can view
  'internal',  // Only org members
  'private',   // Only repo members
]);

export const repoProviderEnum = pgEnum('repo_provider', [
  'local',     // Self-hosted bare git repo
  'github',    // GitHub integration
  'gitlab',    // GitLab integration
]);

export const repoRoleEnum = pgEnum('repo_role', [
  'admin',     // Full control
  'write',     // Push access
  'read',      // Clone/pull only
]);

export const prStateEnum = pgEnum('pr_state', [
  'draft',     // Work in progress
  'open',      // Ready for review
  'closed',    // Closed without merge
  'merged',    // Merged to target
]);

export const issueStateEnum = pgEnum('issue_state', [
  'open',
  'closed',
]);

export const issuePriorityEnum = pgEnum('issue_priority', [
  'low',
  'medium',
  'high',
  'critical',
]);

export const reviewStateEnum = pgEnum('review_state', [
  'pending',
  'approved',
  'changes_requested',
  'commented',
  'dismissed',
]);

export const syncStatusEnum = pgEnum('sync_status', [
  'pending',   // Not yet started
  'syncing',   // In progress
  'synced',    // Complete
  'failed',    // Error occurred
  'stale',     // Needs re-sync
]);

// ============================================================================
// Repositories
// ============================================================================

export const repositories = pgTable('repositories', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Ownership (one of these must be set)
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // Personal repos

  // Identity
  name: varchar('name', { length: 100 }).notNull(), // e.g., "cv-git"
  slug: varchar('slug', { length: 100 }).notNull(), // URL-friendly, e.g., "cv-git"
  description: text('description'),

  // Visibility and access
  visibility: repoVisibilityEnum('visibility').default('public').notNull(),

  // Git provider configuration
  provider: repoProviderEnum('provider').default('local').notNull(),
  providerRepoId: varchar('provider_repo_id', { length: 255 }), // External ID for github/gitlab
  providerRepoUrl: text('provider_repo_url'), // Clone URL for external provider

  // For local repos: path to bare repo
  localPath: text('local_path'), // e.g., "/var/lib/cv-hub/git/orgs/controlvector/cv-git.git"

  // Default branch
  defaultBranch: varchar('default_branch', { length: 255 }).default('main').notNull(),

  // Statistics (cached)
  starCount: integer('star_count').default(0).notNull(),
  watcherCount: integer('watcher_count').default(0).notNull(),
  forkCount: integer('fork_count').default(0).notNull(),
  openIssueCount: integer('open_issue_count').default(0).notNull(),
  openPrCount: integer('open_pr_count').default(0).notNull(),

  // Size info
  sizeBytes: bigint('size_bytes', { mode: 'number' }).default(0),

  // Settings
  hasIssues: boolean('has_issues').default(true).notNull(),
  hasPullRequests: boolean('has_pull_requests').default(true).notNull(),
  hasWiki: boolean('has_wiki').default(false).notNull(),

  // Fork info
  forkedFromId: uuid('forked_from_id').references((): any => repositories.id, { onDelete: 'set null' }),

  // Graph sync state
  graphSyncStatus: syncStatusEnum('graph_sync_status').default('pending').notNull(),
  graphLastSyncedAt: timestamp('graph_last_synced_at', { withTimezone: true }),
  graphSyncError: text('graph_sync_error'),

  // Archival
  isArchived: boolean('is_archived').default(false).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Unique slug per owner
  uniqueIndex('repos_org_slug_idx').on(table.organizationId, table.slug),
  uniqueIndex('repos_user_slug_idx').on(table.userId, table.slug),
  index('repos_visibility_idx').on(table.visibility),
  index('repos_provider_idx').on(table.provider),
  index('repos_graph_sync_status_idx').on(table.graphSyncStatus),
  index('repos_star_count_idx').on(table.starCount),
]);

// ============================================================================
// Repository Members (per-repo access control)
// ============================================================================

export const repositoryMembers = pgTable('repository_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: repoRoleEnum('role').default('read').notNull(),

  // Invitation tracking
  invitedBy: uuid('invited_by').references(() => users.id),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('repo_members_repo_user_idx').on(table.repositoryId, table.userId),
  index('repo_members_user_id_idx').on(table.userId),
]);

// ============================================================================
// Branches
// ============================================================================

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(), // e.g., "main", "feature/auth"
  sha: varchar('sha', { length: 40 }).notNull(), // Current commit SHA

  // Protection rules
  isProtected: boolean('is_protected').default(false).notNull(),
  protectionRules: jsonb('protection_rules'), // { requireReviews: 1, requireStatusChecks: [...] }

  // Tracking
  isDefault: boolean('is_default').default(false).notNull(),

  // Stats (cached)
  aheadCount: integer('ahead_count').default(0), // Commits ahead of default
  behindCount: integer('behind_count').default(0), // Commits behind default

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('branches_repo_name_idx').on(table.repositoryId, table.name),
  index('branches_sha_idx').on(table.sha),
]);

// ============================================================================
// Commits (cached metadata)
// ============================================================================

export const commits = pgTable('commits', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  sha: varchar('sha', { length: 40 }).notNull(),

  // Author info (from git)
  authorName: varchar('author_name', { length: 255 }),
  authorEmail: varchar('author_email', { length: 255 }),
  authorDate: timestamp('author_date', { withTimezone: true }),

  // Committer info (from git)
  committerName: varchar('committer_name', { length: 255 }),
  committerEmail: varchar('committer_email', { length: 255 }),
  committerDate: timestamp('committer_date', { withTimezone: true }),

  // Link to CV-Hub user (if email matches)
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  committerUserId: uuid('committer_user_id').references(() => users.id, { onDelete: 'set null' }),

  // Commit data
  message: text('message').notNull(),
  parentShas: jsonb('parent_shas').$type<string[]>().default([]),

  // Stats
  additions: integer('additions').default(0),
  deletions: integer('deletions').default(0),
  filesChanged: integer('files_changed').default(0),

  // Signature info
  isVerified: boolean('is_verified').default(false),
  signatureInfo: jsonb('signature_info'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('commits_repo_sha_idx').on(table.repositoryId, table.sha),
  index('commits_author_date_idx').on(table.authorDate),
  index('commits_author_user_idx').on(table.authorUserId),
]);

// ============================================================================
// Tags
// ============================================================================

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(), // e.g., "v1.0.0"
  sha: varchar('sha', { length: 40 }).notNull(), // Pointed commit SHA

  // For annotated tags
  message: text('message'),
  taggerName: varchar('tagger_name', { length: 255 }),
  taggerEmail: varchar('tagger_email', { length: 255 }),
  taggerDate: timestamp('tagger_date', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('tags_repo_name_idx').on(table.repositoryId, table.name),
  index('tags_sha_idx').on(table.sha),
]);

// ============================================================================
// Pull Requests
// ============================================================================

export const pullRequests = pgTable('pull_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  number: integer('number').notNull(), // PR number within repo

  // Core info
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body'),
  state: prStateEnum('state').default('open').notNull(),

  // Branches
  sourceBranch: varchar('source_branch', { length: 255 }).notNull(),
  targetBranch: varchar('target_branch', { length: 255 }).notNull(),
  sourceSha: varchar('source_sha', { length: 40 }),
  targetSha: varchar('target_sha', { length: 40 }),

  // For cross-repo PRs (forks)
  sourceRepositoryId: uuid('source_repository_id').references(() => repositories.id, { onDelete: 'set null' }),

  // Author
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Merge info
  mergedAt: timestamp('merged_at', { withTimezone: true }),
  mergedBy: uuid('merged_by').references(() => users.id, { onDelete: 'set null' }),
  mergeCommitSha: varchar('merge_commit_sha', { length: 40 }),

  // Review requirements
  requiredReviewers: integer('required_reviewers').default(1),

  // Labels (stored as JSON array for simplicity)
  labels: jsonb('labels').$type<string[]>().default([]),

  // Draft status
  isDraft: boolean('is_draft').default(false).notNull(),

  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('prs_repo_number_idx').on(table.repositoryId, table.number),
  index('prs_author_idx').on(table.authorId),
  index('prs_state_idx').on(table.state),
  index('prs_source_branch_idx').on(table.sourceBranch),
  index('prs_target_branch_idx').on(table.targetBranch),
]);

// ============================================================================
// Pull Request Reviews
// ============================================================================

export const pullRequestReviews = pgTable('pull_request_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  pullRequestId: uuid('pull_request_id').notNull().references(() => pullRequests.id, { onDelete: 'cascade' }),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  state: reviewStateEnum('state').default('pending').notNull(),
  body: text('body'),

  // Commit SHA at time of review
  commitSha: varchar('commit_sha', { length: 40 }),

  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('pr_reviews_pr_idx').on(table.pullRequestId),
  index('pr_reviews_reviewer_idx').on(table.reviewerId),
  index('pr_reviews_state_idx').on(table.state),
]);

// ============================================================================
// Issues
// ============================================================================

export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  number: integer('number').notNull(), // Issue number within repo

  title: varchar('title', { length: 255 }).notNull(),
  body: text('body'),
  state: issueStateEnum('state').default('open').notNull(),
  priority: issuePriorityEnum('priority').default('medium').notNull(),

  // Author
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Assignees (stored as JSON array)
  assigneeIds: jsonb('assignee_ids').$type<string[]>().default([]),

  // Labels
  labels: jsonb('labels').$type<string[]>().default([]),

  // Milestone (optional)
  milestone: varchar('milestone', { length: 100 }),

  // Linked PR
  linkedPullRequestId: uuid('linked_pull_request_id').references(() => pullRequests.id, { onDelete: 'set null' }),

  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('issues_repo_number_idx').on(table.repositoryId, table.number),
  index('issues_author_idx').on(table.authorId),
  index('issues_state_idx').on(table.state),
  index('issues_priority_idx').on(table.priority),
]);

// ============================================================================
// Comments (shared for PRs and Issues)
// ============================================================================

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),

  // One of these must be set
  pullRequestId: uuid('pull_request_id').references(() => pullRequests.id, { onDelete: 'cascade' }),
  issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'cascade' }),

  // For inline comments on PRs
  isInlineComment: boolean('is_inline_comment').default(false).notNull(),
  commitSha: varchar('commit_sha', { length: 40 }), // For inline comments
  filePath: text('file_path'), // File being commented on
  lineNumber: integer('line_number'), // Line number in diff
  side: varchar('side', { length: 10 }), // 'LEFT' or 'RIGHT' for diff context

  // Comment content
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),

  // Reactions (stored as JSON)
  reactions: jsonb('reactions').$type<Record<string, string[]>>().default({}), // { "+1": [userId, ...], ... }

  // Edit tracking
  isEdited: boolean('is_edited').default(false).notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('comments_pr_idx').on(table.pullRequestId),
  index('comments_issue_idx').on(table.issueId),
  index('comments_author_idx').on(table.authorId),
  index('comments_file_path_idx').on(table.filePath),
]);

// ============================================================================
// Repository Stars
// ============================================================================

export const repoStars = pgTable('repo_stars', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('repo_stars_repo_user_idx').on(table.repositoryId, table.userId),
  index('repo_stars_user_idx').on(table.userId),
]);

// ============================================================================
// Repository Watchers
// ============================================================================

export const repoWatchers = pgTable('repo_watchers', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Watch level
  watchLevel: varchar('watch_level', { length: 20 }).default('all').notNull(), // 'all', 'releases', 'ignore'

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('repo_watchers_repo_user_idx').on(table.repositoryId, table.userId),
  index('repo_watchers_user_idx').on(table.userId),
]);

// ============================================================================
// Graph Sync Jobs
// ============================================================================

export const graphSyncJobs = pgTable('graph_sync_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),

  // Job type
  jobType: varchar('job_type', { length: 32 }).default('full').notNull(), // 'full', 'delta', 'incremental'

  // Status
  status: syncStatusEnum('status').default('pending').notNull(),

  // Progress tracking
  progress: integer('progress').default(0), // 0-100
  currentStep: varchar('current_step', { length: 255 }),

  // Timing
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  // Results
  nodesCreated: integer('nodes_created').default(0),
  edgesCreated: integer('edges_created').default(0),
  vectorsCreated: integer('vectors_created').default(0),

  // Error info
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),

  // Retry tracking
  attemptCount: integer('attempt_count').default(0).notNull(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('graph_sync_jobs_repo_idx').on(table.repositoryId),
  index('graph_sync_jobs_status_idx').on(table.status),
  index('graph_sync_jobs_created_at_idx').on(table.createdAt),
]);

// ============================================================================
// Relations
// ============================================================================

export const repositoriesRelations = relations(repositories, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [repositories.organizationId],
    references: [organizations.id],
  }),
  owner: one(users, {
    fields: [repositories.userId],
    references: [users.id],
  }),
  forkedFrom: one(repositories, {
    fields: [repositories.forkedFromId],
    references: [repositories.id],
    relationName: 'forks',
  }),
  forks: many(repositories, { relationName: 'forks' }),
  members: many(repositoryMembers),
  branches: many(branches),
  commits: many(commits),
  tags: many(tags),
  pullRequests: many(pullRequests),
  issues: many(issues),
  stars: many(repoStars),
  watchers: many(repoWatchers),
  graphSyncJobs: many(graphSyncJobs),
}));

export const repositoryMembersRelations = relations(repositoryMembers, ({ one }) => ({
  repository: one(repositories, {
    fields: [repositoryMembers.repositoryId],
    references: [repositories.id],
  }),
  user: one(users, {
    fields: [repositoryMembers.userId],
    references: [users.id],
  }),
  inviter: one(users, {
    fields: [repositoryMembers.invitedBy],
    references: [users.id],
  }),
}));

export const branchesRelations = relations(branches, ({ one }) => ({
  repository: one(repositories, {
    fields: [branches.repositoryId],
    references: [repositories.id],
  }),
}));

export const commitsRelations = relations(commits, ({ one }) => ({
  repository: one(repositories, {
    fields: [commits.repositoryId],
    references: [repositories.id],
  }),
  author: one(users, {
    fields: [commits.authorUserId],
    references: [users.id],
  }),
  committer: one(users, {
    fields: [commits.committerUserId],
    references: [users.id],
  }),
}));

export const tagsRelations = relations(tags, ({ one }) => ({
  repository: one(repositories, {
    fields: [tags.repositoryId],
    references: [repositories.id],
  }),
}));

export const pullRequestsRelations = relations(pullRequests, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [pullRequests.repositoryId],
    references: [repositories.id],
  }),
  sourceRepository: one(repositories, {
    fields: [pullRequests.sourceRepositoryId],
    references: [repositories.id],
  }),
  author: one(users, {
    fields: [pullRequests.authorId],
    references: [users.id],
  }),
  merger: one(users, {
    fields: [pullRequests.mergedBy],
    references: [users.id],
  }),
  reviews: many(pullRequestReviews),
  comments: many(comments),
}));

export const pullRequestReviewsRelations = relations(pullRequestReviews, ({ one }) => ({
  pullRequest: one(pullRequests, {
    fields: [pullRequestReviews.pullRequestId],
    references: [pullRequests.id],
  }),
  reviewer: one(users, {
    fields: [pullRequestReviews.reviewerId],
    references: [users.id],
  }),
}));

export const issuesRelations = relations(issues, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [issues.repositoryId],
    references: [repositories.id],
  }),
  author: one(users, {
    fields: [issues.authorId],
    references: [users.id],
  }),
  closer: one(users, {
    fields: [issues.closedBy],
    references: [users.id],
  }),
  linkedPullRequest: one(pullRequests, {
    fields: [issues.linkedPullRequestId],
    references: [pullRequests.id],
  }),
  comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  pullRequest: one(pullRequests, {
    fields: [comments.pullRequestId],
    references: [pullRequests.id],
  }),
  issue: one(issues, {
    fields: [comments.issueId],
    references: [issues.id],
  }),
  author: one(users, {
    fields: [comments.authorId],
    references: [users.id],
  }),
}));

export const repoStarsRelations = relations(repoStars, ({ one }) => ({
  repository: one(repositories, {
    fields: [repoStars.repositoryId],
    references: [repositories.id],
  }),
  user: one(users, {
    fields: [repoStars.userId],
    references: [users.id],
  }),
}));

export const repoWatchersRelations = relations(repoWatchers, ({ one }) => ({
  repository: one(repositories, {
    fields: [repoWatchers.repositoryId],
    references: [repositories.id],
  }),
  user: one(users, {
    fields: [repoWatchers.userId],
    references: [users.id],
  }),
}));

export const graphSyncJobsRelations = relations(graphSyncJobs, ({ one }) => ({
  repository: one(repositories, {
    fields: [graphSyncJobs.repositoryId],
    references: [repositories.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type RepositoryMember = typeof repositoryMembers.$inferSelect;
export type NewRepositoryMember = typeof repositoryMembers.$inferInsert;
export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
export type Commit = typeof commits.$inferSelect;
export type NewCommit = typeof commits.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;
export type PullRequestReview = typeof pullRequestReviews.$inferSelect;
export type NewPullRequestReview = typeof pullRequestReviews.$inferInsert;
export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type RepoStar = typeof repoStars.$inferSelect;
export type NewRepoStar = typeof repoStars.$inferInsert;
export type RepoWatcher = typeof repoWatchers.$inferSelect;
export type NewRepoWatcher = typeof repoWatchers.$inferInsert;
export type GraphSyncJob = typeof graphSyncJobs.$inferSelect;
export type NewGraphSyncJob = typeof graphSyncJobs.$inferInsert;

export type RepoVisibility = typeof repoVisibilityEnum.enumValues[number];
export type RepoProvider = typeof repoProviderEnum.enumValues[number];
export type RepoRole = typeof repoRoleEnum.enumValues[number];
export type PRState = typeof prStateEnum.enumValues[number];
export type IssueState = typeof issueStateEnum.enumValues[number];
export type IssuePriority = typeof issuePriorityEnum.enumValues[number];
export type ReviewState = typeof reviewStateEnum.enumValues[number];
export type SyncStatus = typeof syncStatusEnum.enumValues[number];
