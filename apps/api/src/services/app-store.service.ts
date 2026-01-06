import { eq, and, desc, sql, isNull, or, ilike } from 'drizzle-orm';
import { db } from '../db';
import {
  apps,
  releases,
  releaseAssets,
  downloadEvents,
  organizations,
  type App,
  type NewApp,
  type Release,
  type NewRelease,
  type ReleaseAsset,
  type NewReleaseAsset,
  type NewDownloadEvent,
  type AppCategory,
  type Platform,
  type Organization,
} from '../db/schema';
import { logger } from '../utils/logger';

// ============================================================================
// App Service
// ============================================================================

// Minimal organization info for app listings
export interface AppOrganization {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
}

export interface AppWithLatestRelease extends App {
  latestRelease?: (Release & { assets?: ReleaseAsset[] }) | null;
  organization?: AppOrganization | null;
}

export interface AppListFilters {
  category?: AppCategory;
  featured?: boolean;
  search?: string;
  organizationId?: string;
  organizationSlug?: string;
  limit?: number;
  offset?: number;
}

// List all active apps
export async function listApps(filters: AppListFilters = {}): Promise<AppWithLatestRelease[]> {
  const { category, featured, search, organizationId, organizationSlug, limit = 50, offset = 0 } = filters;

  // If filtering by organization slug, first get the org ID
  let orgIdFilter = organizationId;
  if (organizationSlug && !organizationId) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.slug, organizationSlug),
    });
    if (org) {
      orgIdFilter = org.id;
    } else {
      return []; // Organization not found, return empty
    }
  }

  // Build where conditions
  const conditions = [eq(apps.isActive, true)];
  if (category) conditions.push(eq(apps.category, category));
  if (featured !== undefined) conditions.push(eq(apps.isFeatured, featured));
  if (orgIdFilter !== undefined) {
    conditions.push(eq(apps.organizationId, orgIdFilter));
  }
  if (search) {
    conditions.push(
      or(
        ilike(apps.name, `%${search}%`),
        ilike(apps.description, `%${search}%`)
      )!
    );
  }

  const appList = await db.query.apps.findMany({
    where: and(...conditions),
    orderBy: [desc(apps.isFeatured), desc(apps.totalDownloads)],
    limit,
    offset,
  });

  // Get organization IDs for batch lookup
  const orgIds = [...new Set(appList.map(a => a.organizationId).filter(Boolean))] as string[];

  // Batch fetch organizations
  const orgMap = new Map<string, AppOrganization>();
  if (orgIds.length > 0) {
    const orgs = await db.query.organizations.findMany({
      where: or(...orgIds.map(id => eq(organizations.id, id))),
    });
    for (const org of orgs) {
      orgMap.set(org.id, {
        id: org.id,
        slug: org.slug,
        name: org.name,
        logoUrl: org.logoUrl,
        isVerified: org.isVerified,
      });
    }
  }

  // Get latest releases for each app (with assets)
  const appsWithReleases: AppWithLatestRelease[] = [];
  for (const app of appList) {
    const latestRelease = await db.query.releases.findFirst({
      where: and(
        eq(releases.appId, app.id),
        eq(releases.isLatest, true)
      ),
    });

    const organization = app.organizationId ? orgMap.get(app.organizationId) || null : null;

    if (latestRelease) {
      const assets = await db.query.releaseAssets.findMany({
        where: eq(releaseAssets.releaseId, latestRelease.id),
      });
      appsWithReleases.push({ ...app, latestRelease: { ...latestRelease, assets }, organization });
    } else {
      appsWithReleases.push({ ...app, latestRelease, organization });
    }
  }

  return appsWithReleases;
}

