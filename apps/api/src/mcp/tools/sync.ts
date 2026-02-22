/**
 * MCP Tools: Graph Sync
 * Exposes graph synchronization trigger and status to AI agents via MCP
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';
import { enqueueGraphSync, getRepoSyncJobs } from '../../services/graph/graph-sync.service';

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerSyncTools(
  server: McpServer,
  userId: string,
  scopes: string[],
) {
  const hasRead = scopes.includes('repo:read');
  const hasWrite = scopes.includes('repo:write');

  // ── trigger_graph_sync ──────────────────────────────────────────────
  server.tool(
    'trigger_graph_sync',
    'Trigger a knowledge graph sync job for a repository (parses code, builds graph, generates embeddings)',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      job_type: z.enum(['full', 'delta', 'incremental']).optional()
        .describe('Sync type: full (rebuild), delta (changes since last sync), incremental (single ref)'),
    },
    async ({ owner, repo, job_type }) => {
      if (!hasWrite) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:write required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const jobId = await enqueueGraphSync(repoData.id, job_type ?? 'full');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              job_id: jobId,
              status: 'pending',
              message: `Graph sync job queued (${job_type ?? 'full'})`,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error triggering sync: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_sync_status ─────────────────────────────────────────────────
  server.tool(
    'get_sync_status',
    'Get the status of recent graph sync jobs for a repository',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      limit: z.number().optional().describe('Number of recent jobs to show (default 5)'),
    },
    async ({ owner, repo, limit }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const jobs = await getRepoSyncJobs(repoData.id, limit ?? 5);
        const data = jobs.map((j) => ({
          id: j.id,
          job_type: j.jobType,
          status: j.status,
          progress: j.progress,
          current_step: j.currentStep,
          nodes_created: j.nodesCreated,
          edges_created: j.edgesCreated,
          vectors_created: j.vectorsCreated,
          error_message: j.errorMessage,
          started_at: j.startedAt?.toISOString() ?? null,
          completed_at: j.completedAt?.toISOString() ?? null,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error getting sync status: ${err.message}` }], isError: true };
      }
    },
  );
}
