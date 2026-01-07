#!/usr/bin/env tsx
/**
 * GitHub Repository Import Script
 *
 * Mirrors GitHub repos to cv-hub as the primary source.
 * GitHub becomes a read-only backup after import.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/import-github-repos.ts
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 *   GITHUB_TOKEN - (optional) GitHub API token for higher rate limits
 *   GIT_STORAGE_PATH - Path to store bare repos (default: /data/git)
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, and } from 'drizzle-orm';
import { simpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import path from 'path';
import * as schema from '../src/db/schema';

// Configuration
const GITHUB_ORG = 'controlvector';
const GIT_STORAGE_PATH = process.env.GIT_STORAGE_PATH || '/data/git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Repos to import (add more as needed)
const REPOS_TO_IMPORT = [
  'cv-git',
  'cv-prd',
  'cv-hub',
  // 'cv-parts', // TODO: Add later when ready
];

// Types
interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics: string[];
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

// Initialize database
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

/**
 * Fetch repositories from GitHub API
 */
async function fetchGitHubRepos(): Promise<GitHubRepo[]> {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'cv-hub-importer',
  };

  if (GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  }

  console.log('Fetching repos from GitHub API...');
  const response = await fetch(
    `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=100&type=public`,
    { headers }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${error}`);
  }

  const repos: GitHubRepo[] = await response.json();
  console.log(`Found ${repos.length} repos in ${GITHUB_ORG} organization`);

  return repos;
}

/**
 * Ensure the controlvector organization exists
 */
async function ensureOrganization(): Promise<string> {
  console.log('\nChecking organization...');

  let org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.slug, GITHUB_ORG),
  });

  if (!org) {
    console.log('Creating controlvector organization...');
    const [newOrg] = await db.insert(schema.organizations).values({
      slug: GITHUB_ORG,
      name: 'ControlVector',
      description: 'AI-powered developer tools for the modern software team.',
      logoUrl: `https://github.com/${GITHUB_ORG}.png`,
      websiteUrl: 'https://controlvector.io',
      isPublic: true,
      isVerified: true,
    }).returning();
    org = newOrg;
    console.log(`Created organization: ${org.id}`);
  } else {
    console.log(`Organization exists: ${org.id}`);
  }

  return org.id;
}

/**
 * Mirror clone a repository from GitHub
 */
async function mirrorClone(repo: GitHubRepo): Promise<string> {
  const orgPath = path.join(GIT_STORAGE_PATH, GITHUB_ORG);
  const repoPath = path.join(orgPath, `${repo.name}.git`);

  // Create org directory
  await fs.mkdir(orgPath, { recursive: true });

  // Check if repo already exists
  try {
    await fs.access(path.join(repoPath, 'HEAD'));
    console.log(`  Repository already cloned, fetching updates...`);

    // Fetch updates
    const git = simpleGit(repoPath);
    await git.fetch(['--all', '--prune']);

    return repoPath;
  } catch {
    // Repo doesn't exist, clone it
  }

  console.log(`  Cloning ${repo.clone_url}...`);

  const git = simpleGit();

  // Use token for private repos (if available)
  let cloneUrl = repo.clone_url;
  if (GITHUB_TOKEN) {
    cloneUrl = cloneUrl.replace('https://', `https://${GITHUB_TOKEN}@`);
  }

  await git.clone(cloneUrl, repoPath, ['--bare', '--mirror']);

  // Configure the bare repo
  const bareGit = simpleGit(repoPath);
  await bareGit.raw(['config', 'receive.denyNonFastForwards', 'false']);
  await bareGit.raw(['config', 'receive.denyDeleteCurrent', 'true']);

  console.log(`  Cloned to ${repoPath}`);
  return repoPath;
}

/**
 * Create or update repository database record
 */
