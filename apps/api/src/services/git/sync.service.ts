import { db } from '../../db';
import { repositories, branches, commits, tags } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import * as gitBackend from './git-backend.service';

export interface RefUpdate {
  oldSha: string;
  newSha: string;
  refName: string;
}

/**
 * Process a push event and sync metadata to database
 */
export async function processPostReceive(
  repositoryId: string,
  refs: RefUpdate[]
): Promise<void> {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repo) {
    console.error(`[Sync] Repository not found: ${repositoryId}`);
    return;
  }

  const ownerSlug = repo.organization?.slug || repo.owner?.username;
  if (!ownerSlug) {
    console.error(`[Sync] No owner found for repository: ${repositoryId}`);
    return;
  }

  for (const ref of refs) {
    if (ref.refName.startsWith('refs/heads/')) {
      await syncBranch(repositoryId, ownerSlug, repo.slug, ref);
    } else if (ref.refName.startsWith('refs/tags/')) {
      await syncTag(repositoryId, ownerSlug, repo.slug, ref);
    }
  }

  // Update repository stats
  await updateRepoStats(repositoryId, ownerSlug, repo.slug);
}

/**
 * Sync a branch after push
 */
async function syncBranch(
  repositoryId: string,
  ownerSlug: string,
  repoSlug: string,
  ref: RefUpdate
): Promise<void> {
  const branchName = ref.refName.replace('refs/heads/', '');
  const isDeleted = ref.newSha === '0000000000000000000000000000000000000000';

  if (isDeleted) {
    // Delete branch
    await db.delete(branches).where(
      and(
        eq(branches.repositoryId, repositoryId),
        eq(branches.name, branchName)
      )
    );
    console.log(`[Sync] Deleted branch: ${branchName}`);
    return;
  }

  // Check if branch exists
  const existingBranch = await db.query.branches.findFirst({
    where: and(
      eq(branches.repositoryId, repositoryId),
      eq(branches.name, branchName)
    ),
  });

  if (existingBranch) {
    // Update branch
    await db.update(branches)
      .set({
        sha: ref.newSha,
        updatedAt: new Date(),
      })
      .where(eq(branches.id, existingBranch.id));
  } else {
    // Create branch
    await db.insert(branches).values({
      repositoryId,
      name: branchName,
      sha: ref.newSha,
    });
  }

  // Sync recent commits
  await syncCommits(repositoryId, ownerSlug, repoSlug, ref.newSha, 10);

  console.log(`[Sync] Updated branch: ${branchName} -> ${ref.newSha.slice(0, 8)}`);
}

/**
 * Sync a tag after push
 */
async function syncTag(
  repositoryId: string,
  ownerSlug: string,
  repoSlug: string,
  ref: RefUpdate
): Promise<void> {
  const tagName = ref.refName.replace('refs/tags/', '');
  const isDeleted = ref.newSha === '0000000000000000000000000000000000000000';

  if (isDeleted) {
    // Delete tag
    await db.delete(tags).where(
      and(
        eq(tags.repositoryId, repositoryId),
        eq(tags.name, tagName)
      )
    );
    console.log(`[Sync] Deleted tag: ${tagName}`);
    return;
  }

  // Get commit that the tag points to
  let taggerName: string | undefined;
  let taggerEmail: string | undefined;
  let taggerDate: Date | undefined;
  let message: string | undefined;

  try {
    // Try to get annotated tag info
    const commitInfo = await gitBackend.getCommit(ownerSlug, repoSlug, ref.newSha);
    taggerName = commitInfo.committer.name;
    taggerEmail = commitInfo.committer.email;
    taggerDate = commitInfo.committer.date;
    message = commitInfo.message;
  } catch {
    // Lightweight tag - just use the sha
  }

  // Upsert tag
  const existingTag = await db.query.tags.findFirst({
    where: and(
      eq(tags.repositoryId, repositoryId),
      eq(tags.name, tagName)
    ),
  });

  if (existingTag) {
    await db.update(tags)
      .set({
        sha: ref.newSha,
        message,
        taggerName,
        taggerEmail,
        taggerDate,
      })
      .where(eq(tags.id, existingTag.id));
  } else {
    await db.insert(tags).values({
      repositoryId,
      name: tagName,
      sha: ref.newSha,
      message,
      taggerName,
      taggerEmail,
      taggerDate,
    });
  }

  console.log(`[Sync] Updated tag: ${tagName} -> ${ref.newSha.slice(0, 8)}`);
}

/**
 * Sync recent commits to database
 */
async function syncCommits(
  repositoryId: string,
  ownerSlug: string,
  repoSlug: string,
  startSha: string,
  limit: number
): Promise<void> {
  try {
    const recentCommits = await gitBackend.getCommitHistory(
      ownerSlug,
      repoSlug,
      startSha,
      { limit }
    );

    for (const commit of recentCommits) {
      // Check if commit already exists
      const existing = await db.query.commits.findFirst({
        where: and(
          eq(commits.repositoryId, repositoryId),
          eq(commits.sha, commit.sha)
        ),
      });

      if (!existing) {
        await db.insert(commits).values({
          repositoryId,
          sha: commit.sha,
          message: commit.message,
          authorName: commit.author.name,
          authorEmail: commit.author.email,
          authorDate: commit.author.date,
          committerName: commit.committer.name,
          committerEmail: commit.committer.email,
          committerDate: commit.committer.date,
          parentShas: commit.parents,
        });
      }
    }
  } catch (err) {
    console.error(`[Sync] Failed to sync commits: ${err}`);
  }
}

/**
 * Update repository statistics
 */
