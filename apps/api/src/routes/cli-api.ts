/**
 * CLI API Routes (/v1)
 *
 * REST endpoints for the CV-Git CLI (CVHubAdapter).
 * Returns snake_case JSON, separate from the camelCase frontend API at /api/v1/.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AppEnv } from '../app';
import { env } from '../config/env';
import { brand } from '../config/brand';
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';

// Services
import * as patService from '../services/pat.service';
import * as tokenService from '../services/token.service';
import * as oauthService from '../services/oauth.service';
import { getUserById } from '../services/user.service';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
  createRepository,
} from '../services/repository.service';
import * as prService from '../services/pr.service';
import * as releaseService from '../services/release.service';
import * as issueService from '../services/issue.service';
import * as gitBackend from '../services/git/git-backend.service';

// DB for branch queries, user lookups, org lookups
import { db } from '../db';
import { branches, users, organizations } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';

// ============================================================================
// Extended Hono context type for CLI auth
// ============================================================================

type CliEnv = {
  Variables: {
    userId: string;
    tokenScopes: string[];
    sessionId?: string;
  };
};

const cliApi = new Hono<CliEnv>();

// ============================================================================
// Auth Middleware
// ============================================================================

async function requireCliAuth(
  c: any,
  next: () => Promise<void>,
) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or invalid Authorization header');
  }
  const token = authHeader.slice(7);

  // 1. PAT (cv_pat_*)
  if (token.startsWith('cv_pat_')) {
    const result = await patService.validateToken(token);
    if (!result.valid || !result.userId) {
      throw new AuthenticationError('Invalid or expired token');
    }
    c.set('userId', result.userId);
    c.set('tokenScopes', result.scopes ?? []);
    return next();
  }

  // 2. JWT session token — try first (cheap local verify)
  try {
    const payload = await tokenService.verifyAccessToken(token);
    c.set('userId', payload.sub);
    c.set('tokenScopes', [
      'repo:read', 'repo:write', 'repo:admin',
      'user:read', 'user:write',
      'org:read', 'org:write',
      'ssh_keys:read', 'ssh_keys:write',
    ]);
    return next();
  } catch {
    // Not a valid JWT — fall through to OAuth
  }

  // 3. OAuth access token
  const oauthResult = await oauthService.validateAccessToken(token);
  if (oauthResult.valid && oauthResult.userId) {
    c.set('userId', oauthResult.userId);
    c.set('tokenScopes', oauthResult.scopes ?? []);
    return next();
  }

  throw new AuthenticationError('Invalid or expired token');
}

// Apply auth to all routes
cliApi.use('*', requireCliAuth as any);

// ============================================================================
// Formatter Functions (DB → snake_case)
// ============================================================================

function formatUser(u: {
  id: string;
  username: string;
  displayName?: string | null;
  email?: string;
  avatarUrl?: string | null;
}) {
  return {
    id: u.id,
    username: u.username,
    name: u.displayName ?? u.username,
    email: u.email ?? null,
    avatar_url: u.avatarUrl ?? null,
    web_url: `${env.APP_URL}/${u.username}`,
  };
}

function formatRepo(repo: {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  visibility: string;
  defaultBranch: string;
  starCount: number;
  forkCount: number;
  openIssueCount: number;
  openPrCount: number;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  owner?: { slug: string } | null;
}) {
  const ownerSlug = repo.owner?.slug ?? '';
  return {
    id: repo.id,
    owner: ownerSlug,
    name: repo.name,
    full_name: `${ownerSlug}/${repo.slug}`,
    description: repo.description ?? '',
    is_private: repo.visibility === 'private',
    default_branch: repo.defaultBranch,
    star_count: repo.starCount,
    fork_count: repo.forkCount,
    open_issue_count: repo.openIssueCount,
    open_pr_count: repo.openPrCount,
    is_archived: repo.isArchived,
    clone_url: `${env.API_URL}/git/${ownerSlug}/${repo.slug}.git`,
    ssh_url: `git@${brand.domain}:${ownerSlug}/${repo.slug}.git`,
    web_url: `${env.APP_URL}/${ownerSlug}/${repo.slug}`,
    created_at: repo.createdAt.toISOString(),
    updated_at: repo.updatedAt.toISOString(),
  };
}

function formatPR(
  pr: prService.PRWithDetails,
  owner: string,
  repo: string,
) {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    state: pr.state,
    base_branch: pr.targetBranch,
    head_branch: pr.sourceBranch,
    author: pr.author
      ? { id: pr.author.id, username: pr.author.username, name: pr.author.displayName }
      : null,
    is_draft: pr.isDraft,
    labels: pr.labels ?? [],
    review_count: pr.reviewCount,
    comment_count: pr.commentCount,
    merged_at: pr.mergedAt?.toISOString() ?? null,
    closed_at: pr.closedAt?.toISOString() ?? null,
    created_at: pr.createdAt.toISOString(),
    updated_at: pr.updatedAt.toISOString(),
    web_url: `${env.APP_URL}/${owner}/${repo}/pulls/${pr.number}`,
  };
}

function formatRelease(
  rel: {
    id: string;
    tagName: string;
    name: string;
    body?: string | null;
    draft: boolean;
    prerelease: boolean;
    publishedAt?: Date | null;
    createdAt: Date;
    author?: { id: string; username: string; displayName?: string | null } | null;
    assets?: Array<{ id: string; name: string; size: number; downloadCount: number }>;
  },
  owner: string,
  repo: string,
) {
  return {
    id: rel.id,
    tag_name: rel.tagName,
    name: rel.name,
    body: rel.body ?? '',
    is_draft: rel.draft,
    is_prerelease: rel.prerelease,
    published_at: rel.publishedAt?.toISOString() ?? null,
    created_at: rel.createdAt.toISOString(),
    author: rel.author
      ? { id: rel.author.id, username: rel.author.username, name: rel.author.displayName }
      : null,
    assets: (rel.assets ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      download_count: a.downloadCount,
    })),
    web_url: `${env.APP_URL}/${owner}/${repo}/releases/tag/${rel.tagName}`,
  };
}

async function resolveAssignees(assigneeIds: string[] | null | undefined) {
  if (!assigneeIds || assigneeIds.length === 0) return [];
  const assignees = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, assigneeIds));
  return assignees.map((u) => ({
    id: u.id,
    username: u.username,
    name: u.displayName ?? u.username,
    avatar_url: u.avatarUrl ?? null,
  }));
}

async function formatIssue(
  issue: issueService.IssueWithDetails & { assigneeIds?: string[] | null },
  owner: string,
  repo: string,
) {
  const assignees = await resolveAssignees(issue.assigneeIds);
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    state: issue.state,
    priority: issue.priority,
    labels: issue.labels ?? [],
    assignees,
    author: issue.author
      ? { id: issue.author.id, username: issue.author.username, name: issue.author.displayName }
      : null,
    comment_count: issue.commentCount,
    closed_at: issue.closedAt?.toISOString() ?? null,
    created_at: issue.createdAt.toISOString(),
    updated_at: issue.updatedAt.toISOString(),
    web_url: `${env.APP_URL}/${owner}/${repo}/issues/${issue.number}`,
  };
}

function formatCommit(
  gc: { sha: string; message: string; author: { name: string; email: string; date: Date }; parents: string[] },
  owner: string,
  repo: string,
) {
  return {
    sha: gc.sha,
    message: gc.message,
    author_name: gc.author.name,
    author_email: gc.author.email,
    date: gc.author.date.toISOString(),
    parents: gc.parents,
    web_url: `${env.APP_URL}/${owner}/${repo}/commit/${gc.sha}`,
  };
}

function formatBranch(
  branch: { name: string; isProtected?: boolean; isDefault?: boolean },
  commit?: {
    sha: string;
    message?: string;
    date?: string;
    author_name?: string;
    author_email?: string;
    parents?: string[];
  },
) {
  return {
    name: branch.name,
    is_protected: branch.isProtected ?? false,
    is_default: branch.isDefault ?? false,
    commit: commit
      ? {
          sha: commit.sha,
          message: commit.message ?? '',
          date: commit.date ?? null,
          author_name: commit.author_name ?? null,
          author_email: commit.author_email ?? null,
          parents: commit.parents ?? [],
        }
      : null,
  };
}

// ============================================================================
// Shared Helper
// ============================================================================

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo) throw new NotFoundError('Repository');

  const accessible = await canUserAccessRepo(repo.id, userId);
  if (!accessible) throw new NotFoundError('Repository');

  return repo;
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const createPRSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().optional(),
  base: z.string().min(1),
  head: z.string().min(1),
  draft: z.boolean().optional(),
});

const updatePRSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
});

const mergePRSchema = z.object({
  commit_message: z.string().optional(),
  merge_method: z.enum(['merge', 'squash', 'rebase']).optional(),
});

const createReleaseSchema = z.object({
  tag_name: z.string().min(1),
  name: z.string().optional(),
  body: z.string().optional(),
  target_commitish: z.string().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

const createIssueSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
});

const updateIssueSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
  labels: z.array(z.string()).optional(),
});

const createRepoSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  is_private: z.boolean().optional(),
  default_branch: z.string().max(255).optional(),
  org: z.string().optional(),
});

// ============================================================================
// User Routes
// ============================================================================

cliApi.get('/user', async (c) => {
  const userId = c.get('userId');
  const user = await getUserById(userId);
  if (!user) throw new NotFoundError('User');
  return c.json(formatUser(user));
});

cliApi.get('/user/scopes', async (c) => {
  const scopes = c.get('tokenScopes');
  return c.json({ scopes });
});

// ============================================================================
// Repository Routes
// ============================================================================

cliApi.post(
  '/repos',
  zValidator('json', createRepoSchema),
  async (c) => {
    const userId = c.get('userId');
    const body = c.req.valid('json');

    let organizationId: string | null = null;

    if (body.org) {
      // Look up org by slug
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.slug, body.org),
      });
      if (!org) throw new NotFoundError('Organization');

      // Verify user is an org admin
      const { isOrgAdmin } = await import('../services/organization.service');
      if (!await isOrgAdmin(org.id, userId)) {
        throw new AuthenticationError('You must be an admin to create repos in this organization');
      }
      organizationId = org.id;
    }

    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const visibility = body.is_private ? 'private' as const : 'public' as const;

    const repo = await createRepository(
      {
        name: body.name,
        slug,
        description: body.description ?? null,
        visibility,
        defaultBranch: body.default_branch ?? 'main',
        organizationId,
        userId: organizationId ? null : userId,
      },
      userId,
    );

    // Re-fetch with owner info for formatting
    const full = await getRepositoryByOwnerAndSlug(
      body.org ?? (await getUserById(userId))!.username,
      slug,
    );

    return c.json(formatRepo(full ?? repo as any), 201);
  },
);

cliApi.get('/repos/:owner/:repo', async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);
  return c.json(formatRepo(repoData));
});

// ============================================================================
// Pull Request Routes
// ============================================================================

cliApi.get('/repos/:owner/:repo/pulls', async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);

  const state = c.req.query('state') as prService.PRListOptions['state'] ?? 'open';
  const limit = parseInt(c.req.query('limit') ?? '30', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const { pullRequests } = await prService.listPullRequests(repoData.id, {
    state: state === 'all' ? 'all' : state,
    limit,
    offset,
  });

  return c.json(pullRequests.map((pr) => formatPR(pr, owner, repoSlug)));
});

cliApi.post(
  '/repos/:owner/:repo/pulls',
  zValidator('json', createPRSchema),
  async (c) => {
    const { owner, repo: repoSlug } = c.req.param();
    const userId = c.get('userId');
    const repoData = await resolveRepo(owner, repoSlug, userId);
    const body = c.req.valid('json');

    const pr = await prService.createPullRequest({
      repositoryId: repoData.id,
      title: body.title,
      body: body.body,
      sourceBranch: body.head,
      targetBranch: body.base,
      authorId: userId,
      isDraft: body.draft,
    });

    // Re-fetch with details
    const full = await prService.getPullRequestByNumber(repoData.id, pr.number);
    return c.json(formatPR(full!, owner, repoSlug), 201);
  },
);

cliApi.get('/repos/:owner/:repo/pulls/:number', async (c) => {
  const { owner, repo: repoSlug, number } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);

  const pr = await prService.getPullRequestByNumber(repoData.id, parseInt(number, 10));
  if (!pr) throw new NotFoundError('Pull request');

  return c.json(formatPR(pr, owner, repoSlug));
});

cliApi.patch(
  '/repos/:owner/:repo/pulls/:number',
  zValidator('json', updatePRSchema),
  async (c) => {
    const { owner, repo: repoSlug, number } = c.req.param();
    const userId = c.get('userId');
    const repoData = await resolveRepo(owner, repoSlug, userId);
    const body = c.req.valid('json');

    const existing = await prService.getPullRequestByNumber(repoData.id, parseInt(number, 10));
    if (!existing) throw new NotFoundError('Pull request');

    await prService.updatePullRequest(existing.id, {
      title: body.title,
      body: body.body,
      state: body.state as any,
    }, userId);

    const updated = await prService.getPullRequestByNumber(repoData.id, parseInt(number, 10));
    return c.json(formatPR(updated!, owner, repoSlug));
  },
);

cliApi.put(
  '/repos/:owner/:repo/pulls/:number/merge',
  zValidator('json', mergePRSchema),
  async (c) => {
    const { owner, repo: repoSlug, number } = c.req.param();
    const userId = c.get('userId');
    const repoData = await resolveRepo(owner, repoSlug, userId);
    const body = c.req.valid('json');

    const existing = await prService.getPullRequestByNumber(repoData.id, parseInt(number, 10));
    if (!existing) throw new NotFoundError('Pull request');

    await prService.mergePullRequest(existing.id, userId, body.merge_method);

    const merged = await prService.getPullRequestByNumber(repoData.id, parseInt(number, 10));
    return c.json(formatPR(merged!, owner, repoSlug));
  },
);

// ============================================================================
// Release Routes
// ============================================================================

cliApi.get('/repos/:owner/:repo/releases', async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);

  const limit = parseInt(c.req.query('limit') ?? '30', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const { releases } = await releaseService.listReleases(repoData.id, {
    limit,
    offset,
    includeDrafts: true,
  });

  return c.json(releases.map((r) => formatRelease(r as any, owner, repoSlug)));
});

cliApi.post(
  '/repos/:owner/:repo/releases',
  zValidator('json', createReleaseSchema),
  async (c) => {
    const { owner, repo: repoSlug } = c.req.param();
    const userId = c.get('userId');
    const repoData = await resolveRepo(owner, repoSlug, userId);
    const body = c.req.valid('json');

    const release = await releaseService.createRelease({
      repositoryId: repoData.id,
      tagName: body.tag_name,
      name: body.name ?? body.tag_name,
      body: body.body,
      draft: body.draft,
      prerelease: body.prerelease,
      authorId: userId,
    });

    // Re-fetch with author and assets
    const full = await releaseService.getRelease(release.id);
    return c.json(formatRelease(full as any, owner, repoSlug), 201);
  },
);

cliApi.get('/repos/:owner/:repo/releases/tags/:tag', async (c) => {
  const { owner, repo: repoSlug, tag } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);

  const release = await releaseService.getReleaseByTag(repoData.id, tag);
  if (!release) throw new NotFoundError('Release');

  return c.json(formatRelease(release as any, owner, repoSlug));
});

cliApi.delete('/repos/:owner/:repo/releases/tags/:tag', async (c) => {
  const { owner, repo: repoSlug, tag } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);

  const release = await releaseService.getReleaseByTag(repoData.id, tag);
  if (!release) throw new NotFoundError('Release');

  await releaseService.deleteRelease(release.id);
  return c.body(null, 204);
});

// ============================================================================
// Issue Routes
// ============================================================================

cliApi.get('/repos/:owner/:repo/issues', async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);

  const state = c.req.query('state') as issueService.IssueListOptions['state'] ?? 'open';
  const limit = parseInt(c.req.query('limit') ?? '30', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const { issues } = await issueService.listIssues(repoData.id, {
    state: state === 'all' ? 'all' : state,
    limit,
    offset,
  });

  return c.json(await Promise.all(issues.map((i) => formatIssue(i, owner, repoSlug))));
});

cliApi.post(
  '/repos/:owner/:repo/issues',
  zValidator('json', createIssueSchema),
  async (c) => {
    const { owner, repo: repoSlug } = c.req.param();
    const userId = c.get('userId');
    const repoData = await resolveRepo(owner, repoSlug, userId);
    const body = c.req.valid('json');

    const issue = await issueService.createIssue({
      repositoryId: repoData.id,
      title: body.title,
      body: body.body,
      labels: body.labels,
      authorId: userId,
    });

    const full = await issueService.getIssueByNumber(repoData.id, issue.number);
    return c.json(await formatIssue(full!, owner, repoSlug), 201);
  },
);

cliApi.get('/repos/:owner/:repo/issues/:number', async (c) => {
  const { owner, repo: repoSlug, number } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);

  const issue = await issueService.getIssueByNumber(repoData.id, parseInt(number, 10));
  if (!issue) throw new NotFoundError('Issue');

  return c.json(await formatIssue(issue, owner, repoSlug));
});

cliApi.patch(
  '/repos/:owner/:repo/issues/:number',
  zValidator('json', updateIssueSchema),
  async (c) => {
    const { owner, repo: repoSlug, number } = c.req.param();
    const userId = c.get('userId');
    const repoData = await resolveRepo(owner, repoSlug, userId);
    const body = c.req.valid('json');

    const existing = await issueService.getIssueByNumber(repoData.id, parseInt(number, 10));
    if (!existing) throw new NotFoundError('Issue');

    await issueService.updateIssue(existing.id, {
      title: body.title,
      body: body.body,
      state: body.state as any,
      labels: body.labels,
    }, userId);

    const updated = await issueService.getIssueByNumber(repoData.id, parseInt(number, 10));
    return c.json(await formatIssue(updated!, owner, repoSlug));
  },
);

// ============================================================================
// Commit Routes
// ============================================================================

cliApi.get('/repos/:owner/:repo/commits/:sha', async (c) => {
  const { owner, repo: repoSlug, sha } = c.req.param();
  const userId = c.get('userId');
  await resolveRepo(owner, repoSlug, userId);

  const commit = await gitBackend.getCommit(owner, repoSlug, sha);
  return c.json(formatCommit(commit, owner, repoSlug));
});

cliApi.get('/repos/:owner/:repo/compare/:baseHead', async (c) => {
  const { owner, repo: repoSlug, baseHead } = c.req.param();
  const userId = c.get('userId');
  await resolveRepo(owner, repoSlug, userId);

  // Parse "base...head" format
  const parts = baseHead.split('...');
  if (parts.length !== 2) {
    throw new ValidationError('Compare ref must be in "base...head" format');
  }
  const [base, head] = parts;

  const [diff, commits] = await Promise.all([
    gitBackend.getDiff(owner, repoSlug, base, head),
    gitBackend.getCommitHistory(owner, repoSlug, head, { limit: 250 }),
  ]);

  return c.json({
    base,
    head,
    ahead_by: commits.length,
    diff_stats: {
      additions: diff.stats.additions,
      deletions: diff.stats.deletions,
      files_changed: diff.stats.filesChanged,
    },
    files: diff.files.map((f) => ({
      path: f.path,
      old_path: f.oldPath ?? null,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    commits: commits.map((gc) => formatCommit(gc, owner, repoSlug)),
  });
});

// ============================================================================
// Branch Routes
// ============================================================================

cliApi.get('/repos/:owner/:repo/branches', async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);

  const refs = await gitBackend.getRefs(owner, repoSlug);
  const branchRefs = refs.filter((r) => r.type === 'branch');

  // Fetch DB branch records for protection/default info
  const dbBranches = await db.query.branches.findMany({
    where: eq(branches.repositoryId, repoData.id),
  });
  const dbMap = new Map(dbBranches.map((b) => [b.name, b]));

  // Fetch full commit details for each branch
  const result = await Promise.all(
    branchRefs.map(async (ref) => {
      const dbBranch = dbMap.get(ref.name);
      let commitInfo: { sha: string; message?: string; date?: string; author_name?: string; author_email?: string; parents?: string[] } = { sha: ref.sha };
      try {
        const gc = await gitBackend.getCommit(owner, repoSlug, ref.sha);
        commitInfo = {
          sha: gc.sha,
          message: gc.message,
          date: gc.author.date.toISOString(),
          author_name: gc.author.name,
          author_email: gc.author.email,
          parents: gc.parents,
        };
      } catch {
        // If commit fetch fails, return minimal info
      }
      return formatBranch(
        {
          name: ref.name,
          isProtected: dbBranch?.isProtected ?? false,
          isDefault: ref.isDefault ?? dbBranch?.isDefault ?? (ref.name === repoData.defaultBranch),
        },
        commitInfo,
      );
    }),
  );

  return c.json(result);
});

cliApi.get('/repos/:owner/:repo/branches/:name{.+}', async (c) => {
  const { owner, repo: repoSlug, name } = c.req.param();
  const userId = c.get('userId');
  const repoData = await resolveRepo(owner, repoSlug, userId);

  // Get the SHA for this branch from git
  let sha: string;
  try {
    sha = await gitBackend.getBranchSha(owner, repoSlug, name);
  } catch {
    throw new NotFoundError('Branch');
  }

  // Get commit details
  const commit = await gitBackend.getCommit(owner, repoSlug, sha);

  // Check DB for protection info
  const dbBranch = await db.query.branches.findFirst({
    where: and(eq(branches.repositoryId, repoData.id), eq(branches.name, name)),
  });

  return c.json(
    formatBranch(
      {
        name,
        isProtected: dbBranch?.isProtected ?? false,
        isDefault: dbBranch?.isDefault ?? (name === repoData.defaultBranch),
      },
      {
        sha: commit.sha,
        message: commit.message,
        date: commit.author.date.toISOString(),
        author_name: commit.author.name,
        author_email: commit.author.email,
        parents: commit.parents,
      },
    ),
  );
});

// ============================================================================
// Export
// ============================================================================

export { cliApi as cliApiRoutes };
