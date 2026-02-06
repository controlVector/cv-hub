import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import { logAuditEvent, type AuditAction } from '../services/audit.service';
import { NotFoundError, AuthenticationError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';
import * as configService from '../services/config.service';
import { validateConfigToken } from '../services/config.service';
import type {
  ConfigScope,
  ConfigValueType,
  ConfigExportFormat,
  ConfigTokenPermission,
  ConfigSchemaDefinition,
} from '../db/schema/config';

const config = new Hono<AppEnv>();

// ============================================================================
// Helpers
// ============================================================================

function getUserId(c: { get: (key: 'userId') => string | undefined }): string {
  const userId = c.get('userId');
  if (!userId) throw new AuthenticationError('Not authenticated');
  return userId;
}

function getRequestMeta(c: any) {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : undefined,
    userAgent: c.req.header('user-agent'),
  };
}

// ============================================================================
// Schema Routes
// ============================================================================

const schemaDefinitionSchema = z.object({
  version: z.string(),
  keys: z.array(z.object({
    key: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'json', 'secret']),
    required: z.boolean().optional(),
    default: z.any().optional(),
    description: z.string().optional(),
    pattern: z.string().optional(),
    enum: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    deprecated: z.boolean().optional(),
    deprecationMessage: z.string().optional(),
  })),
});

const createSchemaInput = z.object({
  repositoryId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  definition: schemaDefinitionSchema,
});

const updateSchemaInput = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  definition: schemaDefinitionSchema.optional(),
  isActive: z.boolean().optional(),
});

// Create schema
config.post(
  '/schemas',
  requireAuth,
  zValidator('json', createSchemaInput),
  async (c) => {
    const userId = getUserId(c);
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const schema = await configService.createConfigSchema({
      ...input,
      definition: input.definition as ConfigSchemaDefinition,
      createdBy: userId,
    });

    await logAuditEvent({
      userId,
      action: 'config_schema.created' as AuditAction,
      resource: 'config_schema',
      resourceId: schema.id,
      status: 'success',
      ...meta,
    });

    return c.json({ schema }, 201);
  }
);

// List schemas
config.get('/schemas', requireAuth, async (c) => {
  const repositoryId = c.req.query('repositoryId');
  const organizationId = c.req.query('organizationId');

  const schemas = await configService.listConfigSchemas({
    repositoryId,
    organizationId,
  });

  return c.json({ schemas });
});

// Get schema
config.get('/schemas/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const schema = await configService.getConfigSchema(id);

  if (!schema) {
    throw new NotFoundError('Config schema');
  }

  return c.json({ schema });
});

// Update schema
config.put(
  '/schemas/:id',
  requireAuth,
  zValidator('json', updateSchemaInput),
  async (c) => {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const schema = await configService.updateConfigSchema(id, {
      ...input,
      definition: input.definition as ConfigSchemaDefinition | undefined,
    });

    if (!schema) {
      throw new NotFoundError('Config schema');
    }

    await logAuditEvent({
      userId,
      action: 'config_schema.updated' as AuditAction,
      resource: 'config_schema',
      resourceId: id,
      status: 'success',
      ...meta,
    });

    return c.json({ schema });
  }
);

