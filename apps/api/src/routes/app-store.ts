import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import {
  listApps,
  getAppById,
  createApp,
  updateApp,
  deleteApp,
  listReleases,
  getLatestRelease,
  getReleaseByVersion,
  createRelease,
  updateRelease,
  deleteRelease,
  createReleaseAsset,
  getAssetForDownload,
  deleteReleaseAsset,
  checkForUpdate,
  getAppStoreStats,
  getAppAnalytics,
  getOrganizationsWithApps,
  type AppListFilters,
} from '../services/app-store.service';
import { syncAppFromGitHub, syncAllApps } from '../services/github-sync.service';
import { logAuditEvent, type AuditAction } from '../services/audit.service';
import { getStorage, generateAssetKey } from '../services/storage.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { env } from '../config/env';
import type { AppEnv } from '../app';

const appStore = new Hono<AppEnv>();

// Categories and platforms for validation
const categories = ['developer-tools', 'productivity', 'ai-ml', 'utilities', 'communication', 'other'] as const;
const platforms = ['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64'] as const;

// Helper to check if user is admin (for now, simple check - enhance later)
function requireAdmin(c: any) {
  // TODO: Implement proper admin check via roles/permissions
  // For now, all authenticated users can manage apps (development mode)
  const userId = c.get('userId');
  if (!userId) throw new ForbiddenError('Admin access required');
}

// Helper to get request metadata
function getRequestMeta(c: any) {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : undefined,
    userAgent: c.req.header('user-agent'),
  };
}

// ============================================================================
// Public APIs (no auth required)
// ============================================================================

// GET /api/v1/apps/organizations - List organizations with apps (for filter dropdown)
appStore.get('/apps/organizations', async (c) => {
  const orgs = await getOrganizationsWithApps();
  return c.json({ organizations: orgs });
});

