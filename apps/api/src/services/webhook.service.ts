/**
 * Webhook Service
 * Manages webhook registrations and event delivery
 */

import crypto from 'crypto';
import { db } from '../db';
import {
  webhooks,
  webhookDeliveries,
  type Webhook,
  type WebhookDelivery,
} from '../db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface CreateWebhookInput {
  repositoryId: string;
  organizationId?: string;
  url: string;
  secret: string;
  events: string[];
  contentType?: string;
  createdBy: string;
}

export interface UpdateWebhookInput {
  url?: string;
  secret?: string;
  events?: string[];
  contentType?: string;
  active?: boolean;
}

export interface DeliveryListOptions {
  limit?: number;
  offset?: number;
}

const VALID_EVENTS = [
  'push',
  'pull_request',
  'issues',
  'issue_comment',
  'create',
  'delete',
  'ping',
];

const RETRY_BACKOFFS = [10_000, 60_000, 300_000]; // 10s, 60s, 5min
const DELIVERY_TIMEOUT = 10_000; // 10 seconds
const MAX_RETRIES = 3;

// ============================================================================
// Helpers
// ============================================================================

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function signPayload(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

// ============================================================================
// Webhook CRUD
// ============================================================================

export async function createWebhook(input: CreateWebhookInput): Promise<Webhook> {
  const { repositoryId, organizationId, url, secret, events, contentType, createdBy } = input;

  // Validate URL
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ValidationError('Webhook URL must use HTTP or HTTPS');
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('Invalid webhook URL');
  }

  // Validate events
  const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
  if (invalidEvents.length > 0) {
    throw new ValidationError(`Invalid events: ${invalidEvents.join(', ')}`);
  }

  if (events.length === 0) {
    throw new ValidationError('At least one event is required');
  }

  const [webhook] = await db.insert(webhooks).values({
    repositoryId,
    organizationId,
    url,
    secret: hashSecret(secret),
    events,
    contentType: contentType || 'application/json',
    createdBy,
  }).returning();

  return webhook;
}

