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
import { eq } from 'drizzle-orm';
import {
  getGraphManager,
  enqueueGraphSync,
  getJobStatus,
  getRepoSyncJobs,
} from '../services/graph';
import type { GraphQuery } from '../services/graph';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { canUserAccessRepo } from '../services/repository.service';
import type { AppEnv } from '../app';

const graphRoutes = new Hono<AppEnv>();

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
 * Helper to get repository by owner/slug with access control
 */
async function getRepository(owner: string, repo: string, userId: string | null) {
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

  // Enforce access control — same rules as code browsing
  const canAccess = await canUserAccessRepo(repository.id, userId);
  if (!canAccess) {
    return null;
  }

  return repository;
}

/**
 * GET /stats
 * Get graph statistics
 */
graphRoutes.get('/:owner/:repo/graph/stats', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;

  const repository = await getRepository(owner, repo, userId);
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
  optionalAuth,
  zValidator('json', graphQuerySchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId') ?? null;
    const query = c.req.valid('json') as GraphQuery;

    const repository = await getRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Custom Cypher queries require auth and are read-only
    if (query.type === 'custom') {
      if (!userId) {
        return c.json({ error: 'Authentication required for custom queries' }, 401);
      }
      if (query.cypher) {
        const lowerCypher = query.cypher.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!lowerCypher.startsWith('match ') && !lowerCypher.startsWith('return ') && !lowerCypher.startsWith('optional match ')) {
          return c.json({ error: 'Only read queries (MATCH/RETURN) are allowed' }, 403);
        }
      }
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
graphRoutes.get('/:owner/:repo/graph/symbol/:name', optionalAuth, async (c) => {
  const { owner, repo, name } = c.req.param();
  const userId = c.get('userId') ?? null;

  const repository = await getRepository(owner, repo, userId);
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
graphRoutes.get('/:owner/:repo/graph/file/*', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;
  const path = c.req.path.split('/graph/file/')[1] || '';
  if (path.includes('..')) {
    return c.json({ error: 'Invalid file path' }, 400);
  }

  const repository = await getRepository(owner, repo, userId);
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
graphRoutes.get('/:owner/:repo/graph/analysis/dead-code', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;

  const repository = await getRepository(owner, repo, userId);
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
graphRoutes.get('/:owner/:repo/graph/analysis/complexity', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;
  const threshold = Math.max(0, Math.min(parseInt(c.req.query('threshold') || '10', 10) || 10, 100));

  const repository = await getRepository(owner, repo, userId);
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
graphRoutes.get('/:owner/:repo/graph/analysis/call-paths', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;
  const from = c.req.query('from');
  const to = c.req.query('to');
  const maxDepth = Math.max(1, Math.min(parseInt(c.req.query('maxDepth') || '5', 10) || 5, 10));

  if (!from || !to) {
    return c.json({ error: 'Both "from" and "to" query parameters are required' }, 400);
  }

  const repository = await getRepository(owner, repo, userId);
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
graphRoutes.post('/:owner/:repo/graph/sync', requireAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;
  const body = await c.req.json().catch(() => ({}));
  const jobType = body.jobType || 'full';

  const repository = await getRepository(owner, repo, userId);
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
graphRoutes.get('/:owner/:repo/graph/sync/status', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;

  const repository = await getRepository(owner, repo, userId);
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
graphRoutes.get('/:owner/:repo/graph/sync/job/:jobId', optionalAuth, async (c) => {
  const { owner, repo, jobId } = c.req.param();
  const userId = c.get('userId') ?? null;

  const repository = await getRepository(owner, repo, userId);
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
 * Execute a raw Cypher query (org admin only, read-only)
 */
graphRoutes.post(
  '/:owner/:repo/graph/cypher',
  requireAuth,
  zValidator('json', z.object({
    query: z.string(),
    params: z.record(z.any()).optional(),
  })),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId')!;
    const { query, params } = c.req.valid('json');

    const repository = await getRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Require org admin for raw Cypher access
    try {
      const { isOrgAdmin } = await import('../services/organization.service');
      if (!await isOrgAdmin(repository.organizationId, userId)) {
        return c.json({ error: 'Only organization admins can execute raw Cypher queries' }, 403);
      }
    } catch {
      return c.json({ error: 'Authorization check failed' }, 500);
    }

    // Security: Only allow queries starting with MATCH or RETURN (read-only)
    const lowerQuery = query.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!lowerQuery.startsWith('match ') && !lowerQuery.startsWith('return ') && !lowerQuery.startsWith('optional match ')) {
      return c.json({ error: 'Only read queries (MATCH/RETURN) are allowed via this endpoint' }, 403);
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

// ========== Visualization Endpoints ==========

/**
 * GET /viz/dependencies
 * Get file dependency graph
 */
graphRoutes.get('/:owner/:repo/graph/viz/dependencies', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '300', 10) || 300, 1000));

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const data = await graph.getFileDependencyGraph(limit);
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /viz/calls
 * Get call graph
 */
graphRoutes.get('/:owner/:repo/graph/viz/calls', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;
  const symbol = c.req.query('symbol');
  const depth = Math.max(1, Math.min(parseInt(c.req.query('depth') || '2', 10) || 2, 5));

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const data = await graph.getCallGraph(symbol, depth);
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /viz/modules
 * Get module hierarchy
 */
graphRoutes.get('/:owner/:repo/graph/viz/modules', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const data = await graph.getModuleHierarchy();
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /viz/complexity
 * Get complexity heatmap
 */
graphRoutes.get('/:owner/:repo/graph/viz/complexity', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;
  const threshold = Math.max(0, Math.min(parseInt(c.req.query('threshold') || '0', 10) || 0, 100));
  const rawType = c.req.query('type') || 'file';
  const type: 'file' | 'symbol' = rawType === 'symbol' ? 'symbol' : 'file';

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const data = await graph.getComplexityHeatmap(type, threshold);
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /viz/heatmap
 * Get heatmap data by metric (recency, frequency, churn)
 */
graphRoutes.get('/:owner/:repo/graph/viz/heatmap', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;
  const rawMetric = c.req.query('metric') || 'recency';
  const metric: 'recency' | 'frequency' | 'churn' = ['recency', 'frequency', 'churn'].includes(rawMetric)
    ? (rawMetric as 'recency' | 'frequency' | 'churn')
    : 'recency';

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const data = await graph.getHeatmapByMetric(metric);
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ========== Summary Endpoint ==========

/**
 * GET /summary
 * Get repository summary
 */
graphRoutes.get('/:owner/:repo/graph/summary', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    // Import inline to avoid circular deps
    const { getRepositorySummary } = await import('../services/summarization.service');
    const summary = await getRepositorySummary(repository.id);

    return c.json({
      success: true,
      data: summary || null,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ========== Timeline & Impact Endpoints ==========

/**
 * GET /timeline/file/:path
 * Get commit history for a file via MODIFIES edges
 */
graphRoutes.get('/:owner/:repo/graph/timeline/file/*', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;
  const filePath = c.req.path.split('/graph/timeline/file/')[1] || '';
  if (filePath.includes('..')) {
    return c.json({ error: 'Invalid file path' }, 400);
  }
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100));

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const timeline = await graph.getFileTimeline(filePath, limit);
    return c.json({ success: true, data: { filePath, timeline, count: timeline.length } });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /timeline/symbol/:qualifiedName
 * Get commit history for a symbol via TOUCHES edges
 */
graphRoutes.get('/:owner/:repo/graph/timeline/symbol/:qualifiedName', optionalAuth, async (c) => {
  const { owner, repo, qualifiedName } = c.req.param();
  const userId = c.get('userId') ?? null;
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100));

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const timeline = await graph.getSymbolTimeline(decodeURIComponent(qualifiedName), limit);
    return c.json({ success: true, data: { qualifiedName, timeline, count: timeline.length } });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /impact/:qualifiedName
 * Get impact analysis for a symbol
 */
graphRoutes.get('/:owner/:repo/graph/impact/:qualifiedName', optionalAuth, async (c) => {
  const { owner, repo, qualifiedName } = c.req.param();
  const userId = c.get('userId') ?? null;
  const depth = Math.max(1, Math.min(parseInt(c.req.query('depth') || '2', 10) || 2, 5));

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const graph = await getGraphManager(repository.id);
    const impact = await graph.getImpactAnalysis(decodeURIComponent(qualifiedName), depth);
    return c.json({
      success: true,
      data: {
        qualifiedName,
        callers: impact.callers,
        coChanged: impact.coChanged,
        callerCount: impact.callers.length,
        coChangedCount: impact.coChanged.length,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /context
 * Get structured AI-generated context (summary, architecture, key files/symbols, etc.)
 */
graphRoutes.get('/:owner/:repo/graph/context', optionalAuth, async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId') ?? null;

  const repository = await getRepository(owner, repo, userId);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const { getStructuredContext } = await import('../services/context-generation.service');
    const graph = await getGraphManager(repository.id);
    const ownerSlug = repository.organization?.slug || repository.owner?.username || owner;
    const context = await getStructuredContext(repository, ownerSlug, repository.slug, graph);
    return c.json({ success: true, data: context });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default graphRoutes;
