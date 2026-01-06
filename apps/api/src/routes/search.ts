/**
 * Federated Search Routes
 * Search endpoints for cv-git CLI integration
 *
 * These endpoints allow searching across:
 * - Multiple repositories
 * - Code content (semantic search via Qdrant)
 * - Symbols (via FalkorDB graph)
 * - Graph queries (federated across repos)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { db } from '../db';
import { repositories } from '../db/schema';
import { eq, and, or, ilike, inArray } from 'drizzle-orm';
import { requireAuth, optionalAuth } from '../middleware/auth';
import {
  canUserAccessRepo,
  getUserAccessibleRepositories,
} from '../services/repository.service';
import { getGraphManager } from '../services/graph';
import type { GraphQuery } from '../services/graph';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';
import {
  isEmbeddingServiceAvailable,
  generateEmbedding,
} from '../services/embedding.service';
import {
  isVectorServiceAvailable,
  searchVectorsMultiRepo,
  getCollectionInfo,
} from '../services/vector.service';

const searchRoutes = new Hono<AppEnv>();

// ============================================================================
// Symbol Search
// ============================================================================

/**
 * POST /api/v1/search/symbols
 * Search for symbols across repositories
 */
const symbolSearchSchema = z.object({
  query: z.string().min(1).max(200),
  repos: z.array(z.string()).optional(), // owner/repo format
  kinds: z.array(z.enum(['function', 'method', 'class', 'interface', 'type', 'struct', 'enum', 'constant', 'variable'])).optional(),
  limit: z.number().min(1).max(100).optional(),
});

searchRoutes.post('/search/symbols', optionalAuth, zValidator('json', symbolSearchSchema), async (c) => {
  const { query, repos, kinds, limit = 50 } = c.req.valid('json');
  const userId = c.get('userId');

  // Get accessible repositories
  let targetRepoIds: string[] = [];

  if (repos && repos.length > 0) {
    // Search in specific repos
    for (const repoPath of repos) {
      const [owner, repoSlug] = repoPath.split('/');
      if (!owner || !repoSlug) continue;

      const repo = await db.query.repositories.findFirst({
        where: eq(repositories.slug, repoSlug),
        with: {
          organization: true,
          owner: true,
        },
      });

      if (!repo) continue;

      const ownerSlug = repo.organization?.slug || repo.owner?.username;
      if (ownerSlug !== owner) continue;

      const canAccess = await canUserAccessRepo(repo.id, userId || null);
      if (canAccess) {
        targetRepoIds.push(repo.id);
      }
    }
  } else if (userId) {
    // Search in all accessible repos for authenticated user
    const accessibleRepos = await getUserAccessibleRepositories(userId, { limit: 100 });
    targetRepoIds = accessibleRepos.map(r => r.id);
  } else {
    // For unauthenticated users, only search public repos
    const publicRepos = await db.query.repositories.findMany({
      where: eq(repositories.visibility, 'public'),
      limit: 100,
    });
    targetRepoIds = publicRepos.map(r => r.id);
  }

  if (targetRepoIds.length === 0) {
    return c.json({
      results: [],
      total: 0,
    });
  }

  // Search across graphs
  const results: any[] = [];

  for (const repoId of targetRepoIds.slice(0, 10)) { // Limit to 10 repos for performance
    try {
      const graph = await getGraphManager(repoId);

      // Build kind filter
      const kindFilter = kinds && kinds.length > 0
        ? `AND s.kind IN [${kinds.map(k => `'${k}'`).join(', ')}]`
        : '';

      const searchResults = await graph.query(`
        MATCH (s:Symbol)
        WHERE (s.name CONTAINS $query OR s.qualifiedName CONTAINS $query)
          ${kindFilter}
        RETURN s
        LIMIT ${limit}
      `, { query });

      for (const result of searchResults) {
        results.push({
          repositoryId: repoId,
          symbol: result.s,
        });
      }
    } catch (error) {
      // Skip repos with errors
      console.warn(`[Search] Error searching repo ${repoId}:`, error);
    }
  }

  return c.json({
    results: results.slice(0, limit),
    total: results.length,
    searchedRepos: targetRepoIds.length,
  });
});

