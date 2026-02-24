/**
 * MCP Tools: Repository Context
 * Provides AI-generated context (summaries, architecture, key files/symbols)
 * for repositories that have been graph-synced.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';
import { getGraphManager } from '../../services/graph/graph.service';
import { getStructuredContext } from '../../services/context-generation.service';
import * as gitBackend from '../../services/git/git-backend.service';

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerContextTools(
  server: McpServer,
  userId: string,
  scopes: string[],
) {
  const hasRead = scopes.includes('repo:read');

  // ── get_repo_context ────────────────────────────────────────────────
  server.tool(
    'get_repo_context',
    'Get AI-generated repository context including summary, architecture, key files/symbols, and graph stats',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
    },
    async ({ owner, repo }) => {
      if (!hasRead) {
        return { content: [{ type: 'text' as const, text: 'Insufficient scope: repo:read required' }], isError: true };
      }

      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text' as const, text: 'Repository not found or access denied' }], isError: true };
      }

      try {
        const ownerSlug = repoData.owner?.slug || owner;
        const graph = await getGraphManager(repoData.id);
        const context = await getStructuredContext(
          repoData,
          ownerSlug,
          repoData.slug,
          graph
        );

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(context, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error fetching context: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  // ── get_context_at_ref ──────────────────────────────────────────────
  server.tool(
    'get_context_at_ref',
    'Read the CLAUDE.md context file at a specific branch or commit SHA',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      ref: z.string().optional().describe('Branch name or commit SHA (default: HEAD)'),
    },
    async ({ owner, repo, ref }) => {
      if (!hasRead) {
        return { content: [{ type: 'text' as const, text: 'Insufficient scope: repo:read required' }], isError: true };
      }

      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text' as const, text: 'Repository not found or access denied' }], isError: true };
      }

      try {
        const ownerSlug = repoData.owner?.slug || owner;
        const targetRef = ref || repoData.defaultBranch || 'HEAD';
        const blob = await gitBackend.getBlob(ownerSlug, repoData.slug, targetRef, 'CLAUDE.md');

        if (blob.isBinary) {
          return {
            content: [{ type: 'text' as const, text: 'CLAUDE.md appears to be binary — unexpected' }],
            isError: true,
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: blob.content,
          }],
        };
      } catch (err: any) {
        if (err.message?.includes('File not found') || err.message?.includes('not found')) {
          return {
            content: [{ type: 'text' as const, text: 'CLAUDE.md not found at this ref. Run a graph sync with AI summaries to generate it.' }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text' as const, text: `Error reading CLAUDE.md: ${err.message}` }],
          isError: true,
        };
      }
    },
  );
}
