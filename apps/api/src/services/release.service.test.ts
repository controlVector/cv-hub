import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, repositories, repoReleases, repoReleaseAssets } from '../db/schema';
import { eq } from 'drizzle-orm';

// Mock storage service
const mockStorage = {
  upload: vi.fn().mockResolvedValue('https://storage.example.com/key'),
  download: vi.fn().mockResolvedValue(Buffer.from('file-content')),
  delete: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(true),
  getUrl: vi.fn().mockReturnValue('https://storage.example.com/releases/test/v1.0.0/asset.zip'),
};

vi.mock('./storage.service', () => ({
  getStorage: () => mockStorage,
}));

import {
  createRelease,
  updateRelease,
  deleteRelease,
  listReleases,
  getRelease,
  getLatestRelease,
  getReleaseByTag,
  uploadAsset,
  deleteAsset,
  getAssetDownloadUrl,
  downloadAsset,
} from './release.service';

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const db = getTestDb();
  const [user] = await db.insert(users).values({
    username: `testuser_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    email: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`,
    displayName: 'Test User',
    emailVerified: true,
    ...overrides,
  }).returning();
  return user;
}

async function createTestRepo(userId: string) {
  const db = getTestDb();
  const slug = `test-repo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [repo] = await db.insert(repositories).values({
    userId,
    name: slug,
    slug,
    visibility: 'public',
    provider: 'local',
  }).returning();
  return repo;
}

describe('ReleaseService', () => {
  let user: typeof users.$inferSelect;
  let repo: typeof repositories.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables();
    vi.clearAllMocks();
    user = await createTestUser();
    repo = await createTestRepo(user.id);
  });

  describe('createRelease', () => {
    it('creates a published release', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Version 1.0.0',
        body: '## Changes\n- Initial release',
        authorId: user.id,
      });

      expect(release.id).toBeDefined();
      expect(release.repositoryId).toBe(repo.id);
      expect(release.tagName).toBe('v1.0.0');
      expect(release.name).toBe('Version 1.0.0');
      expect(release.body).toBe('## Changes\n- Initial release');
      expect(release.draft).toBe(false);
      expect(release.prerelease).toBe(false);
      expect(release.publishedAt).not.toBeNull();
      expect(release.authorId).toBe(user.id);
    });

    it('creates a draft release without publishedAt', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v2.0.0-beta',
        name: 'Version 2.0.0 Beta',
        draft: true,
        authorId: user.id,
      });

      expect(release.draft).toBe(true);
      expect(release.publishedAt).toBeNull();
    });

    it('creates a prerelease', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.1.0-rc1',
        name: 'Release Candidate 1',
        prerelease: true,
        authorId: user.id,
      });

      expect(release.prerelease).toBe(true);
    });

    it('throws ConflictError for duplicate tag name', async () => {
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Version 1.0.0',
        authorId: user.id,
      });

      await expect(
        createRelease({
          repositoryId: repo.id,
          tagName: 'v1.0.0',
          name: 'Another release',
          authorId: user.id,
        })
      ).rejects.toThrow('A release with tag "v1.0.0" already exists');
    });

    it('throws ValidationError for empty tag name', async () => {
      await expect(
        createRelease({
          repositoryId: repo.id,
          tagName: '',
          name: 'No Tag',
          authorId: user.id,
        })
      ).rejects.toThrow('Tag name is required');
    });

    it('throws ValidationError for whitespace-only tag name', async () => {
      await expect(
        createRelease({
          repositoryId: repo.id,
          tagName: '   ',
          name: 'Whitespace Tag',
          authorId: user.id,
        })
      ).rejects.toThrow('Tag name is required');
    });
  });

  describe('updateRelease', () => {
    it('updates release fields', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Original Name',
        authorId: user.id,
      });

      const updated = await updateRelease(release.id, {
        name: 'Updated Name',
        body: 'New release notes',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.body).toBe('New release notes');
    });

    it('sets publishedAt when transitioning from draft to published', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Draft Release',
        draft: true,
        authorId: user.id,
      });

      expect(release.publishedAt).toBeNull();

      const updated = await updateRelease(release.id, { draft: false });
      expect(updated.draft).toBe(false);
      expect(updated.publishedAt).not.toBeNull();
    });

    it('throws ConflictError when changing tag to existing one', async () => {
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });

      const release2 = await createRelease({
        repositoryId: repo.id,
        tagName: 'v2.0.0',
        name: 'Release 2',
        authorId: user.id,
      });

      await expect(
        updateRelease(release2.id, { tagName: 'v1.0.0' })
      ).rejects.toThrow('A release with tag "v1.0.0" already exists');
    });

    it('throws NotFoundError for non-existent release', async () => {
      await expect(
        updateRelease('00000000-0000-0000-0000-000000000000', { name: 'New' })
      ).rejects.toThrow('Release not found');
    });
  });

  describe('deleteRelease', () => {
    it('deletes a release', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'To Delete',
        authorId: user.id,
      });

      await deleteRelease(release.id);

      const result = await getRelease(release.id);
      expect(result).toBeNull();
    });

    it('deletes associated assets from storage', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release With Assets',
        authorId: user.id,
      });

      await uploadAsset(release.id, 'app.zip', 'application/zip', Buffer.from('content'));

      await deleteRelease(release.id);

      expect(mockStorage.delete).toHaveBeenCalled();
    });

    it('throws NotFoundError for non-existent release', async () => {
      await expect(
        deleteRelease('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Release not found');
    });
  });

  describe('listReleases', () => {
    beforeEach(async () => {
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v2.0.0',
        name: 'Release 2',
        authorId: user.id,
      });
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v3.0.0-draft',
        name: 'Draft Release',
        draft: true,
        authorId: user.id,
      });
    });

    it('lists published releases (hides drafts by default)', async () => {
      const result = await listReleases(repo.id);

      expect(result.releases).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.releases.every(r => !r.draft)).toBe(true);
    });

    it('includes drafts when requested', async () => {
      const result = await listReleases(repo.id, { includeDrafts: true });

      expect(result.releases).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('paginates results', async () => {
      const page1 = await listReleases(repo.id, { limit: 1, offset: 0 });
      const page2 = await listReleases(repo.id, { limit: 1, offset: 1 });

      expect(page1.releases).toHaveLength(1);
      expect(page1.total).toBe(2);
      expect(page2.releases).toHaveLength(1);
      expect(page1.releases[0].id).not.toBe(page2.releases[0].id);
    });

    it('includes author and assets in response', async () => {
      const result = await listReleases(repo.id);
      const release = result.releases[0] as any;

      expect(release.author).toBeDefined();
      expect(release.author.username).toBe(user.username);
      expect(release.assets).toBeDefined();
    });

    it('orders by most recent first', async () => {
      const result = await listReleases(repo.id);

      expect(result.releases[0].tagName).toBe('v2.0.0');
      expect(result.releases[1].tagName).toBe('v1.0.0');
    });
  });

  describe('getRelease', () => {
    it('returns release with author and assets', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });

      const result = await getRelease(release.id);

      expect(result).not.toBeNull();
      expect(result!.tagName).toBe('v1.0.0');
      expect(result!.author).toBeDefined();
      expect(result!.assets).toBeDefined();
    });

    it('returns null for non-existent release', async () => {
      const result = await getRelease('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('getLatestRelease', () => {
    it('returns the latest non-draft release', async () => {
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v2.0.0',
        name: 'Release 2',
        authorId: user.id,
      });
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v3.0.0-draft',
        name: 'Draft',
        draft: true,
        authorId: user.id,
      });

      const latest = await getLatestRelease(repo.id);

      expect(latest).not.toBeNull();
      expect(latest!.tagName).toBe('v2.0.0');
    });

    it('returns null when all releases are drafts', async () => {
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0-draft',
        name: 'Draft Only',
        draft: true,
        authorId: user.id,
      });

      const latest = await getLatestRelease(repo.id);
      expect(latest).toBeNull();
    });

    it('returns null when no releases exist', async () => {
      const latest = await getLatestRelease(repo.id);
      expect(latest).toBeNull();
    });
  });

  describe('getReleaseByTag', () => {
    it('returns a release by tag name', async () => {
      await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });

      const result = await getReleaseByTag(repo.id, 'v1.0.0');

      expect(result).not.toBeNull();
      expect(result!.tagName).toBe('v1.0.0');
    });

    it('returns null for non-existent tag', async () => {
      const result = await getReleaseByTag(repo.id, 'v999.0.0');
      expect(result).toBeNull();
    });
  });

  describe('uploadAsset', () => {
    it('uploads an asset to a release', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });

      const data = Buffer.from('binary-content');
      const asset = await uploadAsset(release.id, 'app.zip', 'application/zip', data);

      expect(asset.id).toBeDefined();
      expect(asset.releaseId).toBe(release.id);
      expect(asset.name).toBe('app.zip');
      expect(asset.contentType).toBe('application/zip');
      expect(asset.size).toBe(data.length);
      expect(asset.downloadCount).toBe(0);
      expect(asset.storageKey).toContain('releases/');
      expect(mockStorage.upload).toHaveBeenCalled();
    });

    it('throws ConflictError for duplicate asset name', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });

      await uploadAsset(release.id, 'app.zip', 'application/zip', Buffer.from('v1'));

      await expect(
        uploadAsset(release.id, 'app.zip', 'application/zip', Buffer.from('v2'))
      ).rejects.toThrow('An asset named "app.zip" already exists');
    });

    it('throws NotFoundError for non-existent release', async () => {
      await expect(
        uploadAsset('00000000-0000-0000-0000-000000000000', 'app.zip', 'application/zip', Buffer.from('data'))
      ).rejects.toThrow('Release not found');
    });

    it('stores asset with correct storage key', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });

      await uploadAsset(release.id, 'app.zip', 'application/zip', Buffer.from('data'));

      expect(mockStorage.upload).toHaveBeenCalledWith(
        `releases/${repo.id}/v1.0.0/app.zip`,
        expect.any(Buffer)
      );
    });
  });

  describe('deleteAsset', () => {
    it('deletes an asset from storage and database', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });

      const asset = await uploadAsset(release.id, 'app.zip', 'application/zip', Buffer.from('data'));

      await deleteAsset(asset.id);

      expect(mockStorage.delete).toHaveBeenCalledWith(asset.storageKey);

      // Verify removed from DB
      const db = getTestDb();
      const found = await db.query.repoReleaseAssets.findFirst({
        where: eq(repoReleaseAssets.id, asset.id),
      });
      expect(found).toBeUndefined();
    });

    it('throws NotFoundError for non-existent asset', async () => {
      await expect(
        deleteAsset('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Asset not found');
    });
  });

  describe('getAssetDownloadUrl', () => {
    it('returns URL and increments download count', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });

      const asset = await uploadAsset(release.id, 'app.zip', 'application/zip', Buffer.from('data'));

      const result = await getAssetDownloadUrl(asset.id);

      expect(result.url).toBeDefined();
      expect(result.asset.id).toBe(asset.id);
      expect(mockStorage.getUrl).toHaveBeenCalledWith(asset.storageKey);

      // Verify download count incremented
      const db = getTestDb();
      const [updated] = await db.select()
        .from(repoReleaseAssets)
        .where(eq(repoReleaseAssets.id, asset.id));

      expect(updated.downloadCount).toBe(1);
    });

    it('throws NotFoundError for non-existent asset', async () => {
      await expect(
        getAssetDownloadUrl('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Asset not found');
    });
  });

  describe('downloadAsset', () => {
    it('returns buffer data and increments download count', async () => {
      const release = await createRelease({
        repositoryId: repo.id,
        tagName: 'v1.0.0',
        name: 'Release 1',
        authorId: user.id,
      });

      const asset = await uploadAsset(release.id, 'app.zip', 'application/zip', Buffer.from('data'));

      const result = await downloadAsset(asset.id);

      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.data.toString()).toBe('file-content'); // from mock
      expect(result.asset.id).toBe(asset.id);
      expect(mockStorage.download).toHaveBeenCalledWith(asset.storageKey);
    });

    it('throws NotFoundError for non-existent asset', async () => {
      await expect(
        downloadAsset('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Asset not found');
    });
  });
});
