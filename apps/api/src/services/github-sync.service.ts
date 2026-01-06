import { env } from '../config/env';
import { db } from '../db';
import {
  apps,
  releases,
  releaseAssets,
  type Platform,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  published_at: string;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}

interface SyncResult {
  appId: string;
  releasesCreated: number;
  assetsCreated: number;
  errors: string[];
}

// ============================================================================
// Platform Detection
// ============================================================================

// Detect platform from filename
function detectPlatform(fileName: string): Platform | null {
  const lowerName = fileName.toLowerCase();

  // Windows
  if (lowerName.includes('windows') || lowerName.includes('win')) {
    if (lowerName.includes('arm64') || lowerName.includes('aarch64')) {
      return 'windows-arm64';
    }
    return 'windows-x64';
  }

  // macOS
  if (lowerName.includes('macos') || lowerName.includes('darwin') || lowerName.includes('mac')) {
    if (lowerName.includes('arm64') || lowerName.includes('aarch64')) {
      return 'macos-arm64';
    }
    if (lowerName.includes('x64') || lowerName.includes('x86_64') || lowerName.includes('intel')) {
      return 'macos-x64';
    }
    // Universal or unspecified - default to arm64 (modern default)
    if (lowerName.includes('universal')) {
      return 'macos-arm64';
    }
    return 'macos-x64';
  }

  // Linux
  if (lowerName.includes('linux')) {
    if (lowerName.includes('arm64') || lowerName.includes('aarch64')) {
      return 'linux-arm64';
    }
    return 'linux-x64';
  }

  // Try by extension
  if (lowerName.endsWith('.exe') || lowerName.endsWith('.msi')) {
    return 'windows-x64';
  }
  if (lowerName.endsWith('.dmg') || lowerName.endsWith('.app.tar.gz')) {
    return 'macos-x64';
  }
  if (lowerName.endsWith('.appimage') || lowerName.endsWith('.deb') || lowerName.endsWith('.rpm')) {
    return 'linux-x64';
  }

  return null;
}

// Check if asset is a valid release binary (not a checksum, signature, etc.)
function isReleaseBinary(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();

  // Skip signature and checksum files
  if (lowerName.endsWith('.sig') || lowerName.endsWith('.asc')) return false;
  if (lowerName.includes('sha256') || lowerName.includes('sha512') || lowerName.includes('checksum')) return false;
  if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) return false;

  // Valid binary extensions
  const validExtensions = ['.exe', '.msi', '.dmg', '.pkg', '.app.tar.gz', '.appimage', '.deb', '.rpm', '.tar.gz', '.zip'];
  return validExtensions.some(ext => lowerName.endsWith(ext));
}

// ============================================================================
// GitHub API
// ============================================================================

async function fetchGitHubReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'cv-hub-sync',
  };

  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Fetch .sig file content for Tauri signature