async function upsertRepository(
  repo: GitHubRepo,
  orgId: string,
  localPath: string
): Promise<string> {
  // Check if repo exists
  const existing = await db.query.repositories.findFirst({
    where: and(
      eq(schema.repositories.organizationId, orgId),
      eq(schema.repositories.slug, repo.name)
    ),
  });

  if (existing) {
    console.log(`  Updating existing database record...`);

    await db.update(schema.repositories)
      .set({
        description: repo.description,
        starCount: repo.stargazers_count,
        watcherCount: repo.watchers_count,
        forkCount: repo.forks_count,
        openIssueCount: repo.open_issues_count,
        localPath,
        graphSyncStatus: 'stale', // Trigger re-sync
        updatedAt: new Date(),
      })
      .where(eq(schema.repositories.id, existing.id));

    return existing.id;
  }

  console.log(`  Creating database record...`);

  const [newRepo] = await db.insert(schema.repositories).values({
    organizationId: orgId,
    name: repo.name,
    slug: repo.name,
    description: repo.description,
    visibility: 'public',
    provider: 'local', // Now hosted locally
    providerRepoId: repo.full_name,
    providerRepoUrl: repo.html_url,
    localPath,
    defaultBranch: repo.default_branch,
    starCount: repo.stargazers_count,
    watcherCount: repo.watchers_count,
    forkCount: repo.forks_count,
    openIssueCount: repo.open_issues_count,
    sizeBytes: repo.size * 1024, // GitHub reports in KB
    hasIssues: true,
    hasPullRequests: true,
    graphSyncStatus: 'pending', // Trigger initial sync
  }).returning();

  // Create default branch entry
  await db.insert(schema.branches).values({
    repositoryId: newRepo.id,
    name: repo.default_branch,
    sha: '0000000000000000000000000000000000000000', // Will be updated on first sync
    isDefault: true,
  });

  return newRepo.id;
}

/**
 * Import a single repository
 */
async function importRepo(repo: GitHubRepo, orgId: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Importing: ${repo.full_name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Description: ${repo.description || '(none)'}`);
  console.log(`  Stars: ${repo.stargazers_count}, Forks: ${repo.forks_count}`);
  console.log(`  Default branch: ${repo.default_branch}`);

  try {
    // Clone/update the repository
    const localPath = await mirrorClone(repo);

    // Create/update database record
    const repoId = await upsertRepository(repo, orgId, localPath);

    console.log(`  Repository ID: ${repoId}`);
    console.log(`  Status: SUCCESS`);
  } catch (error) {
    console.error(`  Status: FAILED`);
    console.error(`  Error: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       GitHub Repository Import for CV-Hub                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Organization: ${GITHUB_ORG}`);
  console.log(`Storage path: ${GIT_STORAGE_PATH}`);
  console.log(`Repos to import: ${REPOS_TO_IMPORT.join(', ')}`);
  console.log(`GitHub token: ${GITHUB_TOKEN ? 'configured' : 'not configured'}`);
  console.log('');

  try {
    // Ensure storage directory exists
    await fs.mkdir(GIT_STORAGE_PATH, { recursive: true });

    // Ensure organization exists
    const orgId = await ensureOrganization();

    // Fetch repos from GitHub
    const allRepos = await fetchGitHubRepos();

    // Filter to repos we want to import
    const repos = allRepos.filter(r => REPOS_TO_IMPORT.includes(r.name));

    if (repos.length === 0) {
      console.log('\nNo matching repos found!');
      console.log(`Looking for: ${REPOS_TO_IMPORT.join(', ')}`);
      console.log(`Available: ${allRepos.map(r => r.name).join(', ')}`);
      await pool.end();
      return;
    }

    console.log(`\nImporting ${repos.length} repositories...`);

    // Import each repository
    for (const repo of repos) {
      await importRepo(repo, orgId);
    }

    // Summary
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    Import Complete                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Imported repositories:');
    for (const repo of repos) {
      console.log(`  - ${repo.full_name}`);
    }
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run sync-repos.ts to trigger graph sync');
    console.log('  2. Monitor worker logs for sync progress');
    console.log('  3. Verify repos at https://hub.controlvector.io/controlvector');
    console.log('');

  } catch (error) {
    console.error('\nFatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
