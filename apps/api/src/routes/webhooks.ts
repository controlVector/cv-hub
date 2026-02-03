/**
 * Webhook Routes
 * CRUD and delivery management for repository webhooks
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import { repositories, webhooks } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as webhookService from '../services/webhook.service';
import { NotFoundError, ValidationError } from '../utils/errors';
import type { AppEnv } from '../app';

const webhookRoutes = new Hono<AppEnv>();

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
// Webhook CRUD
// ============================================================================

/**
 * POST /repos/:owner/:repo/hooks
 * Create a webhook
 */
const createWebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(1),
  events: z.array(z.string()).min(1),
  contentType: z.string().optional(),
});

webhookRoutes.post(
  '/repos/:owner/:repo/hooks',
  requireAuth,
  zValidator('json', createWebhookSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const webhook = await webhookService.createWebhook({
        repositoryId: repository.id,
        url: body.url,
        secret: body.secret,
        events: body.events,
        contentType: body.contentType,
        createdBy: userId,
      });

      // Don't expose the hashed secret in the response
      const { secret, ...rest } = webhook;
      return c.json({ webhook: rest }, 201);
    } catch (error: any) {
      if (error instanceof ValidationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  }
);

/**
 * GET /repos/:owner/:repo/hooks
 * List webhooks for a repository
 */
webhookRoutes.get(
  '/repos/:owner/:repo/hooks',
  requireAuth,
  async (c) => {
    const { owner, repo } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const hooks = await webhookService.listWebhooks(repository.id);
    return c.json({ webhooks: hooks });
  }
);

/**
 * GET /repos/:owner/:repo/hooks/:id
 * Get a webhook with recent deliveries
 */
webhookRoutes.get(
  '/repos/:owner/:repo/hooks/:id',
  requireAuth,
  async (c) => {
    const { owner, repo, id } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const webhook = await webhookService.getWebhook(id);
    if (!webhook || webhook.repositoryId !== repository.id) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    return c.json({ webhook });
  }
);

/**
 * PATCH /repos/:owner/:repo/hooks/:id
 * Update a webhook
 */
const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  secret: z.string().min(1).optional(),
  events: z.array(z.string()).min(1).optional(),
  contentType: z.string().optional(),
  active: z.boolean().optional(),
});

webhookRoutes.patch(
  '/repos/:owner/:repo/hooks/:id',
  requireAuth,
  zValidator('json', updateWebhookSchema),
  async (c) => {
    const { owner, repo, id } = c.req.param();
    const body = c.req.valid('json');

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Verify webhook belongs to this repo
    const existing = await webhookService.getWebhook(id);
    if (!existing || existing.repositoryId !== repository.id) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    try {
      const updated = await webhookService.updateWebhook(id, body);
      const { secret, ...rest } = updated;
      return c.json({ webhook: rest });
    } catch (error: any) {
      if (error instanceof ValidationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  }
);

/**
 * DELETE /repos/:owner/:repo/hooks/:id
 * Delete a webhook
 */
webhookRoutes.delete(
  '/repos/:owner/:repo/hooks/:id',
  requireAuth,
  async (c) => {
    const { owner, repo, id } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const existing = await webhookService.getWebhook(id);
    if (!existing || existing.repositoryId !== repository.id) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    try {
      await webhookService.deleteWebhook(id);
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
// Deliveries
// ============================================================================

/**
 * GET /repos/:owner/:repo/hooks/:id/deliveries
 * List delivery history for a webhook
 */
const deliveriesQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

webhookRoutes.get(
  '/repos/:owner/:repo/hooks/:id/deliveries',
  requireAuth,
  zValidator('query', deliveriesQuerySchema),
  async (c) => {
    const { owner, repo, id } = c.req.param();
    const { limit, offset } = c.req.valid('query');

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const existing = await webhookService.getWebhook(id);
    if (!existing || existing.repositoryId !== repository.id) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    const result = await webhookService.getDeliveries(id, { limit, offset });
    return c.json({
      deliveries: result.deliveries,
      total: result.total,
    });
  }
);

/**
 * POST /repos/:owner/:repo/hooks/:id/deliveries/:deliveryId/redeliver
 * Retry a failed delivery
 */
webhookRoutes.post(
  '/repos/:owner/:repo/hooks/:id/deliveries/:deliveryId/redeliver',
  requireAuth,
  async (c) => {
    const { owner, repo, id, deliveryId } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const existing = await webhookService.getWebhook(id);
    if (!existing || existing.repositoryId !== repository.id) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    try {
      const delivery = await webhookService.retryDelivery(deliveryId);
      return c.json({ delivery });
    } catch (error: any) {
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  }
);

/**
 * POST /repos/:owner/:repo/hooks/:id/ping
 * Send a test ping event
 */
webhookRoutes.post(
  '/repos/:owner/:repo/hooks/:id/ping',
  requireAuth,
  async (c) => {
    const { owner, repo, id } = c.req.param();

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Get full webhook (with secret) for ping delivery
    const webhook = await db.query.webhooks.findFirst({
      where: eq(webhooks.id, id),
    });

    if (!webhook || webhook.repositoryId !== repository.id) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    const delivery = await webhookService.pingWebhook(webhook);
    return c.json({ delivery });
  }
);

export { webhookRoutes };