// ============================================================================
// Graph Query (Federated)
// ============================================================================

/**
 * POST /api/v1/search/graph
 * Execute a graph query across multiple repositories
 */
const graphSearchSchema = z.object({
  query: z.object({
    type: z.enum(['calls', 'calledBy', 'imports', 'importedBy', 'defines', 'inherits', 'path', 'custom']),
    target: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    maxDepth: z.number().optional(),
    cypher: z.string().optional(),
    params: z.record(z.any()).optional(),
  }),
  repos: z.array(z.string()).optional(), // owner/repo format
  limit: z.number().min(1).max(100).optional(),
});

searchRoutes.post('/search/graph', optionalAuth, zValidator('json', graphSearchSchema), async (c) => {
  const { query, repos, limit = 50 } = c.req.valid('json');
  const userId = c.get('userId');

  // Get accessible repositories (same logic as symbol search)
  let targetRepoIds: string[] = [];

  if (repos && repos.length > 0) {
    for (const repoPath of repos) {
      const [owner, repoSlug] = repoPath.split('/');
      if (!owner || !repoSlug) continue;

      const repo = await db.query.repositories.findFirst({
        where: eq(repositories.slug, repoSlug),
        with: {
          organization: true,
          owner: true,
        },
      });

      if (!repo) continue;

      const ownerSlug = repo.organization?.slug || repo.owner?.username;
      if (ownerSlug !== owner) continue;

      const canAccess = await canUserAccessRepo(repo.id, userId || null);
      if (canAccess) {
        targetRepoIds.push(repo.id);
      }
    }
  } else if (userId) {
    const accessibleRepos = await getUserAccessibleRepositories(userId, { limit: 100 });
    targetRepoIds = accessibleRepos.map(r => r.id);
  } else {
    const publicRepos = await db.query.repositories.findMany({
      where: eq(repositories.visibility, 'public'),
      limit: 100,
    });
    targetRepoIds = publicRepos.map(r => r.id);
  }

  if (targetRepoIds.length === 0) {
    return c.json({
      results: [],
      total: 0,
    });
  }

  // Execute query across graphs
  const results: any[] = [];

  for (const repoId of targetRepoIds.slice(0, 10)) {
    try {
      const graph = await getGraphManager(repoId);
      const queryResults = await graph.executeQuery(query as GraphQuery);

      for (const result of queryResults) {
        results.push({
          repositoryId: repoId,
          ...result,
        });
      }
    } catch (error) {
      console.warn(`[Search] Error querying repo ${repoId}:`, error);
    }
  }

  return c.json({
    query,
    results: results.slice(0, limit),
    total: results.length,
    searchedRepos: targetRepoIds.length,
  });
});

// ============================================================================
// Code Search (Text-based)
// ============================================================================

/**
 * POST /api/v1/search/code
 * Search for code patterns across repositories
 * Note: Full semantic search requires Qdrant integration (future enhancement)
 */
const codeSearchSchema = z.object({
  query: z.string().min(1).max(500),
  repos: z.array(z.string()).optional(),
  language: z.string().optional(),
  limit: z.number().min(1).max(100).optional(),
});