// Get single app by ID
export async function getAppById(appId: string): Promise<AppWithLatestRelease | null> {
  const app = await db.query.apps.findFirst({
    where: and(eq(apps.id, appId), eq(apps.isActive, true)),
  });

  if (!app) return null;

  // Get organization info
  let organization: AppOrganization | null = null;
  if (app.organizationId) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, app.organizationId),
    });
    if (org) {
      organization = {
        id: org.id,
        slug: org.slug,
        name: org.name,
        logoUrl: org.logoUrl,
        isVerified: org.isVerified,
      };
    }
  }

  const latestRelease = await db.query.releases.findFirst({
    where: and(
      eq(releases.appId, app.id),
      eq(releases.isLatest, true)
    ),
  });

  // If there's a latest release, also get its assets
  if (latestRelease) {
    const assets = await db.query.releaseAssets.findMany({
      where: eq(releaseAssets.releaseId, latestRelease.id),
    });
    return { ...app, latestRelease: { ...latestRelease, assets }, organization };
  }

  return { ...app, latestRelease, organization };
}

// Create app (admin only)
export async function createApp(input: NewApp): Promise<App> {
  const [app] = await db.insert(apps).values(input).returning();
  logger.info('general', 'App created', { appId: app.id });
  return app;
}

// Update app (admin only)
export async function updateApp(appId: string, updates: Partial<NewApp>): Promise<App | null> {
  const [app] = await db
    .update(apps)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(apps.id, appId))
    .returning();

  if (app) {
    logger.info('general', 'App updated', { appId });
  }
  return app ?? null;
}

// Delete app (admin only)
export async function deleteApp(appId: string): Promise<boolean> {
  const result = await db.delete(apps).where(eq(apps.id, appId)).returning({ id: apps.id });
  if (result.length > 0) {
    logger.info('general', 'App deleted', { appId });
    return true;
  }
  return false;
}

// ============================================================================
// Release Service
// ============================================================================

export interface ReleaseWithAssets extends Release {
  assets: ReleaseAsset[];
}

// List releases for an app
export async function listReleases(appId: string, includePrerelease = false): Promise<ReleaseWithAssets[]> {
  const conditions = [eq(releases.appId, appId)];
  if (!includePrerelease) {
    conditions.push(eq(releases.isPrerelease, false));
  }

  const releaseList = await db.query.releases.findMany({
    where: and(...conditions),
    orderBy: [desc(releases.publishedAt)],
  });

  const releasesWithAssets: ReleaseWithAssets[] = [];
  for (const release of releaseList) {
    const assets = await db.query.releaseAssets.findMany({
      where: eq(releaseAssets.releaseId, release.id),
    });
    releasesWithAssets.push({ ...release, assets });
  }

  return releasesWithAssets;
}

// Get latest release for an app
export async function getLatestRelease(appId: string): Promise<ReleaseWithAssets | null> {
  const release = await db.query.releases.findFirst({
    where: and(
      eq(releases.appId, appId),
      eq(releases.isLatest, true),
      eq(releases.isPrerelease, false)
    ),
  });

  if (!release) return null;

  const assets = await db.query.releaseAssets.findMany({
    where: eq(releaseAssets.releaseId, release.id),
  });

  return { ...release, assets };
}

// Get specific release by version
export async function getReleaseByVersion(appId: string, version: string): Promise<ReleaseWithAssets | null> {
  const release = await db.query.releases.findFirst({
    where: and(
      eq(releases.appId, appId),
      eq(releases.version, version)
    ),
  });

  if (!release) return null;

  const assets = await db.query.releaseAssets.findMany({
    where: eq(releaseAssets.releaseId, release.id),
  });

  return { ...release, assets };
}

// Create release (admin only)
export async function createRelease(input: NewRelease): Promise<Release> {
  // If this is marked as latest, unmark previous latest
  if (input.isLatest) {
    await db
      .update(releases)
      .set({ isLatest: false, updatedAt: new Date() })
      .where(and(eq(releases.appId, input.appId), eq(releases.isLatest, true)));
  }

  const [release] = await db.insert(releases).values(input).returning();
  logger.info('general', 'Release created', { appId: input.appId, version: input.version });
  return release;
}