// GET /api/v1/apps - List all apps
const listAppsSchema = z.object({
  category: z.enum(categories).optional(),
  featured: z.enum(['true', 'false']).optional(),
  search: z.string().max(100).optional(),
  organization: z.string().max(64).optional(), // Organization slug filter
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

appStore.get('/apps', zValidator('query', listAppsSchema), async (c) => {
  const query = c.req.valid('query');

  const filters: AppListFilters = {
    category: query.category,
    featured: query.featured === 'true' ? true : query.featured === 'false' ? false : undefined,
    search: query.search,
    organizationSlug: query.organization,
    limit: query.limit,
    offset: query.offset,
  };

  const apps = await listApps(filters);
  const stats = await getAppStoreStats();

  return c.json({
    apps,
    stats,
    pagination: {
      limit: filters.limit || 50,
      offset: filters.offset || 0,
      total: stats.totalApps,
    },
  });
});

// GET /api/v1/apps/:appId - Get app details
appStore.get('/apps/:appId', async (c) => {
  const appId = c.req.param('appId');
  const app = await getAppById(appId);

  if (!app) {
    throw new NotFoundError('App');
  }

  return c.json({ app });
});

// GET /api/v1/apps/:appId/releases - List releases for app
const listReleasesSchema = z.object({
  includePrerelease: z.enum(['true', 'false']).optional(),
});

appStore.get('/apps/:appId/releases', zValidator('query', listReleasesSchema), async (c) => {
  const appId = c.req.param('appId');
  const query = c.req.valid('query');

  // Check app exists
  const app = await getAppById(appId);
  if (!app) {
    throw new NotFoundError('App');
  }

  const releases = await listReleases(appId, query.includePrerelease === 'true');

  return c.json({ releases });
});

// GET /api/v1/apps/:appId/latest - Get latest release
appStore.get('/apps/:appId/latest', async (c) => {
  const appId = c.req.param('appId');

  const release = await getLatestRelease(appId);
  if (!release) {
    throw new NotFoundError('Release');
  }

  return c.json({ release });
});

// GET /api/v1/apps/:appId/analytics - Get app analytics
const analyticsQuerySchema = z.object({
  days: z.coerce.number().min(1).max(365).optional(),
});

appStore.get('/apps/:appId/analytics', zValidator('query', analyticsQuerySchema), async (c) => {
  const appId = c.req.param('appId');
  const query = c.req.valid('query');

  // Check app exists
  const app = await getAppById(appId);
  if (!app) {
    throw new NotFoundError('App');
  }

  const analytics = await getAppAnalytics(appId, query.days || 30);

  return c.json({ analytics });
});

// GET /api/v1/apps/:appId/releases/:version - Get specific release
appStore.get('/apps/:appId/releases/:version', async (c) => {
  const appId = c.req.param('appId');
  const version = c.req.param('version');

  const release = await getReleaseByVersion(appId, version);
  if (!release) {
    throw new NotFoundError('Release');
  }

  return c.json({ release });
});

// GET /api/v1/apps/:appId/download/:platform - Download file
appStore.get('/apps/:appId/download/:platform', async (c) => {
  const appId = c.req.param('appId');
  const platform = c.req.param('platform') as typeof platforms[number];

  if (!platforms.includes(platform)) {
    throw new NotFoundError('Platform');
  }

  const release = await getLatestRelease(appId);
  if (!release) {
    throw new NotFoundError('Release');
  }

  // Get request context for download tracking
  const meta = getRequestMeta(c);
  const asset = await getAssetForDownload(release.id, platform, {
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
    eventType: 'download',
  });
  if (!asset) {
    throw new NotFoundError('Download for this platform');
  }

  // If using S3 storage, stream from our storage
  if (env.STORAGE_TYPE === 's3') {
    const storage = getStorage();
    const storageKey = generateAssetKey(appId, release.version, asset.fileName);

    // Check if file exists in our storage
    const exists = await storage.exists(storageKey);
    if (exists) {
      const fileData = await storage.download(storageKey);

      // Determine content type
      const ext = asset.fileName.split('.').pop()?.toLowerCase();
      const contentTypes: Record<string, string> = {
        'exe': 'application/vnd.microsoft.portable-executable',
        'msi': 'application/x-msi',
        'dmg': 'application/x-apple-diskimage',
        'pkg': 'application/x-newton-compatible-pkg',
        'deb': 'application/vnd.debian.binary-package',
        'rpm': 'application/x-rpm',
        'appimage': 'application/x-executable',
        'tar.gz': 'application/gzip',
        'zip': 'application/zip',
      };
      const contentType = contentTypes[ext || ''] || 'application/octet-stream';

      return new Response(new Uint8Array(fileData), {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${asset.fileName}"`,
          'Content-Length': fileData.length.toString(),
        },
      });
    }
  }

  // Fallback: redirect to the stored download URL (GitHub, etc.)
  return c.redirect(asset.downloadUrl);
});

// GET /api/v1/updates/:appId/:target/:arch/:currentVersion - Tauri updater endpoint
appStore.get('/updates/:appId/:target/:arch/:currentVersion', async (c) => {
  const { appId, target, arch, currentVersion } = c.req.param();

  const update = await checkForUpdate(appId, target, arch, currentVersion);

  if (!update) {
    // Tauri expects 204 No Content when no update is available
    return c.body(null, 204);
  }

  return c.json(update);
});

// ============================================================================
// Admin APIs (auth required)
// ============================================================================

// POST /api/v1/apps - Create app (admin only)
const createAppSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'ID must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(100),
  description: z.string().min(1),
  longDescription: z.string().optional(),
  iconUrl: z.string().url().optional(),
  category: z.enum(categories).optional(),
  homepageUrl: z.string().url().optional(),
  repositoryUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

appStore.post('/apps', requireAuth, zValidator('json', createAppSchema), async (c) => {
  requireAdmin(c);

  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  const app = await createApp(input);

  await logAuditEvent({
    userId,
    action: 'app.created' as AuditAction,
    resource: 'app',
    resourceId: app.id,
    details: { name: app.name },
    status: 'success',
    ...meta,
  });

  return c.json({ app }, 201);
});

// PUT /api/v1/apps/:appId - Update app (admin only)
const updateAppSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).optional(),
  longDescription: z.string().optional(),
  iconUrl: z.string().url().nullable().optional(),
  category: z.enum(categories).optional(),
  homepageUrl: z.string().url().nullable().optional(),
  repositoryUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

appStore.put('/apps/:appId', requireAuth, zValidator('json', updateAppSchema), async (c) => {
  requireAdmin(c);

  const appId = c.req.param('appId');
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  const app = await updateApp(appId, input);
  if (!app) {
    throw new NotFoundError('App');
  }

  await logAuditEvent({
    userId,
    action: 'app.updated' as AuditAction,
    resource: 'app',
    resourceId: appId,
    status: 'success',
    ...meta,
  });

  return c.json({ app });
});