searchRoutes.post('/search/code', optionalAuth, zValidator('json', codeSearchSchema), async (c) => {
  const { query, repos, language, limit = 50 } = c.req.valid('json');
  const userId = c.get('userId');

  // Get accessible repositories
  let targetRepoIds: string[] = [];

  if (repos && repos.length > 0) {
    for (const repoPath of repos) {
      const [owner, repoSlug] = repoPath.split('/');
      if (!owner || !repoSlug) continue;

      const repo = await db.query.repositories.findFirst({
        where: eq(repositories.slug, repoSlug),
        with: {
          organization: true,
          owner: true,
        },
      });

      if (!repo) continue;

      const ownerSlug = repo.organization?.slug || repo.owner?.username;
      if (ownerSlug !== owner) continue;

      const canAccess = await canUserAccessRepo(repo.id, userId || null);
      if (canAccess) {
        targetRepoIds.push(repo.id);
      }
    }
  } else if (userId) {
    const accessibleRepos = await getUserAccessibleRepositories(userId, { limit: 100 });
    targetRepoIds = accessibleRepos.map(r => r.id);
  } else {
    const publicRepos = await db.query.repositories.findMany({
      where: eq(repositories.visibility, 'public'),
      limit: 100,
    });
    targetRepoIds = publicRepos.map(r => r.id);
  }

  if (targetRepoIds.length === 0) {
    return c.json({
      results: [],
      total: 0,
    });
  }

  // Search files in graph (by name pattern)
  const results: any[] = [];

  for (const repoId of targetRepoIds.slice(0, 10)) {
    try {
      const graph = await getGraphManager(repoId);

      const langFilter = language ? `AND f.language = '${language}'` : '';

      const fileResults = await graph.query(`
        MATCH (f:File)
        WHERE f.path CONTAINS $query ${langFilter}
        RETURN f
        LIMIT ${limit}
      `, { query });

      for (const result of fileResults) {
        results.push({
          repositoryId: repoId,
          file: result.f,
        });
      }
    } catch (error) {
      console.warn(`[Search] Error searching repo ${repoId}:`, error);
    }
  }

  // Note: For full code content search, we would need to:
  // 1. Use Qdrant for semantic vector search
  // 2. Or grep through git objects
  // This is a basic file path search for now

  return c.json({
    results: results.slice(0, limit),
    total: results.length,
    searchedRepos: targetRepoIds.length,
    note: 'Currently searching file paths. Semantic code search coming soon.',
  });
});

// ============================================================================
// Repository Search
// ============================================================================

/**
 * GET /api/v1/search/repos
 * Search for repositories by name/description
 */
const repoSearchSchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().min(1).max(100).optional(),
});

searchRoutes.get('/search/repos', optionalAuth, zValidator('query', repoSearchSchema), async (c) => {
  const { q, limit = 20 } = c.req.valid('query');
  const userId = c.get('userId');

  let accessibleRepos;
  if (userId) {
    accessibleRepos = await getUserAccessibleRepositories(userId, {
      search: q,
      limit,
    });
  } else {
    // Public search
    accessibleRepos = await db.query.repositories.findMany({
      where: and(
        eq(repositories.visibility, 'public'),
        or(
          ilike(repositories.name, `%${q}%`),
          ilike(repositories.description, `%${q}%`)
        )
      ),
      with: {
        organization: true,
        owner: true,
      },
      limit,
    });
  }

  return c.json({
    repositories: accessibleRepos.map(repo => {
      // Handle both RepositoryWithStats and raw query results
      const repoAny = repo as any;
      const ownerSlug = repoAny.owner?.slug || repoAny.owner?.username || repoAny.organization?.slug || null;
      return {
        id: repo.id,
        name: repo.name,
        slug: repo.slug,
        description: repo.description,
        visibility: repo.visibility,
        starCount: repo.starCount ?? 0,
        owner: ownerSlug,
      };
    }),
    total: accessibleRepos.length,
  });
});

// ============================================================================
// Semantic Search (Vector-based)
// ============================================================================

/**
 * POST /api/v1/search/semantic
 * Search using semantic similarity (requires embeddings)
 */
const semanticSearchSchema = z.object({
  query: z.string().min(1).max(500),
  repos: z.array(z.string()).optional(),
  limit: z.number().min(1).max(50).optional(),
  filter: z.object({
    language: z.string().optional(),
    chunkType: z.string().optional(),
  }).optional(),
});