// Update release (admin only)
export async function updateRelease(releaseId: string, updates: Partial<NewRelease>): Promise<Release | null> {
  const existing = await db.query.releases.findFirst({
    where: eq(releases.id, releaseId),
  });

  if (!existing) return null;

  // If marking as latest, unmark previous latest
  if (updates.isLatest && !existing.isLatest) {
    await db
      .update(releases)
      .set({ isLatest: false, updatedAt: new Date() })
      .where(and(eq(releases.appId, existing.appId), eq(releases.isLatest, true)));
  }

  const [release] = await db
    .update(releases)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(releases.id, releaseId))
    .returning();

  if (release) {
    logger.info('general', 'Release updated', { releaseId, version: release.version });
  }
  return release ?? null;
}

// Delete release (admin only)
export async function deleteRelease(releaseId: string): Promise<boolean> {
  const result = await db.delete(releases).where(eq(releases.id, releaseId)).returning({ id: releases.id });
  if (result.length > 0) {
    logger.info('general', 'Release deleted', { releaseId });
    return true;
  }
  return false;
}

// ============================================================================
// Release Asset Service
// ============================================================================

// Create release asset
export async function createReleaseAsset(input: NewReleaseAsset): Promise<ReleaseAsset> {
  const [asset] = await db.insert(releaseAssets).values(input).returning();
  logger.info('general', 'Release asset created', { releaseId: input.releaseId, platform: input.platform });
  return asset;
}

// Context for tracking downloads
export interface DownloadContext {
  userAgent?: string;
  ipAddress?: string;
  country?: string;
  eventType?: 'download' | 'update_check' | 'update_download';
}