async function fetchSignatureFile(asset: GitHubAsset, allAssets: GitHubAsset[]): Promise<string | null> {
  // Look for corresponding .sig file
  const sigAsset = allAssets.find(a => a.name === `${asset.name}.sig`);
  if (!sigAsset) return null;

  const headers: Record<string, string> = {
    'Accept': 'application/octet-stream',
    'User-Agent': 'cv-hub-sync',
  };

  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(sigAsset.browser_download_url, { headers });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

// Generate SHA256 hash placeholder (actual download would be needed for real hash)
function generatePlaceholderHash(assetId: number, fileName: string): string {
  // In production, you'd download the file and compute actual hash
  // For now, use a deterministic placeholder
  return crypto
    .createHash('sha256')
    .update(`${assetId}:${fileName}`)
    .digest('hex');
}

// ============================================================================
// Sync Service
// ============================================================================

export async function syncAppFromGitHub(
  appId: string,
  owner: string,
  repo: string
): Promise<SyncResult> {
  const result: SyncResult = {
    appId,
    releasesCreated: 0,
    assetsCreated: 0,
    errors: [],
  };

  try {
    // Verify app exists
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      result.errors.push(`App ${appId} not found`);
      return result;
    }

    // Fetch releases from GitHub
    logger.info('general', 'Fetching GitHub releases', { appId, owner, repo });
    const githubReleases = await fetchGitHubReleases(owner, repo);

    for (const ghRelease of githubReleases) {
      // Skip drafts
      if (ghRelease.draft) continue;

      // Extract version from tag (remove 'v' prefix if present)
      const version = ghRelease.tag_name.replace(/^v/, '');

      // Check if release already exists
      const existingRelease = await db.query.releases.findFirst({
        where: and(
          eq(releases.appId, appId),
          eq(releases.version, version)
        ),
      });

      if (existingRelease) {
        logger.info('general', 'Release already exists, skipping', { appId, version });
        continue;
      }

      // Create release
      const [newRelease] = await db.insert(releases).values({
        appId,
        version,
        releaseNotes: ghRelease.body || '',
        isPrerelease: ghRelease.prerelease,
        isLatest: false, // Will update latest later
        githubReleaseId: ghRelease.id,
        githubReleaseUrl: ghRelease.html_url,
        publishedAt: new Date(ghRelease.published_at),
      }).returning();

      result.releasesCreated++;
      logger.info('general', 'Created release', { appId, version, releaseId: newRelease.id });

      // Process assets
      for (const asset of ghRelease.assets) {
        // Skip non-binary files
        if (!isReleaseBinary(asset.name)) continue;

        // Detect platform
        const platform = detectPlatform(asset.name);
        if (!platform) {
          logger.warn('general', 'Could not detect platform for asset', { fileName: asset.name });
          continue;
        }

        // Check if asset already exists for this platform
        const existingAsset = await db.query.releaseAssets.findFirst({
          where: and(
            eq(releaseAssets.releaseId, newRelease.id),
            eq(releaseAssets.platform, platform)
          ),
        });

        if (existingAsset) continue;

        // Fetch signature if available
        const signature = await fetchSignatureFile(asset, ghRelease.assets);

        // Create asset
        await db.insert(releaseAssets).values({
          releaseId: newRelease.id,
          platform,
          fileName: asset.name,
          fileSize: asset.size,
          fileHash: generatePlaceholderHash(asset.id, asset.name),
          signature: signature || undefined,
          downloadUrl: asset.browser_download_url,
          githubAssetId: asset.id,
        });

        result.assetsCreated++;
        logger.info('general', 'Created release asset', {
          releaseId: newRelease.id,
          platform,
          fileName: asset.name,
        });
      }
    }

    // Update latest release flag
    await updateLatestRelease(appId);

    logger.info('general', 'GitHub sync completed', {
      appId: result.appId,
      releasesCreated: result.releasesCreated,
      assetsCreated: result.assetsCreated,
      errors: result.errors,
    });
    return result;

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(message);
    logger.error('general', 'GitHub sync failed', error as Error);
    return result;
  }
}

// Update the latest release flag for an app
async function updateLatestRelease(appId: string): Promise<void> {
  // Find the latest non-prerelease release
  const latestRelease = await db.query.releases.findFirst({
    where: and(
      eq(releases.appId, appId),
      eq(releases.isPrerelease, false)
    ),
    orderBy: (releases, { desc }) => [desc(releases.publishedAt)],
  });

  if (!latestRelease) return;

  // Clear all latest flags for this app
  await db
    .update(releases)
    .set({ isLatest: false, updatedAt: new Date() })
    .where(eq(releases.appId, appId));

  // Set the latest flag
  await db
    .update(releases)
    .set({ isLatest: true, updatedAt: new Date() })
    .where(eq(releases.id, latestRelease.id));

  logger.info('general', 'Updated latest release', { appId, version: latestRelease.version });
}

// ============================================================================
// Sync All Apps
// ============================================================================

export async function syncAllApps(): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  // Get all active apps with repository URLs
  const activeApps = await db.query.apps.findMany({
    where: eq(apps.isActive, true),
  });

  for (const app of activeApps) {
    if (!app.repositoryUrl) {
      logger.warn('general', 'App has no repository URL, skipping', { appId: app.id });
      continue;
    }

    // Parse GitHub owner/repo from URL
    const match = app.repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      logger.warn('general', 'Could not parse GitHub URL', { appId: app.id, url: app.repositoryUrl });
      continue;
    }

    const [, owner, repo] = match;
    const result = await syncAppFromGitHub(app.id, owner, repo.replace(/\.git$/, ''));
    results.push(result);
  }

  return results;
}

// ============================================================================
// Export types
// ============================================================================

export type { SyncResult };
