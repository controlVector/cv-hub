#!/usr/bin/env tsx
/**
 * Repository Sync Trigger Script
 *
 * Triggers graph sync jobs for imported repositories.
 * Run this after import-github-repos.ts to build knowledge graphs.
 *
 * Usage:
 *   DATABASE_URL=... REDIS_URL=... npx tsx scripts/sync-repos.ts
 *
 * Options:
 *   --org <slug>     Sync repos for specific organization (default: controlvector)
 *   --repo <slug>    Sync a specific repo only
 *   --type <type>    Sync type: full | incremental (default: full)
 *   --status         Just show sync status, don't trigger
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '../src/db/schema';

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name: string, defaultValue: string): string => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const ORG_SLUG = getArg('org', 'controlvector');
const REPO_SLUG = getArg('repo', '');
const SYNC_TYPE = getArg('type', 'full') as 'full' | 'incremental' | 'delta';
const STATUS_ONLY = hasFlag('status');

// Initialize database
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Get sync status for a repository
 */
async function getSyncStatus(repoId: string): Promise<void> {
  const jobs = await db.query.graphSyncJobs.findMany({
    where: eq(schema.graphSyncJobs.repositoryId, repoId),
    orderBy: [desc(schema.graphSyncJobs.createdAt)],
    limit: 5,
  });

  if (jobs.length === 0) {
    console.log('    No sync jobs found');
    return;
  }

  console.log('    Recent sync jobs:');
  for (const job of jobs) {
    const duration = job.completedAt && job.startedAt
      ? formatDuration(job.completedAt.getTime() - job.startedAt.getTime())
      : '-';

    let statusIcon = '⏳';
    if (job.status === 'synced') statusIcon = '✓';
    else if (job.status === 'failed') statusIcon = '✗';
    else if (job.status === 'syncing') statusIcon = '⟳';

    console.log(`      ${statusIcon} ${job.jobType} - ${job.status} (${duration})`);
    if (job.status === 'syncing' && job.currentStep) {
      console.log(`        Progress: ${job.progress}% - ${job.currentStep}`);
    }
    if (job.status === 'synced') {
      console.log(`        Nodes: ${job.nodesCreated}, Edges: ${job.edgesCreated}, Vectors: ${job.vectorsCreated}`);
    }
    if (job.status === 'failed' && job.errorMessage) {
      console.log(`        Error: ${job.errorMessage.substring(0, 80)}...`);
    }
  }
}

/**
 * Queue a sync job for a repository
 */
async function queueSyncJob(
  repoId: string,
  repoName: string,
  syncType: 'full' | 'incremental' | 'delta'
): Promise<string> {
  // Create job record in database
  const [job] = await db.insert(schema.graphSyncJobs).values({
    repositoryId: repoId,
    jobType: syncType,
    status: 'pending',
    progress: 0,
  }).returning();

  // Update repository sync status
  await db.update(schema.repositories)
    .set({
      graphSyncStatus: 'pending',
      updatedAt: new Date(),
    })
    .where(eq(schema.repositories.id, repoId));

  console.log(`    Queued ${syncType} sync job: ${job.id}`);

  return job.id;
}

/**
 * Main entry point
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║            Repository Sync Trigger                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Organization: ${ORG_SLUG}`);
  console.log(`Specific repo: ${REPO_SLUG || '(all)'}`);
  console.log(`Sync type: ${SYNC_TYPE}`);
  console.log(`Mode: ${STATUS_ONLY ? 'status only' : 'trigger sync'}`);
  console.log('');

  try {
    // Find organization
    const org = await db.query.organizations.findFirst({
      where: eq(schema.organizations.slug, ORG_SLUG),
    });

    if (!org) {
      console.error(`Organization not found: ${ORG_SLUG}`);
      console.log('Run import-github-repos.ts first to create the organization.');
      await pool.end();
      return;
    }

    // Build query conditions
    const conditions = [eq(schema.repositories.organizationId, org.id)];
    if (REPO_SLUG) {
      conditions.push(eq(schema.repositories.slug, REPO_SLUG));
    }

    // Find repositories
    const repos = await db.query.repositories.findMany({
      where: and(...conditions),
      orderBy: [desc(schema.repositories.updatedAt)],
    });

    if (repos.length === 0) {
      console.log('No repositories found.');
      await pool.end();
      return;
    }

    console.log(`Found ${repos.length} repositories:\n`);

    const jobIds: string[] = [];

    for (const repo of repos) {
      console.log(`  ${repo.name} (${repo.visibility})`);
      console.log(`    Path: ${repo.localPath || '(not set)'}`);
      console.log(`    Graph status: ${repo.graphSyncStatus}`);
      console.log(`    Last synced: ${repo.graphLastSyncedAt?.toISOString() || 'never'}`);

      if (STATUS_ONLY) {
        await getSyncStatus(repo.id);
      } else {
        const jobId = await queueSyncJob(repo.id, repo.name, SYNC_TYPE);
        jobIds.push(jobId);
      }

      console.log('');
    }

    if (!STATUS_ONLY && jobIds.length > 0) {
      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║                 Sync Jobs Queued                            ║');
      console.log('╚════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log(`Queued ${jobIds.length} sync jobs.`);
      console.log('');
      console.log('Next steps:');
      console.log('  1. Ensure the graph-sync worker is running');
      console.log('  2. Monitor progress: npx tsx scripts/sync-repos.ts --status');
      console.log('  3. Check worker logs for detailed progress');
      console.log('');
      console.log('Worker command (if not already running):');
      console.log('  node dist/workers/graph-sync.worker.js');
      console.log('');
    }

  } catch (error) {
    console.error('\nFatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
