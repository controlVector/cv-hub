import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../services/repository.service';
import { getGraphManager } from '../services/graph/graph.service';

import type { AppEnv } from '../app';

const safety = new Hono<AppEnv>();

safety.use('*', requireAuth);

function getUserId(c: any): string {
  const userId = c.get('userId');
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

// ============================================================================
// POST /api/v1/repos/:owner/:repo/safety/check — Run safety analysis
// ============================================================================

const checkSchema = z.object({
  complexity_threshold: z.number().optional(),
});

safety.post(
  '/:owner/:repo/safety/check',
  zValidator('json', checkSchema),
  async (c) => {
    const userId = getUserId(c);
    const owner = c.req.param('owner');
    const repoSlug = c.req.param('repo');
    const { complexity_threshold } = c.req.valid('json');

    const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
    if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
      return c.json({ error: 'Repository not found or access denied' }, 404);
    }

    try {
      const gm = await getGraphManager(repo.id);

      const [deadCode, hotspots, stats, circularImports, orphanFiles] = await Promise.all([
        gm.findDeadCode(),
        gm.findComplexityHotspots(complexity_threshold ?? 10),
        gm.getStats(),
        gm.query(`
          MATCH (a:File)-[:IMPORTS]->(b:File)-[:IMPORTS]->(a)
          WHERE a.path < b.path
          RETURN a.path AS fileA, b.path AS fileB
          LIMIT 20
        `),
        gm.query(`
          MATCH (f:File)
          WHERE NOT (f)-[:IMPORTS]->() AND NOT ()-[:IMPORTS]->(f)
            AND NOT f.path ENDS WITH '.json'
            AND NOT f.path ENDS WITH '.md'
          RETURN f.path AS path, f.language AS language
          LIMIT 30
        `),
      ]);

      const riskLevel = deadCode.length > 20 || hotspots.length > 10 ? 'high' :
                        deadCode.length > 5 || hotspots.length > 3 ? 'medium' : 'low';

      return c.json({
        report: {
          risk_level: riskLevel,
          stats: {
            files: stats.fileCount,
            symbols: stats.symbolCount,
            functions: stats.functionCount,
            relationships: stats.relationshipCount,
          },
          dead_code: deadCode.slice(0, 25).map((s) => ({
            name: s.qualifiedName || s.name,
            kind: s.kind,
            file: s.file,
            line: s.startLine,
          })),
          dead_code_total: deadCode.length,
          complexity_hotspots: hotspots.slice(0, 15).map((s) => ({
            name: s.qualifiedName || s.name,
            complexity: s.complexity,
            file: s.file,
            line: s.startLine,
          })),
          circular_imports: circularImports.map((r: any) => ({
            file_a: r.fileA,
            file_b: r.fileB,
          })),
          orphan_files: orphanFiles.map((r: any) => ({
            path: r.path,
            language: r.language,
          })),
          checked_at: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      return c.json({ error: `Safety check failed: ${err.message}` }, 500);
    }
  },
);

export { safety as safetyRoutes };
