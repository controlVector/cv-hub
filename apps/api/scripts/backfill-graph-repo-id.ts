/**
 * Backfill repoId and orgId on existing SessionKnowledge nodes in FalkorDB.
 *
 * Since each graph is named repo_{repositoryId}, we know the repoId for
 * all SK nodes in that graph. This script:
 *   1. Lists all repositories with graphs
 *   2. For each graph, sets repoId on all SK nodes that lack it
 *   3. Also sets orgId from the repository's organizationId
 *
 * Usage: npx tsx apps/api/scripts/backfill-graph-repo-id.ts
 */

import { db } from '../src/db';
import { repositories } from '../src/db/schema';
import { getGraphManager } from '../src/services/graph/graph.service';

async function main() {
  console.log('[Backfill] Starting graph repoId/orgId backfill...');

  const repos = await db.query.repositories.findMany({
    columns: { id: true, slug: true, organizationId: true },
  });

  console.log(`[Backfill] Found ${repos.length} repositories`);

  let totalUpdated = 0;

  for (const repo of repos) {
    try {
      const gm = await getGraphManager(repo.id);

      // Count SK nodes without repoId
      const countResult = await gm.query(
        `MATCH (sk:SessionKnowledge) WHERE sk.repoId IS NULL RETURN count(sk) AS cnt`,
      );
      const count = (countResult[0] as any)?.cnt ?? 0;

      if (count === 0) {
        continue;
      }

      console.log(`[Backfill] Repo ${repo.slug}: ${count} SK nodes to update`);

      // Set repoId and orgId on all SK nodes in this graph
      await gm.query(
        `MATCH (sk:SessionKnowledge)
         WHERE sk.repoId IS NULL
         SET sk.repoId = $repoId, sk.orgId = $orgId`,
        {
          repoId: repo.id,
          orgId: repo.organizationId || null,
        },
      );

      totalUpdated += count;
      console.log(`[Backfill] Repo ${repo.slug}: updated ${count} SK nodes`);
    } catch (err) {
      // Graph might not exist for this repo — skip
      console.warn(`[Backfill] Repo ${repo.slug}: skipped (${(err as Error).message})`);
    }
  }

  console.log(`[Backfill] Done. Total SK nodes updated: ${totalUpdated}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
