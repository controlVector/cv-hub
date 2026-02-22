/**
 * MCP Tools: Issues
 * Exposes issue tracking operations to AI agents via MCP
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';
import * as issueService from '../../services/issue.service';

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerIssueTools(
  server: McpServer,
  userId: string,
  scopes: string[],
) {
  const hasRead = scopes.includes('repo:read');
  const hasWrite = scopes.includes('repo:write');

  // ── list_issues ─────────────────────────────────────────────────────
  server.tool(
    'list_issues',
    'List issues for a repository',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by state (default: open)'),
      limit: z.number().optional().describe('Max results (default 30)'),
      search: z.string().optional().describe('Search issues by text'),
    },
    async ({ owner, repo, state, limit, search }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const { issues } = await issueService.listIssues(repoData.id, {
          state: (state as any) ?? 'open',
          limit: limit ?? 30,
          search,
        });
        const data = issues.map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          author: i.author.username,
          labels: i.labels,
          priority: i.priority,
          comment_count: i.commentCount,
          created_at: i.createdAt?.toISOString() ?? null,
          updated_at: i.updatedAt?.toISOString() ?? null,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error listing issues: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_issue ───────────────────────────────────────────────────────
  server.tool(
    'get_issue',
    'Get details about a specific issue',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      number: z.number().describe('Issue number'),
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
        const issue = await issueService.getIssueByNumber(repoData.id, number);
        if (!issue) {
          return { content: [{ type: 'text', text: 'Issue not found' }], isError: true };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              number: issue.number,
              title: issue.title,
              body: issue.body,
              state: issue.state,
              author: issue.author.username,
              labels: issue.labels,
              priority: issue.priority,
              comment_count: issue.commentCount,
              created_at: issue.createdAt?.toISOString() ?? null,
              updated_at: issue.updatedAt?.toISOString() ?? null,
              closed_at: issue.closedAt?.toISOString() ?? null,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error getting issue: ${err.message}` }], isError: true };
      }
    },
  );

  // ── create_issue ────────────────────────────────────────────────────
  server.tool(
    'create_issue',
    'Create a new issue in a repository',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      title: z.string().min(1).max(255).describe('Issue title'),
      body: z.string().optional().describe('Issue body/description'),
      labels: z.array(z.string()).optional().describe('Labels to apply'),
    },
    async ({ owner, repo, title, body, labels }) => {
      if (!hasWrite) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:write required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const issue = await issueService.createIssue({
          repositoryId: repoData.id,
          title,
          body,
          labels,
          authorId: userId,
        });

        const full = await issueService.getIssueByNumber(repoData.id, issue.number);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              number: (full ?? issue).number,
              title: (full ?? issue).title,
              state: (full ?? issue).state,
              labels: (full as any)?.labels ?? issue.labels,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error creating issue: ${err.message}` }], isError: true };
      }
    },
  );

  // ── update_issue ────────────────────────────────────────────────────
  server.tool(
    'update_issue',
    'Update an existing issue',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository slug'),
      number: z.number().describe('Issue number'),
      title: z.string().min(1).max(255).optional().describe('New title'),
      body: z.string().optional().describe('New body'),
      state: z.enum(['open', 'closed']).optional().describe('New state'),
      labels: z.array(z.string()).optional().describe('Replace labels'),
    },
    async ({ owner, repo, number, title, body, state, labels }) => {
      if (!hasWrite) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:write required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const existing = await issueService.getIssueByNumber(repoData.id, number);
        if (!existing) {
          return { content: [{ type: 'text', text: 'Issue not found' }], isError: true };
        }

        await issueService.updateIssue(existing.id, {
          title,
          body,
          state: state as any,
          labels,
        }, userId);

        const updated = await issueService.getIssueByNumber(repoData.id, number);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              number: updated!.number,
              title: updated!.title,
              state: updated!.state,
              labels: updated!.labels,
              updated_at: updated!.updatedAt?.toISOString() ?? null,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error updating issue: ${err.message}` }], isError: true };
      }
    },
  );
}
