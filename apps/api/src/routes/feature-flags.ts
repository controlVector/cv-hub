/**
 * Feature Flags API Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import * as flagService from '../services/feature-flags.service';
import { requireAuth } from '../middleware/auth';
import { AuthenticationError } from '../utils/errors';
import type { AppEnv } from '../app';
import type { EvaluationContext } from '@cv-hub/shared';

const app = new Hono<AppEnv>();

// ============================================================================
// Helpers
// ============================================================================

function getUserId(c: { get: (key: 'userId') => string | undefined }): string {
  const userId = c.get('userId');
  if (!userId) throw new AuthenticationError('Not authenticated');
  return userId;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const createFlagSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9-_]+$/i, 'Key must be alphanumeric with dashes/underscores'),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  valueType: z.enum(['boolean', 'string', 'number', 'json']).optional(),
  defaultValue: z.unknown(),
  tags: z.array(z.string()).optional(),
  organizationId: z.string().uuid(),
});

const updateFlagSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  defaultValue: z.unknown().optional(),
  tags: z.array(z.string()).optional(),
});

const updateEnvironmentSchema = z.object({
  isEnabled: z.boolean().optional(),
  overrideValue: z.unknown().optional(),
  rolloutPercentage: z.number().min(0).max(100).nullable().optional(),
});

const flagRuleOperatorSchema = z.enum([
  'eq', 'neq', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'matches',
  'gt', 'gte', 'lt', 'lte', 'exists', 'notExists',
  'semverGt', 'semverGte', 'semverLt', 'semverLte', 'semverEq',
]);

const ruleConditionSchema = z.object({
  attribute: z.string().min(1),
  operator: flagRuleOperatorSchema,
  values: z.array(z.unknown()),
});

const addRuleSchema = z.object({
  conditions: z.array(ruleConditionSchema),
  segmentId: z.string().uuid().optional(),
  percentage: z.number().min(0).max(100).optional(),
  serveValue: z.unknown(),
  priority: z.number().optional(),
});

const segmentRuleSchema = z.object({
  attribute: z.string().min(1),
  operator: flagRuleOperatorSchema,
  values: z.array(z.unknown()),
});

const createSegmentSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9-_]+$/i),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  rules: z.array(segmentRuleSchema),
  matchMode: z.enum(['all', 'any']).optional(),
  organizationId: z.string().uuid(),
});

const bulkEvaluateSchema = z.object({
  context: z.record(z.unknown()),
  flagKeys: z.array(z.string()).optional(),
});

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  environment: z.string().min(1),
  canWrite: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
  organizationId: z.string().uuid(),
});

// ============================================================================
// API Key Auth Middleware (for SDK endpoints)
// ============================================================================

interface ApiKeyContext {
  apiKey: Awaited<ReturnType<typeof flagService.validateApiKey>>;
  organizationId: string;
  environment: string;
}

const requireApiKey = async (c: any, next: () => Promise<void>) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'API key required' }, 401);
  }

  const apiKey = authHeader.substring(7);
  const validated = await flagService.validateApiKey(apiKey);

  if (!validated) {
    return c.json({ error: 'Invalid or expired API key' }, 401);
  }

  c.set('apiKey', validated);
  c.set('flagOrgId', validated.organizationId);
  c.set('flagEnv', validated.environment);
  await next();
};

// ============================================================================
// Flag Routes
// ============================================================================

// Create flag
app.post('/', requireAuth, zValidator('json', createFlagSchema), async (c) => {
  const userId = getUserId(c);
  const input = c.req.valid('json');

  try {
    const flag = await flagService.createFlag({
      organizationId: input.organizationId,
      key: input.key,
      name: input.name,
      description: input.description,
      valueType: input.valueType,
      defaultValue: input.defaultValue,
      tags: input.tags,
      createdBy: userId,
    });

    return c.json({ flag }, 201);
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

// List flags
app.get('/', requireAuth, async (c) => {
  const organizationId = c.req.query('organizationId');
  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const search = c.req.query('search');
  const tags = c.req.query('tags')?.split(',').filter(Boolean);
  const includeArchived = c.req.query('includeArchived') === 'true';
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const result = await flagService.listFlags({
    organizationId,
    search,
    tags,
    includeArchived,
    limit,
    offset,
  });

  return c.json({
    flags: result.flags,
    total: result.total,
    hasMore: offset + result.flags.length < result.total,
  });
});

// Get flag
app.get('/:key', requireAuth, async (c) => {
  const { key } = c.req.param();
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  const environments = await flagService.listFlagEnvironments(flag.id);

  return c.json({ flag: { ...flag, environments } });
});

// Update flag
app.put('/:key', requireAuth, zValidator('json', updateFlagSchema), async (c) => {
  const { key } = c.req.param();
  const userId = getUserId(c);
  const input = c.req.valid('json');
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  const updated = await flagService.updateFlag(flag.id, {
    ...input,
    updatedBy: userId,
  });

  return c.json({ flag: updated });
});

// Archive flag
app.delete('/:key', requireAuth, async (c) => {
  const { key } = c.req.param();
  const userId = getUserId(c);
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  await flagService.archiveFlag(flag.id, userId);

  return c.json({ success: true });
});

// Restore flag
app.post('/:key/restore', requireAuth, async (c) => {
  const { key } = c.req.param();
  const userId = getUserId(c);
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  const restored = await flagService.restoreFlag(flag.id, userId);

  return c.json({ flag: restored });
});

// ============================================================================
// Environment Routes
// ============================================================================

// Get environments for flag
app.get('/:key/environments', requireAuth, async (c) => {
  const { key } = c.req.param();
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  const environments = await flagService.listFlagEnvironments(flag.id);

  return c.json({ environments });
});

// Update environment config
app.put('/:key/environments/:env', requireAuth, zValidator('json', updateEnvironmentSchema), async (c) => {
  const { key, env } = c.req.param();
  const userId = getUserId(c);
  const input = c.req.valid('json');
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  const environment = await flagService.updateFlagEnvironment(flag.id, env, {
    ...input,
    updatedBy: userId,
  });

  return c.json({ environment });
});

// Add targeting rule
app.post('/:key/environments/:env/rules', requireAuth, zValidator('json', addRuleSchema), async (c) => {
  const { key, env } = c.req.param();
  const userId = getUserId(c);
  const input = c.req.valid('json');
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  const environment = await flagService.addTargetingRule(flag.id, env, {
    conditions: input.conditions,
    segmentId: input.segmentId,
    percentage: input.percentage,
    serveValue: input.serveValue,
    priority: input.priority,
    updatedBy: userId,
  });

  return c.json({ environment }, 201);
});

// Update targeting rule
app.put('/:key/environments/:env/rules/:ruleId', requireAuth, zValidator('json', addRuleSchema.partial()), async (c) => {
  const { key, env, ruleId } = c.req.param();
  const userId = getUserId(c);
  const input = c.req.valid('json');
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  const environment = await flagService.updateTargetingRule(flag.id, env, ruleId, {
    ...input,
    updatedBy: userId,
  });

  if (!environment) {
    return c.json({ error: 'Rule not found' }, 404);
  }

  return c.json({ environment });
});

// Delete targeting rule
app.delete('/:key/environments/:env/rules/:ruleId', requireAuth, async (c) => {
  const { key, env, ruleId } = c.req.param();
  const userId = getUserId(c);
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  await flagService.deleteTargetingRule(flag.id, env, ruleId, userId);

  return c.json({ success: true });
});

// ============================================================================
// Segment Routes
// ============================================================================

// Create segment
app.post('/segments', requireAuth, zValidator('json', createSegmentSchema), async (c) => {
  const userId = getUserId(c);
  const input = c.req.valid('json');

  try {
    const segment = await flagService.createSegment({
      organizationId: input.organizationId,
      key: input.key,
      name: input.name,
      description: input.description,
      rules: input.rules,
      matchMode: input.matchMode,
      createdBy: userId,
    });

    return c.json({ segment }, 201);
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

// List segments
app.get('/segments', requireAuth, async (c) => {
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const segments = await flagService.listSegments(organizationId);

  return c.json({ segments, total: segments.length });
});

// Get segment
app.get('/segments/:key', requireAuth, async (c) => {
  const { key } = c.req.param();
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const segment = await flagService.getSegment(organizationId, key);
  if (!segment) {
    return c.json({ error: 'Segment not found' }, 404);
  }

  return c.json({ segment });
});

// Update segment
app.put('/segments/:id', requireAuth, zValidator('json', createSegmentSchema.partial()), async (c) => {
  const { id } = c.req.param();
  const input = c.req.valid('json');

  const segment = await flagService.updateSegment(id, input);
  if (!segment) {
    return c.json({ error: 'Segment not found' }, 404);
  }

  return c.json({ segment });
});

// Delete segment
app.delete('/segments/:id', requireAuth, async (c) => {
  const { id } = c.req.param();

  const deleted = await flagService.deleteSegment(id);
  if (!deleted) {
    return c.json({ error: 'Segment not found' }, 404);
  }

  return c.json({ success: true });
});

// ============================================================================
// Evaluation Routes (SDK - API Key Auth)
// ============================================================================

// Evaluate single flag
app.get('/evaluate/:key', requireApiKey, async (c) => {
  const { key } = c.req.param();
  const organizationId = c.get('flagOrgId') as string;
  const environment = c.get('flagEnv') as string;

  // Parse context from query string
  const context: EvaluationContext = {};
  const query = c.req.query();
  for (const [k, v] of Object.entries(query)) {
    if (k.startsWith('ctx.')) {
      context[k.substring(4)] = v;
    }
  }

  const result = await flagService.evaluate(organizationId, key, environment, context);

  return c.json(result);
});

// Bulk evaluate flags
app.post('/evaluate', requireApiKey, zValidator('json', bulkEvaluateSchema), async (c) => {
  const { context, flagKeys } = c.req.valid('json');
  const organizationId = c.get('flagOrgId') as string;
  const environment = c.get('flagEnv') as string;

  const result = await flagService.evaluateBulk(
    organizationId,
    environment,
    context as EvaluationContext,
    flagKeys
  );

  return c.json(result);
});

// SDK initialization endpoint
app.get('/sdk/init', requireApiKey, async (c) => {
  const organizationId = c.get('flagOrgId') as string;
  const environment = c.get('flagEnv') as string;

  const { flags } = await flagService.listFlags({
    organizationId,
    includeArchived: false,
    limit: 1000,
  });

  const segments = await flagService.listSegments(organizationId);

  // Transform for SDK
  const flagsMap: Record<string, unknown> = {};
  for (const flag of flags) {
    const envConfig = flag.environments?.find((e) => e.environment === environment);

    flagsMap[flag.key] = {
      key: flag.key,
      valueType: flag.valueType,
      defaultValue: flag.defaultValue,
      environmentValue: envConfig?.overrideValue,
      isEnabled: envConfig?.isEnabled ?? false,
      rules: envConfig?.rules ?? [],
      rolloutPercentage: envConfig?.rolloutPercentage,
    };
  }

  const segmentsMap: Record<string, unknown> = {};
  for (const segment of segments) {
    segmentsMap[segment.id] = {
      key: segment.key,
      rules: segment.rules,
      matchMode: segment.matchMode,
    };
  }

  return c.json({
    flags: flagsMap,
    segments: segmentsMap,
    evaluatedAt: new Date().toISOString(),
  });
});

// ============================================================================
// API Key Routes
// ============================================================================

// Create API key
app.post('/api-keys', requireAuth, zValidator('json', createApiKeySchema), async (c) => {
  const userId = getUserId(c);
  const input = c.req.valid('json');

  const { apiKey, plainKey } = await flagService.createApiKey({
    organizationId: input.organizationId,
    name: input.name,
    description: input.description,
    environment: input.environment,
    canWrite: input.canWrite,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    createdBy: userId,
  });

  return c.json({
    apiKey,
    plainKey, // Only returned on creation!
  }, 201);
});

// List API keys
app.get('/api-keys', requireAuth, async (c) => {
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const apiKeys = await flagService.listApiKeys(organizationId);

  return c.json({ apiKeys });
});

// Revoke API key
app.delete('/api-keys/:id', requireAuth, async (c) => {
  const { id } = c.req.param();

  const revoked = await flagService.revokeApiKey(id);
  if (!revoked) {
    return c.json({ error: 'API key not found' }, 404);
  }

  return c.json({ success: true });
});

// ============================================================================
// History Routes
// ============================================================================

// Get flag history
app.get('/:key/history', requireAuth, async (c) => {
  const { key } = c.req.param();
  const organizationId = c.req.query('organizationId');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  const result = await flagService.getFlagHistory(flag.id, limit, offset);

  return c.json({
    history: result.history,
    total: result.total,
    hasMore: offset + result.history.length < result.total,
  });
});

// ============================================================================
// Analytics Routes
// ============================================================================

// Get flag analytics
app.get('/:key/analytics', requireAuth, async (c) => {
  const { key } = c.req.param();
  const organizationId = c.req.query('organizationId');
  const environment = c.req.query('environment') || 'production';
  const days = parseInt(c.req.query('days') || '7', 10);

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const flag = await flagService.getFlag(organizationId, key);
  if (!flag) {
    return c.json({ error: 'Flag not found' }, 404);
  }

  const endTime = new Date();
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - days);

  const analytics = await flagService.getFlagAnalytics(
    flag.id,
    environment,
    startTime,
    endTime
  );

  return c.json({
    flagId: flag.id,
    environment,
    period: `${days}d`,
    dataPoints: analytics.map((a) => ({
      timestamp: a.timeBucket,
      evaluationCount: a.evaluationCount,
      trueCount: a.trueCount,
      falseCount: a.falseCount,
      uniqueUsers: a.uniqueUsers,
    })),
  });
});

export default app;