// Delete schema
config.delete('/schemas/:id', requireAuth, async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const meta = getRequestMeta(c);

  const deleted = await configService.deleteConfigSchema(id);

  if (!deleted) {
    throw new NotFoundError('Config schema');
  }

  await logAuditEvent({
    userId,
    action: 'config_schema.deleted' as AuditAction,
    resource: 'config_schema',
    resourceId: id,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// Validate against schema
config.post('/schemas/:id/validate', requireAuth, async (c) => {
  const setId = c.req.query('setId');

  if (!setId) {
    return c.json({ error: 'setId query parameter required' }, 400);
  }

  const result = await configService.validateConfigSet(setId);

  return c.json(result);
});

// ============================================================================
// Store Routes
// ============================================================================

const createStoreInput = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  type: z.enum(['builtin', 'aws_ssm', 'hashicorp_vault', 'azure_keyvault', 'gcp_secrets']),
  credentials: z.object({
    awsAccessKeyId: z.string().optional(),
    awsSecretAccessKey: z.string().optional(),
    awsRegion: z.string().optional(),
    awsRoleArn: z.string().optional(),
    vaultAddress: z.string().optional(),
    vaultToken: z.string().optional(),
    vaultNamespace: z.string().optional(),
    vaultPath: z.string().optional(),
    azureClientId: z.string().optional(),
    azureClientSecret: z.string().optional(),
    azureTenantId: z.string().optional(),
    azureVaultUrl: z.string().optional(),
    gcpProjectId: z.string().optional(),
    gcpServiceAccountKey: z.string().optional(),
  }).optional(),
  isDefault: z.boolean().optional(),
});

const updateStoreInput = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  credentials: z.object({
    awsAccessKeyId: z.string().optional(),
    awsSecretAccessKey: z.string().optional(),
    awsRegion: z.string().optional(),
    awsRoleArn: z.string().optional(),
    vaultAddress: z.string().optional(),
    vaultToken: z.string().optional(),
    vaultNamespace: z.string().optional(),
    vaultPath: z.string().optional(),
    azureClientId: z.string().optional(),
    azureClientSecret: z.string().optional(),
    azureTenantId: z.string().optional(),
    azureVaultUrl: z.string().optional(),
    gcpProjectId: z.string().optional(),
    gcpServiceAccountKey: z.string().optional(),
  }).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// Create store
config.post(
  '/stores',
  requireAuth,
  zValidator('json', createStoreInput),
  async (c) => {
    const userId = getUserId(c);
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const store = await configService.createConfigStore({
      ...input,
      createdBy: userId,
    });

    await logAuditEvent({
      userId,
      action: 'config_store.created' as AuditAction,
      resource: 'config_store',
      resourceId: store.id,
      status: 'success',
      ...meta,
    });

    return c.json({ store }, 201);
  }
);

// List stores
config.get('/stores', requireAuth, async (c) => {
  const organizationId = c.req.query('organizationId');

  if (!organizationId) {
    return c.json({ error: 'organizationId query parameter required' }, 400);
  }

  const stores = await configService.listConfigStores(organizationId);

  return c.json({ stores });
});

// Get store
config.get('/stores/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const store = await configService.getConfigStore(id);

  if (!store) {
    throw new NotFoundError('Config store');
  }

  return c.json({ store });
});

// Test store connection
config.post('/stores/:id/test', requireAuth, async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const meta = getRequestMeta(c);

  const result = await configService.testConfigStore(id);

  await logAuditEvent({
    userId,
    action: 'config_store.tested' as AuditAction,
    resource: 'config_store',
    resourceId: id,
    details: { success: result.success },
    status: result.success ? 'success' : 'failure',
    ...meta,
  });

  return c.json(result);
});

// Update store
config.put(
  '/stores/:id',
  requireAuth,
  zValidator('json', updateStoreInput),
  async (c) => {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const store = await configService.updateConfigStore(id, input);

    if (!store) {
      throw new NotFoundError('Config store');
    }

    await logAuditEvent({
      userId,
      action: 'config_store.updated' as AuditAction,
      resource: 'config_store',
      resourceId: id,
      status: 'success',
      ...meta,
    });

    return c.json({ store });
  }
);

