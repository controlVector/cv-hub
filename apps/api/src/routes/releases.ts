/**
 * Release Routes
 * Repository release management and asset upload/download
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import { repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as releaseService from '../services/release.service';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import type { AppEnv } from '../app';

const releaseRoutes = new Hono<AppEnv>();

// ============================================================================
// Helper to get repository by owner/repo
// ============================================================================

async function getRepository(owner: string, repo: string) {
  const repository = await db.query.repositories.findFirst({
    where: eq(repositories.slug, repo),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repository) return null;

  const ownerSlug = repository.organization?.slug || repository.owner?.username;
  if (ownerSlug !== owner) return null;

  return repository;
}

// ============================================================================
// Release CRUD
// ============================================================================

/**
 * POST /repos/:owner/:repo/releases
 * Create a release
 */
const createReleaseSchema = z.object({
  tag_name: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  body: z.string().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

releaseRoutes.post(
  '/repos/:owner/:repo/releases',
  requireAuth,
  zValidator('json', createReleaseSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const release = await releaseService.createRelease({
        repositoryId: repository.id,
        tagName: body.tag_name,
        name: body.name,
        body: body.body,
        draft: body.draft,
        prerelease: body.prerelease,
        authorId: userId,
      });

      return c.json({ release }, 201);
    } catch (error: any) {
      if (error instanceof ValidationError) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof ConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  }
);

/**
 * GET /repos/:owner/:repo/releases
 * List releases for a repository
 */
const listReleasesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

releaseRoutes.get(
  '/repos/:owner/:repo/releases',
  zValidator('query', listReleasesSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const { limit, offset } = c.req.valid('query');

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Authenticated users who own the repo can see drafts
    const userId = c.get('userId');
    const isOwner = userId && (
      repository.userId === userId ||
      repository.organization?.id // Simplified: org members can see drafts
    );

    const result = await releaseService.listReleases(repository.id, {
      limit,
      offset,
      includeDrafts: !!isOwner,
    });

    return c.json({
      releases: result.releases,
      total: result.total,
    });
  }
);

/**
 * GET /repos/:owner/:repo/releases/latest
 * Get the latest published release
 */
releaseRoutes.get(
  '/repos/:owner/:repo/releases/latest',
  async (c) => {
    const { owner, repo } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const release = await releaseService.getLatestRelease(repository.id);
    if (!release) {
      return c.json({ error: 'No releases found' }, 404);
    }

    return c.json({ release });
  }
);

/**
 * GET /repos/:owner/:repo/releases/tags/:tag
 * Get a release by tag name
 */
releaseRoutes.get(
  '/repos/:owner/:repo/releases/tags/:tag',
  async (c) => {
    const { owner, repo, tag } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const release = await releaseService.getReleaseByTag(repository.id, tag);
    if (!release) {
      return c.json({ error: 'Release not found' }, 404);
    }

    // Hide drafts from non-owners
    const userId = c.get('userId');
    if (release.draft && release.authorId !== userId) {
      return c.json({ error: 'Release not found' }, 404);
    }

    return c.json({ release });
  }
);

/**
 * GET /repos/:owner/:repo/releases/:id
 * Get a release by ID
 */
releaseRoutes.get(
  '/repos/:owner/:repo/releases/:id',
  async (c) => {
    const { owner, repo, id } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const release = await releaseService.getRelease(id);
    if (!release || release.repositoryId !== repository.id) {
      return c.json({ error: 'Release not found' }, 404);
    }

    // Hide drafts from non-owners
    const userId = c.get('userId');
    if (release.draft && release.authorId !== userId) {
      return c.json({ error: 'Release not found' }, 404);
    }

    return c.json({ release });
  }
);

/**
 * PATCH /repos/:owner/:repo/releases/:id
 * Update a release
 */
const updateReleaseSchema = z.object({
  tag_name: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255).optional(),
  body: z.string().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

releaseRoutes.patch(
  '/repos/:owner/:repo/releases/:id',
  requireAuth,
  zValidator('json', updateReleaseSchema),
  async (c) => {
    const { owner, repo, id } = c.req.param();
    const body = c.req.valid('json');

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const existing = await releaseService.getRelease(id);
    if (!existing || existing.repositoryId !== repository.id) {
      return c.json({ error: 'Release not found' }, 404);
    }

    try {
      const updated = await releaseService.updateRelease(id, {
        tagName: body.tag_name,
        name: body.name,
        body: body.body,
        draft: body.draft,
        prerelease: body.prerelease,
      });

      return c.json({ release: updated });
    } catch (error: any) {
      if (error instanceof ValidationError) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof ConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  }
);

/**
 * DELETE /repos/:owner/:repo/releases/:id
 * Delete a release and its assets
 */
releaseRoutes.delete(
  '/repos/:owner/:repo/releases/:id',
  requireAuth,
  async (c) => {
    const { owner, repo, id } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const existing = await releaseService.getRelease(id);
    if (!existing || existing.repositoryId !== repository.id) {
      return c.json({ error: 'Release not found' }, 404);
    }

    try {
      await releaseService.deleteRelease(id);
      return c.json({ deleted: true });
    } catch (error: any) {
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  }
);

// ============================================================================
// Asset Endpoints
// ============================================================================

/**
 * POST /repos/:owner/:repo/releases/:id/assets
 * Upload an asset to a release
 */
releaseRoutes.post(
  '/repos/:owner/:repo/releases/:id/assets',
  requireAuth,
  async (c) => {
    const { owner, repo, id } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const existing = await releaseService.getRelease(id);
    if (!existing || existing.repositoryId !== repository.id) {
      return c.json({ error: 'Release not found' }, 404);
    }

    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'File is required' }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    const name = (formData.get('name') as string) || file.name;
    const contentType = file.type || 'application/octet-stream';

    try {
      const asset = await releaseService.uploadAsset(id, name, contentType, data);
      return c.json({ asset }, 201);
    } catch (error: any) {
      if (error instanceof ConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  }
);

/**
 * GET /repos/:owner/:repo/releases/:id/assets/:assetId
 * Download a release asset
 */
releaseRoutes.get(
  '/repos/:owner/:repo/releases/:id/assets/:assetId',
  async (c) => {
    const { owner, repo, id, assetId } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const release = await releaseService.getRelease(id);
    if (!release || release.repositoryId !== repository.id) {
      return c.json({ error: 'Release not found' }, 404);
    }

    // Hide draft release assets from non-owners
    const userId = c.get('userId');
    if (release.draft && release.authorId !== userId) {
      return c.json({ error: 'Release not found' }, 404);
    }

    try {
      const { data, asset } = await releaseService.downloadAsset(assetId);

      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': asset.contentType,
          'Content-Disposition': `attachment; filename="${asset.name}"`,
          'Content-Length': String(asset.size),
        },
      });
    } catch (error: any) {
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  }
);

/**
 * DELETE /repos/:owner/:repo/releases/:id/assets/:assetId
 * Delete a release asset
 */
releaseRoutes.delete(
  '/repos/:owner/:repo/releases/:id/assets/:assetId',
  requireAuth,
  async (c) => {
    const { owner, repo, id, assetId } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const existing = await releaseService.getRelease(id);
    if (!existing || existing.repositoryId !== repository.id) {
      return c.json({ error: 'Release not found' }, 404);
    }

    try {
      await releaseService.deleteAsset(assetId);
      return c.json({ deleted: true });
    } catch (error: any) {
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  }
);

export { releaseRoutes };
