/**
 * MCP Tools: Pull Requests
 * Exposes PR operations to AI agents via MCP
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';
import * as prService from '../../services/pr.service';

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerPullRequestTools(
  server: McpServer,
  userId: string,
  scopes: string[],
) {
  const hasRead = scopes.includes('repo:read');
  const hasWrite = scopes.includes('repo:write');

  // ── list_pulls ──────────────────────────────────────────────────────
  server.tool(
    'list_pulls',
    'List pull requests for a repository',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      state: z.enum(['open', 'closed', 'merged', 'all']).optional().describe('Filter by state (default: open)'),
      limit: z.number().optional().describe('Max results (default 30)'),
    },
    async ({ owner, repo, state, limit }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const { pullRequests } = await prService.listPullRequests(repoData.id, {
          state: (state as any) ?? 'open',
          limit: limit ?? 30,
        });
        const data = pullRequests.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          author: pr.author.username,
          source_branch: pr.sourceBranch,
          target_branch: pr.targetBranch,
          is_draft: pr.isDraft,
          review_count: pr.reviewCount,
          comment_count: pr.commentCount,
          created_at: pr.createdAt?.toISOString() ?? null,
          updated_at: pr.updatedAt?.toISOString() ?? null,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error listing pull requests: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_pull ────────────────────────────────────────────────────────
  server.tool(
    'get_pull',
    'Get details about a specific pull request',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      number: z.number().describe('Pull request number'),
    },
    async ({ owner, repo, number }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const pr = await prService.getPullRequestByNumber(repoData.id, number);
        if (!pr) {
          return { content: [{ type: 'text', text: 'Pull request not found' }], isError: true };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              number: pr.number,
              title: pr.title,
              body: pr.body,
              state: pr.state,
              author: pr.author.username,
              source_branch: pr.sourceBranch,
              target_branch: pr.targetBranch,
              is_draft: pr.isDraft,
              review_count: pr.reviewCount,
              comment_count: pr.commentCount,
              created_at: pr.createdAt?.toISOString() ?? null,
              updated_at: pr.updatedAt?.toISOString() ?? null,
              merged_at: pr.mergedAt?.toISOString() ?? null,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error getting pull request: ${err.message}` }], isError: true };
      }
    },
  );

  // ── create_pull ─────────────────────────────────────────────────────
  server.tool(
    'create_pull',
    'Create a new pull request',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      title: z.string().min(1).max(255).describe('Pull request title'),
      body: z.string().optional().describe('Pull request description'),
      head: z.string().describe('Source branch'),
      base: z.string().describe('Target branch'),
      draft: z.boolean().optional().describe('Create as draft PR'),
    },
    async ({ owner, repo, title, body, head, base, draft }) => {
      if (!hasWrite) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:write required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const pr = await prService.createPullRequest({
          repositoryId: repoData.id,
          title,
          body,
          sourceBranch: head,
          targetBranch: base,
          authorId: userId,
          isDraft: draft,
        });

        const full = await prService.getPullRequestByNumber(repoData.id, pr.number);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              number: (full ?? pr).number,
              title: (full ?? pr).title,
              state: (full ?? pr).state,
              source_branch: (full ?? pr).sourceBranch,
              target_branch: (full ?? pr).targetBranch,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error creating pull request: ${err.message}` }], isError: true };
      }
    },
  );

  // ── merge_pull ──────────────────────────────────────────────────────
  server.tool(
    'merge_pull',
    'Merge a pull request',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      number: z.number().describe('Pull request number'),
      merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge strategy (default: merge)'),
    },
    async ({ owner, repo, number, merge_method }) => {
      if (!hasWrite) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:write required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const existing = await prService.getPullRequestByNumber(repoData.id, number);
        if (!existing) {
          return { content: [{ type: 'text', text: 'Pull request not found' }], isError: true };
        }

        await prService.mergePullRequest(existing.id, userId, merge_method);

        const merged = await prService.getPullRequestByNumber(repoData.id, number);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              number: merged!.number,
              title: merged!.title,
              state: merged!.state,
              merged_at: merged!.mergedAt?.toISOString() ?? null,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error merging pull request: ${err.message}` }], isError: true };
      }
    },
  );
}