async function updateRepoStats(
  repositoryId: string,
  ownerSlug: string,
  repoSlug: string
): Promise<void> {
  try {
    const stats = await gitBackend.getRepoStats(ownerSlug, repoSlug);

    await db.update(repositories)
      .set({
        sizeBytes: stats.size,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repositoryId));
  } catch (err) {
    console.error(`[Sync] Failed to update repo stats: ${err}`);
  }
}

/**
 * Full sync of all branches and tags from git to database
 */
export async function fullSync(repositoryId: string): Promise<void> {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repo) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }

  if (repo.provider !== 'local') {
    throw new Error('Full sync only supported for local repositories');
  }

  const ownerSlug = repo.organization?.slug || repo.owner?.username;
  if (!ownerSlug) {
    throw new Error('No owner found for repository');
  }

  console.log(`[Sync] Starting full sync for ${ownerSlug}/${repo.slug}`);

  // Mark sync as in progress
  await db.update(repositories)
    .set({
      graphSyncStatus: 'syncing',
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId));

  try {
    // Get all refs from git
    const refs = await gitBackend.getRefs(ownerSlug, repo.slug);

    // Sync branches
    const branchRefs = refs.filter(r => r.type === 'branch');
    for (const ref of branchRefs) {
      await syncBranch(repositoryId, ownerSlug, repo.slug, {
        oldSha: '0000000000000000000000000000000000000000',
        newSha: ref.sha,
        refName: `refs/heads/${ref.name}`,
      });
    }

    // Sync tags
    const tagRefs = refs.filter(r => r.type === 'tag');
    for (const ref of tagRefs) {
      await syncTag(repositoryId, ownerSlug, repo.slug, {
        oldSha: '0000000000000000000000000000000000000000',
        newSha: ref.sha,
        refName: `refs/tags/${ref.name}`,
      });
    }

    // Update stats
    await updateRepoStats(repositoryId, ownerSlug, repo.slug);

    // Mark sync complete
    await db.update(repositories)
      .set({
        graphSyncStatus: 'synced',
        graphLastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repositoryId));

    console.log(`[Sync] Full sync complete for ${ownerSlug}/${repo.slug}`);
  } catch (err) {
    // Mark sync as failed
    await db.update(repositories)
      .set({
        graphSyncStatus: 'failed',
        graphSyncError: err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repositoryId));

    throw err;
  }
}

/**
 * Sync external repository (GitHub/GitLab) metadata
 */
export async function syncExternalRepo(repositoryId: string): Promise<void> {
  const { createProviderFromRepo } = await import('../provider');

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repo) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }

  if (repo.provider === 'local') {
    throw new Error('Use fullSync for local repositories');
  }

  // Parse external repo info from providerRepoUrl
  // e.g., "https://github.com/owner/repo" -> { owner: "owner", repo: "repo" }
  let externalOwner: string | null = null;
  let externalRepo: string | null = null;

  if (repo.providerRepoUrl) {
    const match = repo.providerRepoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      externalOwner = match[1];
      externalRepo = match[2].replace(/\.git$/, '');
    }
  }

  if (!externalOwner || !externalRepo) {
    throw new Error('Could not parse external repository info');
  }

  console.log(`[Sync] Starting external sync for ${externalOwner}/${externalRepo}`);

  const provider = createProviderFromRepo({
    provider: repo.provider,
    externalOwner,
    externalRepo,
    externalToken: null, // Would need to get from user's OAuth tokens
    externalBaseUrl: null,
    slug: repo.slug,
    organization: repo.organization,
    user: repo.owner,
  });

  // Get repo info
  const repoInfo = await provider.getRepoInfo();

  // Update repo metadata
  await db.update(repositories)
    .set({
      description: repoInfo.description,
      defaultBranch: repoInfo.defaultBranch,
      starCount: repoInfo.starCount,
      forkCount: repoInfo.forkCount,
      hasIssues: repoInfo.hasIssues,
      hasPullRequests: repoInfo.hasPullRequests,
      hasWiki: repoInfo.hasWiki,
      isArchived: repoInfo.isArchived,
      graphSyncStatus: 'syncing',
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId));

  // Sync branches
  const providerBranches = await provider.getBranches();
  for (const b of providerBranches) {
    const existing = await db.query.branches.findFirst({
      where: and(
        eq(branches.repositoryId, repositoryId),
        eq(branches.name, b.name)
      ),
    });

    if (existing) {
      await db.update(branches)
        .set({
          sha: b.sha,
          isProtected: b.isProtected,
          isDefault: b.isDefault,
          updatedAt: new Date(),
        })
        .where(eq(branches.id, existing.id));
    } else {
      await db.insert(branches).values({
        repositoryId,
        name: b.name,
        sha: b.sha,
        isProtected: b.isProtected,
        isDefault: b.isDefault,
      });
    }
  }

  // Sync tags
  const providerTags = await provider.getTags();
  for (const t of providerTags) {
    const existing = await db.query.tags.findFirst({
      where: and(
        eq(tags.repositoryId, repositoryId),
        eq(tags.name, t.name)
      ),
    });

    if (existing) {
      await db.update(tags)
        .set({
          sha: t.sha,
          message: t.message,
          taggerName: t.tagger?.name,
          taggerEmail: t.tagger?.email,
          taggerDate: t.tagger?.date,
        })
        .where(eq(tags.id, existing.id));
    } else {
      await db.insert(tags).values({
        repositoryId,
        name: t.name,
        sha: t.sha,
        message: t.message,
        taggerName: t.tagger?.name,
        taggerEmail: t.tagger?.email,
        taggerDate: t.tagger?.date,
      });
    }
  }

  // Mark sync complete
  await db.update(repositories)
    .set({
      graphSyncStatus: 'synced',
      graphLastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId));

  console.log(`[Sync] External sync complete for ${externalOwner}/${externalRepo}`);
}