// Get asset for download (and increment count)
export async function getAssetForDownload(
  releaseId: string,
  platform: Platform,
  context?: DownloadContext
): Promise<ReleaseAsset | null> {
  const asset = await db.query.releaseAssets.findFirst({
    where: and(
      eq(releaseAssets.releaseId, releaseId),
      eq(releaseAssets.platform, platform)
    ),
  });

  if (!asset) return null;

  // Get the release to find the app ID and version
  const release = await db.query.releases.findFirst({
    where: eq(releases.id, releaseId),
  });

  if (!release) return asset;

  // Increment download counts
  await db
    .update(releaseAssets)
    .set({
      downloadCount: sql`${releaseAssets.downloadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(releaseAssets.id, asset.id));

  // Also increment release download count
  await db
    .update(releases)
    .set({
      downloadCount: sql`${releases.downloadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(releases.id, releaseId));

  // Increment app total downloads
  await db
    .update(apps)
    .set({
      totalDownloads: sql`${apps.totalDownloads} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(apps.id, release.appId));

  // Track download event for analytics
  await db.insert(downloadEvents).values({
    appId: release.appId,
    releaseId: release.id,
    assetId: asset.id,
    platform,
    version: release.version,
    userAgent: context?.userAgent,
    ipAddress: context?.ipAddress,
    country: context?.country,
    eventType: context?.eventType || 'download',
  });

  return asset;
}

// Delete release asset
export async function deleteReleaseAsset(assetId: string): Promise<boolean> {
  const result = await db.delete(releaseAssets).where(eq(releaseAssets.id, assetId)).returning({ id: releaseAssets.id });
  if (result.length > 0) {
    logger.info('general', 'Release asset deleted', { assetId });
    return true;
  }
  return false;
}

// ============================================================================
// Tauri Updater Service
// ============================================================================

export interface TauriUpdateInfo {
  version: string;
  notes: string;
  pub_date: string;
  platforms: {
    [key: string]: {
      signature: string;
      url: string;
    };
  };
}

// Map our platform enum to Tauri's platform format
const PLATFORM_MAP: Record<Platform, string> = {
  'windows-x64': 'windows-x86_64',
  'windows-arm64': 'windows-aarch64',
  'macos-x64': 'darwin-x86_64',
  'macos-arm64': 'darwin-aarch64',
  'linux-x64': 'linux-x86_64',
  'linux-arm64': 'linux-aarch64',
};

// Reverse map for looking up our platform from Tauri format
const TAURI_TO_PLATFORM: Record<string, Platform> = {
  'windows-x86_64': 'windows-x64',
  'windows-aarch64': 'windows-arm64',
  'darwin-x86_64': 'macos-x64',
  'darwin-aarch64': 'macos-arm64',
  'linux-x86_64': 'linux-x64',
  'linux-aarch64': 'linux-arm64',
};

// Check for updates (Tauri updater endpoint)
export async function checkForUpdate(
  appId: string,
  target: string,
  arch: string,
  currentVersion: string
): Promise<TauriUpdateInfo | null> {
  // Get latest release
  const latestRelease = await getLatestRelease(appId);
  if (!latestRelease) return null;

  // Compare versions (simple semver comparison)
  if (!isNewerVersion(latestRelease.version, currentVersion)) {
    return null; // No update available
  }

  // Build platform key in Tauri format
  const tauriPlatform = `${target}-${arch}`;
  const ourPlatform = TAURI_TO_PLATFORM[tauriPlatform];

  // Build platforms object with all available assets
  const platforms: TauriUpdateInfo['platforms'] = {};

  for (const asset of latestRelease.assets) {
    const tauriKey = PLATFORM_MAP[asset.platform];
    if (tauriKey && asset.signature) {
      platforms[tauriKey] = {
        signature: asset.signature,
        url: asset.downloadUrl,
      };
    }
  }

  // Check if the requested platform is available
  if (!platforms[tauriPlatform]) {
    return null; // Platform not available
  }

  return {
    version: latestRelease.version,
    notes: latestRelease.releaseNotes || '',
    pub_date: latestRelease.publishedAt.toISOString(),
    platforms,
  };
}

// Simple semver comparison (returns true if v1 > v2)
function isNewerVersion(v1: string, v2: string): boolean {
  const parts1 = v1.replace(/^v/, '').split('.').map(Number);
  const parts2 = v2.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return true;
    if (p1 < p2) return false;
  }

  return false;
}

// ============================================================================
// Stats
// ============================================================================

export interface AppStoreStats {
  totalApps: number;
  totalDownloads: number;
  totalReleases: number;
}

export async function getAppStoreStats(): Promise<AppStoreStats> {
  const [appStats] = await db
    .select({
      totalApps: sql<number>`count(*)`,
      totalDownloads: sql<number>`coalesce(sum(${apps.totalDownloads}), 0)`,
    })
    .from(apps)
    .where(eq(apps.isActive, true));

  const [releaseStats] = await db
    .select({
      totalReleases: sql<number>`count(*)`,
    })
    .from(releases);

  return {
    totalApps: Number(appStats?.totalApps || 0),
    totalDownloads: Number(appStats?.totalDownloads || 0),
    totalReleases: Number(releaseStats?.totalReleases || 0),
  };
}

// ============================================================================
// Analytics
// ============================================================================

export interface PlatformStats {
  platform: Platform;
  count: number;
  percentage: number;
}

export interface DailyDownloads {
  date: string;
  count: number;
}

export interface AppAnalytics {
  totalDownloads: number;
  downloadsLast7Days: number;
  downloadsLast30Days: number;
  platformBreakdown: PlatformStats[];
  dailyDownloads: DailyDownloads[];
  topVersions: { version: string; count: number }[];
}

// Get detailed analytics for an app
export async function getAppAnalytics(appId: string, days = 30): Promise<AppAnalytics> {
  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Get total downloads from the app record
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  const totalDownloads = app?.totalDownloads || 0;

  // Get downloads in the last 7 days
  const [last7Days] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(downloadEvents)
    .where(
      and(
        eq(downloadEvents.appId, appId),
        sql`${downloadEvents.createdAt} >= ${sevenDaysAgo}`
      )
    );

  // Get downloads in the last 30 days
  const [last30Days] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(downloadEvents)
    .where(
      and(
        eq(downloadEvents.appId, appId),
        sql`${downloadEvents.createdAt} >= ${startDate}`
      )
    );

  // Platform breakdown
  const platformStats = await db
    .select({
      platform: downloadEvents.platform,
      count: sql<number>`count(*)`,
    })
    .from(downloadEvents)
    .where(eq(downloadEvents.appId, appId))
    .groupBy(downloadEvents.platform)
    .orderBy(desc(sql`count(*)`));

  const platformTotal = platformStats.reduce((sum, p) => sum + Number(p.count), 0) || 1;
  const platformBreakdown: PlatformStats[] = platformStats.map((p) => ({
    platform: p.platform,
    count: Number(p.count),
    percentage: Math.round((Number(p.count) / platformTotal) * 100),
  }));

  // Daily downloads for the last N days
  const dailyStats = await db
    .select({
      date: sql<string>`date(${downloadEvents.createdAt})`,
      count: sql<number>`count(*)`,
    })
    .from(downloadEvents)
    .where(
      and(
        eq(downloadEvents.appId, appId),
        sql`${downloadEvents.createdAt} >= ${startDate}`
      )
    )
    .groupBy(sql`date(${downloadEvents.createdAt})`)
    .orderBy(sql`date(${downloadEvents.createdAt})`);

  // Fill in missing days with zeros
  const dailyDownloads: DailyDownloads[] = [];
  const statsMap = new Map(dailyStats.map((s) => [s.date, Number(s.count)]));

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    dailyDownloads.push({
      date: dateStr,
      count: statsMap.get(dateStr) || 0,
    });
  }

  // Top versions
  const versionStats = await db
    .select({
      version: downloadEvents.version,
      count: sql<number>`count(*)`,
    })
    .from(downloadEvents)
    .where(eq(downloadEvents.appId, appId))
    .groupBy(downloadEvents.version)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  const topVersions = versionStats.map((v) => ({
    version: v.version,
    count: Number(v.count),
  }));

  return {
    totalDownloads,
    downloadsLast7Days: Number(last7Days?.count || 0),
    downloadsLast30Days: Number(last30Days?.count || 0),
    platformBreakdown,
    dailyDownloads,
    topVersions,
  };
}

// Track an update check event (without download)
export async function trackUpdateCheck(
  appId: string,
  currentVersion: string,
  context?: Omit<DownloadContext, 'eventType'>
): Promise<void> {
  // Get latest release for reference
  const latestRelease = await getLatestRelease(appId);
  if (!latestRelease || !latestRelease.assets.length) return;

  // We don't have a specific asset, so pick the first one for reference
  const asset = latestRelease.assets[0];

  await db.insert(downloadEvents).values({
    appId,
    releaseId: latestRelease.id,
    assetId: asset.id,
    platform: asset.platform,
    version: currentVersion,
    userAgent: context?.userAgent,
    ipAddress: context?.ipAddress,
    country: context?.country,
    eventType: 'update_check',
  });
}

// ============================================================================
// Organizations with Apps
// ============================================================================

export interface OrganizationWithAppCount {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
  appCount: number;
}

// Get all organizations that have apps (for filter dropdown)
export async function getOrganizationsWithApps(): Promise<OrganizationWithAppCount[]> {
  const results = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      logoUrl: organizations.logoUrl,
      isVerified: organizations.isVerified,
      appCount: sql<number>`count(${apps.id})`,
    })
    .from(organizations)
    .innerJoin(apps, and(
      eq(apps.organizationId, organizations.id),
      eq(apps.isActive, true)
    ))
    .where(eq(organizations.isPublic, true))
    .groupBy(
      organizations.id,
      organizations.slug,
      organizations.name,
      organizations.logoUrl,
      organizations.isVerified
    )
    .orderBy(desc(sql`count(${apps.id})`));

  return results.map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    logoUrl: r.logoUrl,
    isVerified: r.isVerified,
    appCount: Number(r.appCount),
  }));
}
