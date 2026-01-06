import { Hono } from 'hono';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';
import { stream } from 'hono/streaming';

import { requireAuth } from '../middleware/auth';
import { getStorage, generateAssetKey, calculateHash } from '../services/storage.service';
import { createReleaseAsset } from '../services/app-store.service';
import { db } from '../db';
import { releases } from '../db/schema';
import { eq } from 'drizzle-orm';
import { env } from '../config/env';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const storageRoutes = new Hono<AppEnv>();

// Content type mapping
const CONTENT_TYPES: Record<string, string> = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi',
  '.dmg': 'application/x-apple-diskimage',
  '.pkg': 'application/x-newton-compatible-pkg',
  '.deb': 'application/vnd.debian.binary-package',
  '.rpm': 'application/x-rpm',
  '.AppImage': 'application/x-executable',
  '.tar.gz': 'application/gzip',
  '.zip': 'application/zip',
};

function getContentType(fileName: string): string {
  for (const [ext, type] of Object.entries(CONTENT_TYPES)) {
    if (fileName.endsWith(ext)) return type;
  }
  return 'application/octet-stream';
}

// Helper to check if user is admin
function requireAdmin(c: any) {
  const userId = c.get('userId');
  if (!userId) throw new ForbiddenError('Admin access required');
}

// ============================================================================
// File Upload (Admin only)
// ============================================================================

// POST /api/storage/upload/:releaseId
// Uploads a file and creates a release asset record
storageRoutes.post('/upload/:releaseId', requireAuth, async (c) => {
  requireAdmin(c);

  const releaseId = c.req.param('releaseId');

  // Get the release to find app ID and version
  const release = await db.query.releases.findFirst({
    where: eq(releases.id, releaseId),
  });

  if (!release) {
    throw new NotFoundError('Release');
  }

  // Parse multipart form data
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const platform = formData.get('platform') as string | null;
  const signature = formData.get('signature') as string | null;

  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  if (!platform) {
    return c.json({ error: 'Platform is required' }, 400);
  }

  // Validate platform
  const validPlatforms = ['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64'];
  if (!validPlatforms.includes(platform)) {
    return c.json({ error: 'Invalid platform' }, 400);
  }

  // Read file content
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Calculate hash
  const fileHash = calculateHash(buffer);

  // Generate storage key
  const storageKey = generateAssetKey(release.appId, release.version, file.name);

  // Upload to storage
  const storage = getStorage();
  const downloadUrl = await storage.upload(storageKey, buffer);

  // Create release asset record
  const asset = await createReleaseAsset({
    releaseId,
    platform: platform as any,
    fileName: file.name,
    fileSize: buffer.length,
    fileHash,
    signature: signature || undefined,
    downloadUrl,
  });

  return c.json({
    success: true,
    asset,
    downloadUrl,
  }, 201);
});

// ============================================================================
// File Download (Public)
// ============================================================================

// GET /api/storage/releases/:appId/:version/:fileName
// Serves files from local storage
storageRoutes.get('/releases/:appId/:version/:fileName', async (c) => {
  const { appId, version, fileName } = c.req.param();

  // Only works with local storage
  if (env.STORAGE_TYPE !== 'local') {
    return c.json({ error: 'Direct file serving only available with local storage' }, 400);
  }

  const filePath = join(env.LOCAL_STORAGE_PATH, 'releases', appId, version, fileName);

  // Check if file exists
  if (!existsSync(filePath)) {
    throw new NotFoundError('File');
  }

  // Get file stats
  const stats = await stat(filePath);

  // Set headers
  c.header('Content-Type', getContentType(fileName));
  c.header('Content-Length', stats.size.toString());
  c.header('Content-Disposition', `attachment; filename="${fileName}"`);
  c.header('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year (immutable releases)

  // Stream the file
  return stream(c, async (stream) => {
    const readStream = createReadStream(filePath);
    for await (const chunk of readStream) {
      await stream.write(chunk);
    }
  });
});

// ============================================================================
// Storage Info (Admin only)
// ============================================================================

// GET /api/storage/info
storageRoutes.get('/info', requireAuth, async (c) => {
  requireAdmin(c);

  return c.json({
    storageType: env.STORAGE_TYPE,
    localPath: env.STORAGE_TYPE === 'local' ? env.LOCAL_STORAGE_PATH : null,
  });
});

export { storageRoutes };