// Delete store
config.delete('/stores/:id', requireAuth, async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const meta = getRequestMeta(c);

  const deleted = await configService.deleteConfigStore(id);

  if (!deleted) {
    throw new NotFoundError('Config store');
  }

  await logAuditEvent({
    userId,
    action: 'config_store.deleted' as AuditAction,
    resource: 'config_store',
    resourceId: id,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// ============================================================================
// Config Set Routes
// ============================================================================

const createSetInput = z.object({
  storeId: z.string().uuid(),
  schemaId: z.string().uuid().optional(),
  scope: z.enum(['repository', 'organization', 'environment']),
  repositoryId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  environment: z.string().max(50).optional(),
  parentSetId: z.string().uuid().optional(),
});

const updateSetInput = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  schemaId: z.string().uuid().nullable().optional(),
  parentSetId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  lockedReason: z.string().optional(),
});

// Create config set
config.post(
  '/sets',
  requireAuth,
  zValidator('json', createSetInput),
  async (c) => {
    const userId = getUserId(c);
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const set = await configService.createConfigSet({
      ...input,
      scope: input.scope as ConfigScope,
      createdBy: userId,
    });

    await logAuditEvent({
      userId,
      action: 'config_set.created' as AuditAction,
      resource: 'config_set',
      resourceId: set.id,
      status: 'success',
      ...meta,
    });

    return c.json({ set }, 201);
  }
);

// List config sets
config.get('/sets', requireAuth, async (c) => {
  const storeId = c.req.query('storeId');
  const repositoryId = c.req.query('repositoryId');
  const organizationId = c.req.query('organizationId');
  const environment = c.req.query('environment');

  const sets = await configService.listConfigSets({
    storeId,
    repositoryId,
    organizationId,
    environment,
  });

  return c.json({ sets });
});

// Get config set
config.get('/sets/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const set = await configService.getConfigSet(id);

  if (!set) {
    throw new NotFoundError('Config set');
  }

  return c.json({ set });
});

// Get resolved config values (with inheritance)
config.get('/sets/:id/resolved', requireAuth, async (c) => {
  const id = c.req.param('id');
  const includeSecrets = c.req.query('includeSecrets') === 'true';

  const resolved = await configService.resolveConfigValues(id, {
    includeSecrets,
    maskSecrets: true,
  });

  return c.json(resolved);
});

// Compare two config sets
config.post('/sets/:id/compare', requireAuth, async (c) => {
  const id = c.req.param('id');
  const compareToId = c.req.query('compareToId');

  if (!compareToId) {
    return c.json({ error: 'compareToId query parameter required' }, 400);
  }

  const result = await configService.compareConfigSets(id, compareToId);

  return c.json(result);
});

// Clone config set
config.post(
  '/sets/:id/clone',
  requireAuth,
  zValidator('json', z.object({
    name: z.string().min(1).max(100),
    environment: z.string().max(50).optional(),
  })),
  async (c) => {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const cloned = await configService.cloneConfigSet(id, {
      ...input,
      createdBy: userId,
    });

    await logAuditEvent({
      userId,
      action: 'config_set.cloned' as AuditAction,
      resource: 'config_set',
      resourceId: cloned.id,
      details: { sourceId: id },
      status: 'success',
      ...meta,
    });

    return c.json({ set: cloned }, 201);
  }
);

// Update config set
config.put(
  '/sets/:id',
  requireAuth,
  zValidator('json', updateSetInput),
  async (c) => {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const set = await configService.updateConfigSet(id, {
      ...input,
      lockedBy: input.isLocked ? userId : undefined,
    });

    if (!set) {
      throw new NotFoundError('Config set');
    }

    await logAuditEvent({
      userId,
      action: 'config_set.updated' as AuditAction,
      resource: 'config_set',
      resourceId: id,
      status: 'success',
      ...meta,
    });

    return c.json({ set });
  }
);

