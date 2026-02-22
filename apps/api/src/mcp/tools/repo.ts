/**
 * MCP Tools: Repository, Branch, File, Tree
 * Exposes repository operations to AI agents via MCP
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
  getUserAccessibleRepositories,
  createRepository,
} from '../../services/repository.service';
import * as gitBackend from '../../services/git/git-backend.service';
import { getUserById } from '../../services/user.service';
import { db } from '../../db';
import { branches, organizations } from '../../db/schema';
import { eq } from 'drizzle-orm';

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerRepoTools(
  server: McpServer,
  userId: string,
  scopes: string[],
) {
  const hasRead = scopes.includes('repo:read');
  const hasWrite = scopes.includes('repo:write');
  const hasAdmin = scopes.includes('repo:admin');

  // ── list_repos ──────────────────────────────────────────────────────
  server.tool(
    'list_repos',
    'List repositories accessible to the authenticated user',
    {
      search: z.string().optional().describe('Filter by name/description'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ search, limit }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repos = await getUserAccessibleRepositories(userId, { search, limit });
      const data = repos.map((r) => ({
        name: r.name,
        slug: r.slug,
        owner: r.owner?.slug ?? null,
        visibility: r.visibility,
        description: r.description,
        default_branch: r.defaultBranch,
        updated_at: r.updatedAt?.toISOString() ?? null,
        branch_count: r.branchCount,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  // ── get_repo ────────────────────────────────────────────────────────
  server.tool(
    'get_repo',
    'Get details about a specific repository',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
    },
    async ({ owner, repo }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: repoData.id,
            name: repoData.name,
            slug: repoData.slug,
            owner: repoData.owner?.slug ?? null,
            visibility: repoData.visibility,
            description: repoData.description,
            default_branch: repoData.defaultBranch,
            is_archived: repoData.isArchived,
            created_at: repoData.createdAt?.toISOString() ?? null,
            updated_at: repoData.updatedAt?.toISOString() ?? null,
          }, null, 2),
        }],
      };
    },
  );

  // ── get_file ────────────────────────────────────────────────────────
  server.tool(
    'get_file',
    'Read a file from a repository at a specific git ref',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      path: z.string().describe('File path within the repository'),
      ref: z.string().optional().describe('Git ref (branch/tag/sha). Defaults to default branch'),
    },
    async ({ owner, repo, path, ref }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const blob = await gitBackend.getBlob(owner, repo, ref || repoData.defaultBranch, path);
        return {
          content: [{
            type: 'text',
            text: blob.isBinary ? `[Binary file: ${blob.size} bytes]` : blob.content,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error reading file: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_tree ────────────────────────────────────────────────────────
  server.tool(
    'get_tree',
    'List files and directories in a repository at a specific path and ref',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      path: z.string().optional().describe('Directory path (empty for root)'),
      ref: z.string().optional().describe('Git ref (branch/tag/sha). Defaults to default branch'),
    },
    async ({ owner, repo, path, ref }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const entries = await gitBackend.getTree(owner, repo, ref || repoData.defaultBranch, path || '');
        const data = entries.map((e) => ({
          name: e.name,
          path: e.path,
          type: e.type,
          size: e.size ?? null,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error listing tree: ${err.message}` }], isError: true };
      }
    },
  );

  // ── list_branches ───────────────────────────────────────────────────
  server.tool(
    'list_branches',
    'List branches in a repository',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
    },
    async ({ owner, repo }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const refs = await gitBackend.getRefs(owner, repo);
        const branchRefs = refs.filter((r) => r.type === 'branch');
        const data = branchRefs.map((b) => ({
          name: b.name,
          sha: b.sha,
          is_default: b.isDefault ?? (b.name === repoData.defaultBranch),
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error listing branches: ${err.message}` }], isError: true };
      }
    },
  );

  // ── create_repo (Phase 2) ──────────────────────────────────────────
  server.tool(
    'create_repo',
    'Create a new repository',
    {
      name: z.string().min(1).max(100).describe('Repository name'),
      description: z.string().max(500).optional().describe('Repository description'),
      is_private: z.boolean().optional().describe('Whether the repository is private (default false)'),
      default_branch: z.string().optional().describe('Default branch name (default "main")'),
      org: z.string().optional().describe('Organization slug (creates under org instead of user)'),
    },
    async ({ name, description, is_private, default_branch, org }) => {
      if (!hasWrite) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:write required' }], isError: true };
      }
      try {
        let organizationId: string | null = null;
        if (org) {
          const orgRecord = await db.query.organizations.findFirst({
            where: eq(organizations.slug, org),
          });
          if (!orgRecord) {
            return { content: [{ type: 'text', text: 'Organization not found' }], isError: true };
          }
          if (hasAdmin) {
            organizationId = orgRecord.id;
          } else {
            return { content: [{ type: 'text', text: 'Insufficient scope: repo:admin required for org repos' }], isError: true };
          }
        }

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const visibility = is_private ? 'private' as const : 'public' as const;

        const repo = await createRepository(
          {
            name,
            slug,
            description: description ?? null,
            visibility,
            defaultBranch: default_branch ?? 'main',
            organizationId,
            userId: organizationId ? null : userId,
          },
          userId,
        );

        const user = await getUserById(userId);
        const full = await getRepositoryByOwnerAndSlug(
          org ?? user!.username,
          slug,
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: (full ?? repo).id,
              name: (full ?? repo).name,
              slug: (full ?? repo).slug,
              visibility: (full ?? repo).visibility,
              default_branch: (full ?? repo).defaultBranch,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error creating repository: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_diff (Phase 2) ─────────────────────────────────────────────
  server.tool(
    'get_diff',
    'Compare two git refs and get the diff',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      base: z.string().describe('Base ref (branch/tag/sha)'),
      head: z.string().describe('Head ref (branch/tag/sha)'),
    },
    async ({ owner, repo, base, head }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const diff = await gitBackend.getDiff(owner, repo, base, head);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              base_sha: diff.baseSha,
              head_sha: diff.headSha,
              stats: diff.stats,
              files: diff.files.map((f) => ({
                path: f.path,
                old_path: f.oldPath ?? null,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions,
              })),
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error getting diff: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_commit (Phase 2) ───────────────────────────────────────────
  server.tool(
    'get_commit',
    'Get details about a specific commit',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      sha: z.string().describe('Commit SHA'),
    },
    async ({ owner, repo, sha }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const commit = await gitBackend.getCommit(owner, repo, sha);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              sha: commit.sha,
              message: commit.message,
              author: {
                name: commit.author.name,
                email: commit.author.email,
                date: commit.author.date.toISOString(),
              },
              parents: commit.parents,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error getting commit: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_commit_history (Phase 2) ───────────────────────────────────
  server.tool(
    'get_commit_history',
    'Get recent commit history for a repository branch',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      ref: z.string().optional().describe('Git ref (default: default branch)'),
      limit: z.number().optional().describe('Max commits (default 30)'),
      path: z.string().optional().describe('Filter to commits affecting this path'),
    },
    async ({ owner, repo, ref, limit, path }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const commits = await gitBackend.getCommitHistory(
          owner, repo, ref || repoData.defaultBranch,
          { limit: limit ?? 30, path },
        );
        const data = commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author_name: c.author.name,
          author_email: c.author.email,
          date: c.author.date.toISOString(),
          parents: c.parents,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error getting history: ${err.message}` }], isError: true };
      }
    },
  );
}
