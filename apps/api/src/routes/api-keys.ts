import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import {
  createApiKey,
  getUserApiKeys,
  getApiKeyById,
  getDecryptedApiKey,
  updateApiKey,
  deleteApiKey,
  PROVIDER_INFO,
  type AIProvider,
} from '../services/api-keys.service';
import { logAuditEvent, type AuditAction } from '../services/audit.service';
import { NotFoundError, AuthenticationError } from '../utils/errors';
import type { AppEnv } from '../app';

const keys = new Hono<AppEnv>();

// All routes require authentication
keys.use('*', requireAuth);

// Helper to get userId from context
function getUserId(c: { get: (key: 'userId') => string | undefined }): string {
  const userId = c.get('userId');
  if (!userId) throw new AuthenticationError('Not authenticated');
  return userId;
}

// Helper to get request metadata
function getRequestMeta(c: any) {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : undefined,
    userAgent: c.req.header('user-agent'),
  };
}

// Provider list
const providers = [
  'openai', 'anthropic', 'google', 'mistral', 'cohere', 'groq', 'together', 'openrouter', 'custom'
] as const;

// GET /api/keys - List all API keys for user
keys.get('/', async (c) => {
  const userId = getUserId(c);
  const apiKeys = await getUserApiKeys(userId);

  return c.json({
    keys: apiKeys,
    providers: PROVIDER_INFO,
  });
});

// POST /api/keys - Create new API key
const createKeySchema = z.object({
  provider: z.enum(providers),
  name: z.string().min(1).max(100),
  apiKey: z.string().min(1),
  customEndpoint: z.string().url().optional(),
  expiresAt: z.string().datetime().optional(),
});

keys.post('/', zValidator('json', createKeySchema), async (c) => {
  const userId = getUserId(c);
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);

  const key = await createApiKey({
    userId,
    provider: input.provider as AIProvider,
    name: input.name,
    apiKey: input.apiKey,
    customEndpoint: input.customEndpoint,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
  });

  await logAuditEvent({
    userId,
    action: 'api_key.created' as AuditAction,
    resource: 'api_key',
    resourceId: key.id,
    details: { provider: input.provider },
    status: 'success',
    ...meta,
  });

  return c.json({ key }, 201);
});

// GET /api/keys/:id - Get single API key info
keys.get('/:id', async (c) => {
  const userId = getUserId(c);
  const keyId = c.req.param('id');

  const key = await getApiKeyById(userId, keyId);
  if (!key) {
    throw new NotFoundError('API key');
  }

  return c.json({ key });
});

// GET /api/keys/provider/:provider - Get decrypted key for provider (for cv-git)
keys.get('/provider/:provider', async (c) => {
  const userId = getUserId(c);
  const provider = c.req.param('provider') as AIProvider;

  if (!providers.includes(provider as any)) {
    throw new NotFoundError('Provider');
  }

  const apiKey = await getDecryptedApiKey(userId, provider);
  if (!apiKey) {
    throw new NotFoundError('API key for this provider');
  }

  return c.json({ key: apiKey });
});

// PATCH /api/keys/:id - Update API key
const updateKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  apiKey: z.string().min(1).optional(),
  customEndpoint: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

keys.patch('/:id', zValidator('json', updateKeySchema), async (c) => {
  const userId = getUserId(c);
  const keyId = c.req.param('id');
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);

  const key = await updateApiKey(userId, keyId, {
    ...input,
    expiresAt: input.expiresAt === null ? null : (input.expiresAt ? new Date(input.expiresAt) : undefined),
  });

  if (!key) {
    throw new NotFoundError('API key');
  }

  await logAuditEvent({
    userId,
    action: 'api_key.updated' as AuditAction,
    resource: 'api_key',
    resourceId: keyId,
    status: 'success',
    ...meta,
  });

  return c.json({ key });
});

// DELETE /api/keys/:id - Delete API key
keys.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const keyId = c.req.param('id');
  const meta = getRequestMeta(c);

  const deleted = await deleteApiKey(userId, keyId);
  if (!deleted) {
    throw new NotFoundError('API key');
  }

  await logAuditEvent({
    userId,
    action: 'api_key.deleted' as AuditAction,
    resource: 'api_key',
    resourceId: keyId,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

export { keys as apiKeysRoutes };