// Delete config set
config.delete('/sets/:id', requireAuth, async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const meta = getRequestMeta(c);

  const deleted = await configService.deleteConfigSet(id);

  if (!deleted) {
    throw new NotFoundError('Config set');
  }

  await logAuditEvent({
    userId,
    action: 'config_set.deleted' as AuditAction,
    resource: 'config_set',
    resourceId: id,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// ============================================================================
// Config Value Routes
// ============================================================================

const setValueInput = z.object({
  value: z.any(),
  valueType: z.enum(['string', 'number', 'boolean', 'json', 'secret']).optional(),
  isSecret: z.boolean().optional(),
  description: z.string().optional(),
  changeReason: z.string().optional(),
});

const bulkSetInput = z.object({
  values: z.array(z.object({
    key: z.string(),
    value: z.any(),
    valueType: z.enum(['string', 'number', 'boolean', 'json', 'secret']).optional(),
    isSecret: z.boolean().optional(),
    description: z.string().optional(),
  })),
  changeReason: z.string().optional(),
});

// Get config value
config.get('/sets/:setId/values/:key', requireAuth, async (c) => {
  const setId = c.req.param('setId');
  const key = c.req.param('key');

  const value = await configService.getConfigValue(setId, key);

  if (!value) {
    throw new NotFoundError('Config value');
  }

  return c.json({ value });
});

// Set config value
config.put(
  '/sets/:setId/values/:key',
  requireAuth,
  zValidator('json', setValueInput),
  async (c) => {
    const userId = getUserId(c);
    const setId = c.req.param('setId');
    const key = c.req.param('key');
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const value = await configService.setConfigValue({
      configSetId: setId,
      key,
      value: input.value,
      valueType: input.valueType as ConfigValueType | undefined,
      isSecret: input.isSecret,
      description: input.description,
      changeReason: input.changeReason,
      changedBy: userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await logAuditEvent({
      userId,
      action: 'config_value.updated' as AuditAction,
      resource: 'config_value',
      resourceId: value.id,
      details: { key, setId },
      status: 'success',
      ...meta,
    });

    return c.json({ value });
  }
);

// Delete config value
config.delete('/sets/:setId/values/:key', requireAuth, async (c) => {
  const userId = getUserId(c);
  const setId = c.req.param('setId');
  const key = c.req.param('key');
  const meta = getRequestMeta(c);

  const deleted = await configService.deleteConfigValue(setId, key, {
    changedBy: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  if (!deleted) {
    throw new NotFoundError('Config value');
  }

  await logAuditEvent({
    userId,
    action: 'config_value.deleted' as AuditAction,
    resource: 'config_value',
    resourceId: key,
    details: { setId },
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// Bulk set values
config.post(
  '/sets/:setId/values/bulk',
  requireAuth,
  zValidator('json', bulkSetInput),
  async (c) => {
    const userId = getUserId(c);
    const setId = c.req.param('setId');
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const result = await configService.bulkSetConfigValues(
      setId,
      input.values.map(v => ({
        key: v.key,
        value: v.value,
        valueType: v.valueType as ConfigValueType | undefined,
        isSecret: v.isSecret,
        description: v.description,
      })),
      {
        changedBy: userId,
        changeReason: input.changeReason,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      }
    );

    await logAuditEvent({
      userId,
      action: 'config_value.bulk_updated' as AuditAction,
      resource: 'config_set',
      resourceId: setId,
      details: { count: result.set },
      status: 'success',
      ...meta,
    });

    return c.json(result);
  }
);

// Get value history
config.get('/sets/:setId/values/:key/history', requireAuth, async (c) => {
  const setId = c.req.param('setId');
  const key = c.req.param('key');
  const limit = parseInt(c.req.query('limit') || '50');

  const history = await configService.getConfigValueHistory(setId, key, limit);

  return c.json({ history });
});

// ============================================================================
// Export/Import Routes
// ============================================================================

// Export config set
config.post('/sets/:id/export', requireAuth, async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const format = c.req.query('format') || 'dotenv';
  const includeSecrets = c.req.query('includeSecrets') === 'true';
  const keyPrefix = c.req.query('keyPrefix');
  const keyTransform = c.req.query('keyTransform') as 'uppercase' | 'lowercase' | 'none' | undefined;
  const meta = getRequestMeta(c);

  const content = await configService.exportConfigSet(
    id,
    format as ConfigExportFormat,
    { includeSecrets, keyPrefix, keyTransform }
  );

  await logAuditEvent({
    userId,
    action: 'config_set.exported' as AuditAction,
    resource: 'config_set',
    resourceId: id,
    details: { format, includeSecrets },
    status: 'success',
    ...meta,
  });

  // Set appropriate content type
  const contentTypes: Record<string, string> = {
    dotenv: 'text/plain',
    json: 'application/json',
    yaml: 'text/yaml',
    k8s_configmap: 'application/json',
    k8s_secret: 'application/json',
    terraform: 'text/plain',
  };

  return new Response(content, {
    headers: {
      'Content-Type': contentTypes[format] || 'text/plain',
      'Content-Disposition': `attachment; filename="config.${format === 'dotenv' ? 'env' : format}"`,
    },
  });
});

// Import config set
config.post(
  '/sets/:id/import',
  requireAuth,
  zValidator('json', z.object({
    content: z.string(),
    format: z.enum(['dotenv', 'json']),
    changeReason: z.string().optional(),
  })),
  async (c) => {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const result = await configService.importConfigSet(id, input.content, input.format, {
      changedBy: userId,
      changeReason: input.changeReason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await logAuditEvent({
      userId,
      action: 'config_set.imported' as AuditAction,
      resource: 'config_set',
      resourceId: id,
      details: { format: input.format, imported: result.imported },
      status: 'success',
      ...meta,
    });

    return c.json(result);
  }
);

// ============================================================================
// Token Routes
// ============================================================================

const createTokenInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  permission: z.enum(['read', 'write', 'admin']).optional(),
  allowedSetIds: z.array(z.string().uuid()).optional(),
  expiresAt: z.string().datetime().optional(),
});

// Create access token
config.post(
  '/sets/:id/tokens',
  requireAuth,
  zValidator('json', createTokenInput),
  async (c) => {
    const userId = getUserId(c);
    const setId = c.req.param('id');
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const { token, plainToken } = await configService.createConfigToken({
      configSetId: setId,
      name: input.name,
      description: input.description,
      permission: input.permission as ConfigTokenPermission | undefined,
      allowedSetIds: input.allowedSetIds,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      createdBy: userId,
    });

    await logAuditEvent({
      userId,
      action: 'config_token.created' as AuditAction,
      resource: 'config_access_token',
      resourceId: token.id,
      status: 'success',
      ...meta,
    });

    return c.json({ token: { ...token, plainToken } }, 201);
  }
);

// List tokens
config.get('/sets/:id/tokens', requireAuth, async (c) => {
  const setId = c.req.param('id');
  const tokens = await configService.listConfigTokens(setId);

  return c.json({ tokens });
});

// Revoke token
config.delete('/tokens/:id', requireAuth, async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const meta = getRequestMeta(c);

  const revoked = await configService.revokeConfigToken(id);

  if (!revoked) {
    throw new NotFoundError('Config access token');
  }

  await logAuditEvent({
    userId,
    action: 'config_token.revoked' as AuditAction,
    resource: 'config_access_token',
    resourceId: id,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// ============================================================================
// CI/CD Integration Routes (Token Auth)
// ============================================================================

// Inject config for CI/CD pipeline
config.get('/inject', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Bearer token required');
  }

  const token = authHeader.substring(7);
  const accessToken = await validateConfigToken(token);

  if (!accessToken) {
    throw new AuthenticationError('Invalid or expired token');
  }

  const format = c.req.query('format') || 'env';
  const keyPrefix = c.req.query('prefix');
  const keyTransform = c.req.query('transform') as 'uppercase' | 'lowercase' | 'none' | undefined;

  // Check permission
  if (accessToken.permission === 'read' || accessToken.permission === 'write' || accessToken.permission === 'admin') {
    const values = await configService.getResolvedValuesAsObject(accessToken.configSetId, {
      includeSecrets: true,
      keyPrefix,
      keyTransform,
    });

    if (format === 'json') {
      return c.json({ values });
    }

    // Return as dotenv format
    const content = Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    return new Response(content, {
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  throw new ForbiddenError('Insufficient permissions');
});

// Validate config in CI/CD
config.post('/validate', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Bearer token required');
  }

  const token = authHeader.substring(7);
  const accessToken = await validateConfigToken(token);

  if (!accessToken) {
    throw new AuthenticationError('Invalid or expired token');
  }

  const result = await configService.validateConfigSet(accessToken.configSetId);

  return c.json(result);
});

export { config as configRoutes };
