/**
 * Graph API Routes
 * Knowledge graph endpoints for CV-Hub
 * Designed for cv-git CLI compatibility
 *
 * Base path: /api/v1/repos/:owner/:repo/graph
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db';
import { repositories } from '../db/schema';
import { eq, and, or } from 'drizzle-orm';
import {
  getGraphManager,
  enqueueGraphSync,
  getJobStatus,
  getRepoSyncJobs,
} from '../services/graph';
import type { GraphQuery } from '../services/graph';

const graphRoutes = new Hono();

// Query schema (cv-git compatible)
const graphQuerySchema = z.object({
  type: z.enum(['calls', 'calledBy', 'imports', 'importedBy', 'defines', 'inherits', 'path', 'custom']),
  target: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  maxDepth: z.number().optional(),
  cypher: z.string().optional(),
  params: z.record(z.any()).optional(),
});

/**
 * Helper to get repository by owner/slug
 */
async function getRepository(owner: string, repo: string) {
  // Try to find by organization slug first, then by user
  const repository = await db.query.repositories.findFirst({
    where: eq(repositories.slug, repo),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repository) {
    return null;
  }

  // Verify owner matches
  const ownerSlug = repository.organization?.slug || repository.owner?.username;
  if (ownerSlug !== owner) {
    return null;
  }

  return repository;
}

/**
 * GET /stats
 * Get graph statistics
 */
graphRoutes.get('/:owner/:repo/graph/stats', async (c) => {
  const { owner, repo } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const stats = await graph.getStats();

    return c.json({
      success: true,
      data: {
        ...stats,
        syncStatus: repository.graphSyncStatus,
        lastSyncedAt: repository.graphLastSyncedAt,
        syncError: repository.graphSyncError,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /query
 * Execute a graph query (cv-git compatible format)
 */
graphRoutes.post(
  '/:owner/:repo/graph/query',
  zValidator('json', graphQuerySchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const query = c.req.valid('json') as GraphQuery;

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const graph = await getGraphManager(repository.id);
      const results = await graph.executeQuery(query);

      return c.json({
        success: true,
        data: {
          query,
          results,
          count: results.length,
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  }
);

/**
 * GET /symbol/:name
 * Get symbol details and usage
 */
graphRoutes.get('/:owner/:repo/graph/symbol/:name', async (c) => {
  const { owner, repo, name } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const usage = await graph.getSymbolUsage(name);

    if (!usage) {
      return c.json({ error: 'Symbol not found' }, 404);
    }

    return c.json({
      success: true,
      data: usage,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /file/:path
 * Get file details and symbols
 */
graphRoutes.get('/:owner/:repo/graph/file/*', async (c) => {
  const { owner, repo } = c.req.param();
  const path = c.req.path.split('/graph/file/')[1] || '';

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const [fileNode, symbols, dependencies, dependents] = await Promise.all([
      graph.getFileNode(path),
      graph.getFileSymbols(path),
      graph.getFileDependencies(path),
      graph.getFileDependents(path),
    ]);

    if (!fileNode) {
      return c.json({ error: 'File not found in graph' }, 404);
    }

    return c.json({
      success: true,
      data: {
        file: fileNode,
        symbols: symbols.map(r => r.s),
        dependencies: dependencies.map(r => r.dep),
        dependents: dependents.map(r => r.dependent),
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /analysis/dead-code
 * Find potential dead code (uncalled functions)
 */
graphRoutes.get('/:owner/:repo/graph/analysis/dead-code', async (c) => {
  const { owner, repo } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const deadCode = await graph.findDeadCode();

    return c.json({
      success: true,
      data: {
        count: deadCode.length,
        symbols: deadCode,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /analysis/complexity
 * Find complexity hotspots
 */
graphRoutes.get('/:owner/:repo/graph/analysis/complexity', async (c) => {
  const { owner, repo } = c.req.param();
  const threshold = parseInt(c.req.query('threshold') || '10');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const hotspots = await graph.findComplexityHotspots(threshold);

    return c.json({
      success: true,
      data: {
        threshold,
        count: hotspots.length,
        symbols: hotspots,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /analysis/call-paths
 * Find call paths between two symbols
 */
graphRoutes.get('/:owner/:repo/graph/analysis/call-paths', async (c) => {
  const { owner, repo } = c.req.param();
  const from = c.req.query('from');
  const to = c.req.query('to');
  const maxDepth = parseInt(c.req.query('maxDepth') || '10');

  if (!from || !to) {
    return c.json({ error: 'Both "from" and "to" query parameters are required' }, 400);
  }

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const paths = await graph.findCallPaths(from, to, maxDepth);

    return c.json({
      success: true,
      data: {
        from,
        to,
        maxDepth,
        paths: paths.map(r => r.path),
        count: paths.length,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /sync
 * Trigger a graph sync job
 */
graphRoutes.post('/:owner/:repo/graph/sync', async (c) => {
  const { owner, repo } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const jobType = body.jobType || 'full';

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  // Check if sync is already in progress
  if (repository.graphSyncStatus === 'syncing') {
    return c.json({
      error: 'Sync already in progress',
      status: repository.graphSyncStatus,
    }, 409);
  }

  try {
    const jobId = await enqueueGraphSync(repository.id, jobType);

    return c.json({
      success: true,
      data: {
        jobId,
        jobType,
        status: 'pending',
        message: 'Graph sync job enqueued',
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /sync/status
 * Get the current sync status
 */
graphRoutes.get('/:owner/:repo/graph/sync/status', async (c) => {
  const { owner, repo } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    // Get recent sync jobs
    const jobs = await getRepoSyncJobs(repository.id, 5);

    return c.json({
      success: true,
      data: {
        status: repository.graphSyncStatus,
        lastSyncedAt: repository.graphLastSyncedAt,
        syncError: repository.graphSyncError,
        recentJobs: jobs.map(job => ({
          id: job.id,
          jobType: job.jobType,
          status: job.status,
          progress: job.progress,
          currentStep: job.currentStep,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          nodesCreated: job.nodesCreated,
          edgesCreated: job.edgesCreated,
        })),
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /sync/job/:jobId
 * Get status of a specific sync job
 */
graphRoutes.get('/:owner/:repo/graph/sync/job/:jobId', async (c) => {
  const { owner, repo, jobId } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const job = await getJobStatus(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    // Verify job belongs to this repo
    if (job.repositoryId !== repository.id) {
      return c.json({ error: 'Job not found' }, 404);
    }

    return c.json({
      success: true,
      data: job,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /cypher
 * Execute a raw Cypher query (admin/advanced use)
 */
graphRoutes.post(
  '/:owner/:repo/graph/cypher',
  zValidator('json', z.object({
    query: z.string(),
    params: z.record(z.any()).optional(),
  })),
  async (c) => {
    const { owner, repo } = c.req.param();
    const { query, params } = c.req.valid('json');

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Security: Only allow read queries for now
    const lowerQuery = query.toLowerCase().trim();
    if (
      lowerQuery.includes('delete') ||
      lowerQuery.includes('remove') ||
      lowerQuery.includes('drop') ||
      lowerQuery.includes('create') ||
      lowerQuery.includes('merge') ||
      lowerQuery.includes('set')
    ) {
      return c.json({ error: 'Write operations not allowed via this endpoint' }, 403);
    }

    try {
      const graph = await getGraphManager(repository.id);
      const results = await graph.query(query, params);

      return c.json({
        success: true,
        data: {
          results,
          count: results.length,
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  }
);

export default graphRoutes;