export async function updateWebhook(
  id: string,
  input: UpdateWebhookInput
): Promise<Webhook> {
  const existing = await db.query.webhooks.findFirst({
    where: eq(webhooks.id, id),
  });

  if (!existing) {
    throw new NotFoundError('Webhook');
  }

  const updateData: Partial<Webhook> = {
    updatedAt: new Date(),
  };

  if (input.url !== undefined) {
    try {
      const parsed = new URL(input.url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new ValidationError('Webhook URL must use HTTP or HTTPS');
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('Invalid webhook URL');
    }
    updateData.url = input.url;
  }

  if (input.secret !== undefined) {
    updateData.secret = hashSecret(input.secret);
  }

  if (input.events !== undefined) {
    const invalidEvents = input.events.filter(e => !VALID_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      throw new ValidationError(`Invalid events: ${invalidEvents.join(', ')}`);
    }
    if (input.events.length === 0) {
      throw new ValidationError('At least one event is required');
    }
    updateData.events = input.events;
  }

  if (input.contentType !== undefined) updateData.contentType = input.contentType;
  if (input.active !== undefined) updateData.active = input.active;

  const [updated] = await db.update(webhooks)
    .set(updateData)
    .where(eq(webhooks.id, id))
    .returning();

  return updated;
}

export async function deleteWebhook(id: string): Promise<void> {
  const existing = await db.query.webhooks.findFirst({
    where: eq(webhooks.id, id),
  });

  if (!existing) {
    throw new NotFoundError('Webhook');
  }

  await db.delete(webhooks).where(eq(webhooks.id, id));
}

export async function listWebhooks(repositoryId: string): Promise<Omit<Webhook, 'secret'>[]> {
  const hooks = await db.query.webhooks.findMany({
    where: eq(webhooks.repositoryId, repositoryId),
    orderBy: desc(webhooks.createdAt),
  });

  // Mask secrets
  return hooks.map(({ secret, ...rest }) => rest) as Omit<Webhook, 'secret'>[];
}

export async function getWebhook(id: string): Promise<(Omit<Webhook, 'secret'> & { recentDeliveries: WebhookDelivery[] }) | null> {
  const webhook = await db.query.webhooks.findFirst({
    where: eq(webhooks.id, id),
    with: {
      deliveries: {
        orderBy: desc(webhookDeliveries.createdAt),
        limit: 10,
      },
    },
  });

  if (!webhook) return null;

  const { secret, deliveries, ...rest } = webhook;
  return {
    ...rest,
    recentDeliveries: deliveries,
  };
}

// ============================================================================
// Event Triggering
// ============================================================================

export async function triggerEvent(
  repoId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  // Find all active webhooks for this repo that subscribe to this event
  const matchingHooks = await db.query.webhooks.findMany({
    where: and(
      eq(webhooks.repositoryId, repoId),
      eq(webhooks.active, true),
    ),
  });

  // Filter to hooks subscribed to this event
  const hooks = matchingHooks.filter(h => h.events.includes(event));

  if (hooks.length === 0) return;

  // Spawn async delivery for each webhook (fire-and-forget per webhook)
  for (const hook of hooks) {
    deliverToWebhook(hook, event, payload).catch(err => {
      logger.error('api', `Webhook delivery failed for hook ${hook.id}`, err);
    });
  }
}

// ============================================================================
// Delivery
// ============================================================================

async function deliverToWebhook(
  webhook: Webhook,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const action = (payload.action as string) || undefined;
  const payloadJson = JSON.stringify(payload);

  // Create delivery record
  const [delivery] = await db.insert(webhookDeliveries).values({
    webhookId: webhook.id,
    event,
    action,
    payload,
    status: 'pending',
  }).returning();

  await attemptDelivery(delivery.id, webhook, event, payloadJson);
}

async function attemptDelivery(
  deliveryId: string,
  webhook: Webhook,
  event: string,
  payloadJson: string
): Promise<void> {
  const signature = signPayload(payloadJson, webhook.secret);

  const startTime = Date.now();
  let statusCode: number | undefined;
  let responseBody: string | undefined;
  let error: string | undefined;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': webhook.contentType,
        'X-Hub-Signature-256': `sha256=${signature}`,
        'X-Hook-Event': event,
        'X-Hook-Delivery': deliveryId,
        'User-Agent': 'ControlFab-Hookshot/1.0',
      },
      body: payloadJson,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    statusCode = response.status;

    // Read response body (limit to 10KB)
    const text = await response.text();
    responseBody = text.slice(0, 10_000);

    if (response.ok) {
      // Success
      await db.update(webhookDeliveries)
        .set({
          status: 'delivered',
          statusCode,
          responseBody,
          responseTimeMs: Date.now() - startTime,
          deliveredAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, deliveryId));
      return;
    }

    error = `HTTP ${statusCode}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const responseTimeMs = Date.now() - startTime;

  // Get current retry count
  const delivery = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, deliveryId),
  });

  const retryCount = (delivery?.retryCount || 0) + 1;

  if (retryCount < MAX_RETRIES) {
    // Schedule retry
    await db.update(webhookDeliveries)
      .set({
        statusCode,
        responseBody,
        responseTimeMs,
        retryCount,
        error,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    const backoff = RETRY_BACKOFFS[retryCount - 1] || RETRY_BACKOFFS[RETRY_BACKOFFS.length - 1];
    setTimeout(() => {
      attemptDelivery(deliveryId, webhook, event, payloadJson).catch(retryErr => {
        logger.error('api', `Webhook retry failed for delivery ${deliveryId}`, retryErr);
      });
    }, backoff);
  } else {
    // Max retries exceeded
    await db.update(webhookDeliveries)
      .set({
        status: 'failed',
        statusCode,
        responseBody,
        responseTimeMs,
        retryCount,
        error,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
  }
}

export async function deliverWebhook(deliveryId: string): Promise<void> {
  const delivery = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, deliveryId),
    with: {
      webhook: true,
    },
  });

  if (!delivery) {
    throw new NotFoundError('Webhook delivery');
  }

  const payloadJson = JSON.stringify(delivery.payload);
  await attemptDelivery(deliveryId, delivery.webhook, delivery.event, payloadJson);
}

export async function retryDelivery(deliveryId: string): Promise<WebhookDelivery> {
  const delivery = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, deliveryId),
    with: {
      webhook: true,
    },
  });

  if (!delivery) {
    throw new NotFoundError('Webhook delivery');
  }

  // Reset delivery status for re-attempt
  const [reset] = await db.update(webhookDeliveries)
    .set({
      status: 'pending',
      retryCount: 0,
      statusCode: null,
      responseBody: null,
      responseTimeMs: null,
      error: null,
      deliveredAt: null,
    })
    .where(eq(webhookDeliveries.id, deliveryId))
    .returning();

  // Fire async re-delivery
  const payloadJson = JSON.stringify(delivery.payload);
  attemptDelivery(deliveryId, delivery.webhook, delivery.event, payloadJson).catch(err => {
    logger.error('api', `Webhook redeliver failed for delivery ${deliveryId}`, err);
  });

  return reset;
}

export async function getDeliveries(
  webhookId: string,
  options: DeliveryListOptions = {}
): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
  const { limit = 30, offset = 0 } = options;

  const deliveries = await db.query.webhookDeliveries.findMany({
    where: eq(webhookDeliveries.webhookId, webhookId),
    orderBy: desc(webhookDeliveries.createdAt),
    limit,
    offset,
  });

  const [countResult] = await db
    .select({ count: count() })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId));

  return {
    deliveries,
    total: countResult?.count || 0,
  };
}

// ============================================================================
// Ping
// ============================================================================

export async function pingWebhook(webhook: Webhook): Promise<WebhookDelivery> {
  const payload = {
    zen: 'Keep it simple.',
    hook_id: webhook.id,
    hook: {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
    },
  };

  const [delivery] = await db.insert(webhookDeliveries).values({
    webhookId: webhook.id,
    event: 'ping',
    payload,
    status: 'pending',
  }).returning();

  const payloadJson = JSON.stringify(payload);

  // Deliver synchronously for ping so we can return the result
  const signature = signPayload(payloadJson, webhook.secret);
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': webhook.contentType,
        'X-Hub-Signature-256': `sha256=${signature}`,
        'X-Hook-Event': 'ping',
        'X-Hook-Delivery': delivery.id,
        'User-Agent': 'ControlFab-Hookshot/1.0',
      },
      body: payloadJson,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = (await response.text()).slice(0, 10_000);

    const [updated] = await db.update(webhookDeliveries)
      .set({
        status: response.ok ? 'delivered' : 'failed',
        statusCode: response.status,
        responseBody,
        responseTimeMs: Date.now() - startTime,
        deliveredAt: response.ok ? new Date() : null,
        error: response.ok ? null : `HTTP ${response.status}`,
      })
      .where(eq(webhookDeliveries.id, delivery.id))
      .returning();

    return updated;
  } catch (err) {
    const [updated] = await db.update(webhookDeliveries)
      .set({
        status: 'failed',
        responseTimeMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(webhookDeliveries.id, delivery.id))
      .returning();

    return updated;
  }
}