searchRoutes.post('/search/semantic', optionalAuth, zValidator('json', semanticSearchSchema), async (c) => {
  const { query, repos, limit = 20, filter } = c.req.valid('json');
  const userId = c.get('userId');

  // Check if services are available
  const embeddingAvailable = isEmbeddingServiceAvailable();
  const vectorAvailable = await isVectorServiceAvailable();

  if (!embeddingAvailable) {
    return c.json({
      error: 'Semantic search not available',
      reason: 'Embedding service not configured (no OPENROUTER_API_KEY)',
      results: [],
      total: 0,
    }, 503);
  }

  if (!vectorAvailable) {
    return c.json({
      error: 'Semantic search not available',
      reason: 'Vector database not reachable',
      results: [],
      total: 0,
    }, 503);
  }

  // Get accessible repositories
  let targetRepoIds: string[] = [];

  if (repos && repos.length > 0) {
    for (const repoPath of repos) {
      const [owner, repoSlug] = repoPath.split('/');
      if (!owner || !repoSlug) continue;

      const repo = await db.query.repositories.findFirst({
        where: eq(repositories.slug, repoSlug),
        with: {
          organization: true,
          owner: true,
        },
      });

      if (!repo) continue;

      const ownerSlug = repo.organization?.slug || repo.owner?.username;
      if (ownerSlug !== owner) continue;

      const canAccess = await canUserAccessRepo(repo.id, userId || null);
      if (canAccess) {
        targetRepoIds.push(repo.id);
      }
    }
  } else if (userId) {
    const accessibleRepos = await getUserAccessibleRepositories(userId, { limit: 50 });
    targetRepoIds = accessibleRepos.map(r => r.id);
  } else {
    const publicRepos = await db.query.repositories.findMany({
      where: eq(repositories.visibility, 'public'),
      limit: 50,
    });
    targetRepoIds = publicRepos.map(r => r.id);
  }

  if (targetRepoIds.length === 0) {
    return c.json({
      results: [],
      total: 0,
      searchedRepos: 0,
    });
  }

  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query);

    // Search across repositories
    const results = await searchVectorsMultiRepo(
      targetRepoIds,
      queryEmbedding.embedding,
      {
        limit,
        scoreThreshold: 0.3,
      }
    );

    // Format results
    const formattedResults = results.map(result => ({
      id: result.id,
      score: result.score,
      repositoryId: result.repositoryId,
      filePath: result.payload.filePath,
      language: result.payload.language,
      content: result.payload.content,
      startLine: result.payload.startLine,
      endLine: result.payload.endLine,
      chunkType: result.payload.chunkType,
      symbolName: result.payload.symbolName,
      symbolKind: result.payload.symbolKind,
    }));

    return c.json({
      query,
      results: formattedResults,
      total: formattedResults.length,
      searchedRepos: targetRepoIds.length,
      embeddingModel: queryEmbedding.model,
    });

  } catch (error: any) {
    console.error('[Search] Semantic search failed:', error);
    return c.json({
      error: 'Semantic search failed',
      reason: error.message,
      results: [],
      total: 0,
    }, 500);
  }
});

/**
 * GET /api/v1/search/status
 * Get search service status
 */
searchRoutes.get('/search/status', async (c) => {
  const embeddingAvailable = isEmbeddingServiceAvailable();
  const vectorAvailable = await isVectorServiceAvailable();

  return c.json({
    embedding: {
      available: embeddingAvailable,
      reason: embeddingAvailable ? 'configured' : 'OPENROUTER_API_KEY not set',
    },
    vector: {
      available: vectorAvailable,
      reason: vectorAvailable ? 'connected' : 'Qdrant not reachable',
    },
    semanticSearch: embeddingAvailable && vectorAvailable,
  });
});

export default searchRoutes;