// DELETE /api/v1/apps/:appId - Delete app (admin only)
appStore.delete('/apps/:appId', requireAuth, async (c) => {
  requireAdmin(c);

  const appId = c.req.param('appId');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  const deleted = await deleteApp(appId);
  if (!deleted) {
    throw new NotFoundError('App');
  }

  await logAuditEvent({
    userId,
    action: 'app.deleted' as AuditAction,
    resource: 'app',
    resourceId: appId,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// POST /api/v1/apps/:appId/releases - Create release (admin only)
const createReleaseSchema = z.object({
  version: z.string().min(1).max(32).regex(/^v?\d+\.\d+\.\d+/, 'Version must be semver format'),
  releaseNotes: z.string().optional(),
  isPrerelease: z.boolean().optional(),
  isLatest: z.boolean().optional(),
  signaturePublicKey: z.string().optional(),
  publishedAt: z.string().datetime().optional(),
});

appStore.post('/apps/:appId/releases', requireAuth, zValidator('json', createReleaseSchema), async (c) => {
  requireAdmin(c);

  const appId = c.req.param('appId');
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  // Check app exists
  const app = await getAppById(appId);
  if (!app) {
    throw new NotFoundError('App');
  }

  const release = await createRelease({
    appId,
    ...input,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
  });

  await logAuditEvent({
    userId,
    action: 'release.created' as AuditAction,
    resource: 'release',
    resourceId: release.id,
    details: { appId, version: release.version },
    status: 'success',
    ...meta,
  });

  return c.json({ release }, 201);
});

// PUT /api/v1/releases/:releaseId - Update release (admin only)
const updateReleaseSchema = z.object({
  releaseNotes: z.string().optional(),
  isPrerelease: z.boolean().optional(),
  isLatest: z.boolean().optional(),
  signaturePublicKey: z.string().optional(),
});

appStore.put('/releases/:releaseId', requireAuth, zValidator('json', updateReleaseSchema), async (c) => {
  requireAdmin(c);

  const releaseId = c.req.param('releaseId');
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  const release = await updateRelease(releaseId, input);
  if (!release) {
    throw new NotFoundError('Release');
  }

  await logAuditEvent({
    userId,
    action: 'release.updated' as AuditAction,
    resource: 'release',
    resourceId: releaseId,
    status: 'success',
    ...meta,
  });

  return c.json({ release });
});

// DELETE /api/v1/releases/:releaseId - Delete release (admin only)
appStore.delete('/releases/:releaseId', requireAuth, async (c) => {
  requireAdmin(c);

  const releaseId = c.req.param('releaseId');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  const deleted = await deleteRelease(releaseId);
  if (!deleted) {
    throw new NotFoundError('Release');
  }

  await logAuditEvent({
    userId,
    action: 'release.deleted' as AuditAction,
    resource: 'release',
    resourceId: releaseId,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// POST /api/v1/releases/:releaseId/assets - Create release asset (admin only)
const createAssetSchema = z.object({
  platform: z.enum(platforms),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
  fileHash: z.string().length(64), // SHA256
  signature: z.string().optional(),
  downloadUrl: z.string().url(),
});

appStore.post('/releases/:releaseId/assets', requireAuth, zValidator('json', createAssetSchema), async (c) => {
  requireAdmin(c);

  const releaseId = c.req.param('releaseId');
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  const asset = await createReleaseAsset({
    releaseId,
    ...input,
  });

  await logAuditEvent({
    userId,
    action: 'release_asset.created' as AuditAction,
    resource: 'release_asset',
    resourceId: asset.id,
    details: { releaseId, platform: asset.platform },
    status: 'success',
    ...meta,
  });

  return c.json({ asset }, 201);
});

// DELETE /api/v1/assets/:assetId - Delete release asset (admin only)
appStore.delete('/assets/:assetId', requireAuth, async (c) => {
  requireAdmin(c);

  const assetId = c.req.param('assetId');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  const deleted = await deleteReleaseAsset(assetId);
  if (!deleted) {
    throw new NotFoundError('Asset');
  }

  await logAuditEvent({
    userId,
    action: 'release_asset.deleted' as AuditAction,
    resource: 'release_asset',
    resourceId: assetId,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// ============================================================================
// Publish API (for cv-git CLI integration)
// ============================================================================

// POST /api/v1/apps/:appId/publish - Publish a new release (streamlined for CLI)
const publishReleaseSchema = z.object({
  version: z.string().min(1).max(32).regex(/^v?\d+\.\d+\.\d+/, 'Version must be semver format'),
  releaseNotes: z.string().optional(),
  isPrerelease: z.boolean().optional().default(false),
  assets: z.array(z.object({
    platform: z.enum(platforms),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().positive(),
    fileHash: z.string().optional(), // SHA256, optional for now
    downloadUrl: z.string().url(),
  })).optional(),
  // For GitHub-hosted releases
  githubReleaseUrl: z.string().url().optional(),
});

appStore.post('/apps/:appId/publish', requireAuth, zValidator('json', publishReleaseSchema), async (c) => {
  const appId = c.req.param('appId');
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  // Check app exists
  const app = await getAppById(appId);
  if (!app) {
    throw new NotFoundError('App');
  }

  // TODO: Check user has permission to publish to this app
  // For now, any authenticated user can publish (development mode)

  // Normalize version (remove leading 'v' if present for storage)
  const version = input.version.replace(/^v/, '');

  // Check if this version already exists
  const existingRelease = await getReleaseByVersion(appId, version);

  let release;
  if (existingRelease) {
    // Update existing release
    release = await updateRelease(existingRelease.id, {
      releaseNotes: input.releaseNotes,
      isPrerelease: input.isPrerelease,
      isLatest: !input.isPrerelease, // Only mark as latest if not prerelease
    });

    // Delete existing assets if new ones provided
    if (input.assets && input.assets.length > 0) {
      for (const asset of existingRelease.assets || []) {
        await deleteReleaseAsset(asset.id);
      }
    }
  } else {
    // If this is a stable release, unmark previous latest
    if (!input.isPrerelease) {
      const currentLatest = await getLatestRelease(appId);
      if (currentLatest) {
        await updateRelease(currentLatest.id, { isLatest: false });
      }
    }

    // Create new release
    release = await createRelease({
      appId,
      version,
      releaseNotes: input.releaseNotes,
      isPrerelease: input.isPrerelease,
      isLatest: !input.isPrerelease,
      publishedAt: new Date(),
    });
  }

  // Create assets if provided
  const createdAssets = [];
  if (input.assets && release) {
    for (const assetInput of input.assets) {
      const asset = await createReleaseAsset({
        releaseId: release.id,
        platform: assetInput.platform,
        fileName: assetInput.fileName,
        fileSize: assetInput.fileSize,
        fileHash: assetInput.fileHash || 'pending',
        downloadUrl: assetInput.downloadUrl,
      });
      createdAssets.push(asset);
    }
  }

  await logAuditEvent({
    userId,
    action: (existingRelease ? 'release.updated' : 'release.published') as AuditAction,
    resource: 'release',
    resourceId: release?.id || '',
    details: {
      appId,
      version,
      assetsCount: createdAssets.length,
      isPrerelease: input.isPrerelease,
    },
    status: 'success',
    ...meta,
  });

  // Fetch the complete release with assets
  const completeRelease = await getReleaseByVersion(appId, version);

  return c.json({
    release: completeRelease,
    created: !existingRelease,
    message: existingRelease
      ? `Updated release ${version}`
      : `Published new release ${version}`,
  }, existingRelease ? 200 : 201);
});

// ============================================================================
// GitHub Sync APIs (admin only)
// ============================================================================

// POST /api/v1/apps/:appId/sync - Sync single app from GitHub
appStore.post('/apps/:appId/sync', requireAuth, async (c) => {
  requireAdmin(c);

  const appId = c.req.param('appId');
  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  // Get app to find repository URL
  const app = await getAppById(appId);
  if (!app) {
    throw new NotFoundError('App');
  }

  if (!app.repositoryUrl) {
    return c.json({ error: 'App has no repository URL configured' }, 400);
  }

  // Parse GitHub owner/repo from URL
  const match = app.repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) {
    return c.json({ error: 'Invalid GitHub repository URL' }, 400);
  }

  const [, owner, repo] = match;
  const result = await syncAppFromGitHub(appId, owner, repo.replace(/\.git$/, ''));

  await logAuditEvent({
    userId,
    action: 'app.synced' as AuditAction,
    resource: 'app',
    resourceId: appId,
    details: { result },
    status: result.errors.length > 0 ? 'failure' : 'success',
    errorMessage: result.errors.length > 0 ? result.errors.join('; ') : undefined,
    ...meta,
  });

  return c.json({ result });
});

// POST /api/v1/sync - Sync all apps from GitHub
appStore.post('/sync', requireAuth, async (c) => {
  requireAdmin(c);

  const meta = getRequestMeta(c);
  const userId = c.get('userId');

  const results = await syncAllApps();

  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  await logAuditEvent({
    userId,
    action: 'apps.synced_all' as AuditAction,
    resource: 'app_store',
    resourceId: 'all',
    details: {
      appsProcessed: results.length,
      totalReleasesCreated: results.reduce((sum, r) => sum + r.releasesCreated, 0),
      totalAssetsCreated: results.reduce((sum, r) => sum + r.assetsCreated, 0),
      totalErrors,
    },
    status: totalErrors > 0 ? 'failure' : 'success',
    ...meta,
  });

  return c.json({ results });
});

export { appStore as appStoreRoutes };
