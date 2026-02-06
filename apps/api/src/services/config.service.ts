import { eq, and, desc, inArray, sql, like, isNull } from 'drizzle-orm';
import { db } from '../db';
import {
  configSchemas,
  configStores,
  configSets,
  configValues,
  configValueHistory,
  configAccessTokens,
  configExports,
  configValidators,
  type ConfigSchema,
  type NewConfigSchema,
  type ConfigStore,
  type NewConfigStore,
  type ConfigSet,
  type NewConfigSet,
  type ConfigValue,
  type NewConfigValue,
  type ConfigValueHistoryEntry,
  type NewConfigValueHistoryEntry,
  type ConfigAccessToken,
  type NewConfigAccessToken,
  type ConfigExport,
  type NewConfigExport,
  type ConfigValidator,
  type NewConfigValidator,
  type ConfigSchemaDefinition,
  type ConfigStoreCredentials,
  type ConfigValidatorRule,
  type ConfigScope,
  type ConfigValueType,
  type ConfigExportFormat,
  type ConfigTokenPermission,
} from '../db/schema';
import {
  encryptConfigValue,
  decryptConfigValue,
  encryptStoreCredentials,
  decryptStoreCredentials,
  generateConfigToken,
  verifyConfigToken,
  serializeValue,
  deserializeValue,
  maskSecretValue,
} from './config-encryption.service';
import {
  resolveConfigValues,
  getResolvedValuesAsObject,
  getInheritanceChain,
} from './config-resolver.service';
import { getStoreAdapter } from './config-stores';
import { logger } from '../utils/logger';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';

// ============================================================================
// Schema Service
// ============================================================================

export interface CreateSchemaInput {
  repositoryId?: string;
  organizationId?: string;
  name: string;
  description?: string;
  definition: ConfigSchemaDefinition;
  createdBy?: string;
}

export interface UpdateSchemaInput {
  name?: string;
  description?: string;
  definition?: ConfigSchemaDefinition;
  isActive?: boolean;
}

export async function createConfigSchema(input: CreateSchemaInput): Promise<ConfigSchema> {
  // Validate that either repositoryId or organizationId is provided, not both
  if (!input.repositoryId && !input.organizationId) {
    throw new ValidationError('Either repositoryId or organizationId must be provided');
  }
  if (input.repositoryId && input.organizationId) {
    throw new ValidationError('Cannot provide both repositoryId and organizationId');
  }

  const [schema] = await db.insert(configSchemas).values({
    repositoryId: input.repositoryId,
    organizationId: input.organizationId,
    name: input.name,
    description: input.description,
    definition: input.definition,
    version: 1,
    createdBy: input.createdBy,
  }).returning();

  logger.info('config', 'Config schema created', { schemaId: schema.id, name: schema.name });

  return schema;
}

export async function getConfigSchema(id: string): Promise<ConfigSchema | null> {
  const schema = await db.query.configSchemas.findFirst({
    where: eq(configSchemas.id, id),
  });
  return schema ?? null;
}

export async function listConfigSchemas(options: {
  repositoryId?: string;
  organizationId?: string;
  activeOnly?: boolean;
}): Promise<ConfigSchema[]> {
  const conditions = [];

  if (options.repositoryId) {
    conditions.push(eq(configSchemas.repositoryId, options.repositoryId));
  }
  if (options.organizationId) {
    conditions.push(eq(configSchemas.organizationId, options.organizationId));
  }
  if (options.activeOnly !== false) {
    conditions.push(eq(configSchemas.isActive, true));
  }

  return db.query.configSchemas.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(configSchemas.createdAt)],
  });
}

export async function updateConfigSchema(
  id: string,
  input: UpdateSchemaInput
): Promise<ConfigSchema | null> {
  const existing = await getConfigSchema(id);
  if (!existing) return null;

  const updateData: Partial<NewConfigSchema> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  // If definition changes, create a new version
  if (input.definition !== undefined) {
    updateData.definition = input.definition;
    updateData.version = existing.version + 1;
    updateData.previousVersionId = existing.id;
  }

  const [updated] = await db.update(configSchemas)
    .set(updateData)
    .where(eq(configSchemas.id, id))
    .returning();

  logger.info('config', 'Config schema updated', { schemaId: id });

  return updated;
}

export async function deleteConfigSchema(id: string): Promise<boolean> {
  const result = await db.delete(configSchemas)
    .where(eq(configSchemas.id, id))
    .returning({ id: configSchemas.id });

  if (result.length > 0) {
    logger.info('config', 'Config schema deleted', { schemaId: id });
    return true;
  }
  return false;
}

// ============================================================================
// Store Service
// ============================================================================

export interface CreateStoreInput {
  organizationId: string;
  name: string;
  description?: string;
  type: 'builtin' | 'aws_ssm' | 'hashicorp_vault' | 'azure_keyvault' | 'gcp_secrets';
  credentials?: ConfigStoreCredentials;
  isDefault?: boolean;
  createdBy?: string;
}

export interface UpdateStoreInput {
  name?: string;
  description?: string;
  credentials?: ConfigStoreCredentials;
  isDefault?: boolean;
  isActive?: boolean;
}

export async function createConfigStore(input: CreateStoreInput): Promise<ConfigStore> {
  let encryptedCredentials: string | undefined;
  let credentialsIv: string | undefined;

  if (input.credentials && input.type !== 'builtin') {
    const encrypted = encryptStoreCredentials(input.credentials, input.organizationId);
    encryptedCredentials = encrypted.encryptedCredentials;
    credentialsIv = encrypted.iv;
  }

  // If this is the default store, unset any existing default
  if (input.isDefault) {
    await db.update(configStores)
      .set({ isDefault: false })
      .where(eq(configStores.organizationId, input.organizationId));
  }

  const [store] = await db.insert(configStores).values({
    organizationId: input.organizationId,
    name: input.name,
    description: input.description,
    type: input.type,
    encryptedCredentials,
    credentialsIv,
    isDefault: input.isDefault ?? false,
    createdBy: input.createdBy,
  }).returning();

  logger.info('config', 'Config store created', { storeId: store.id, type: store.type });

  return store;
}

export async function getConfigStore(id: string): Promise<ConfigStore | null> {
  const store = await db.query.configStores.findFirst({
    where: eq(configStores.id, id),
  });
  return store ?? null;
}

export async function listConfigStores(organizationId: string): Promise<ConfigStore[]> {
  return db.query.configStores.findMany({
    where: and(
      eq(configStores.organizationId, organizationId),
      eq(configStores.isActive, true)
    ),
    orderBy: [desc(configStores.isDefault), configStores.name],
  });
}

export async function testConfigStore(id: string): Promise<{
  success: boolean;
  message: string;
  latencyMs?: number;
}> {
  const store = await getConfigStore(id);
  if (!store) {
    throw new NotFoundError('Config store');
  }

  let credentials: ConfigStoreCredentials = {};
  if (store.encryptedCredentials && store.credentialsIv) {
    credentials = decryptStoreCredentials(
      store.encryptedCredentials,
      store.credentialsIv,
      store.organizationId
    );
  }

  const adapter = getStoreAdapter(store.type, { credentials });
  const result = await adapter.testConnection();

  // Update test results
  await db.update(configStores)
    .set({
      lastTestedAt: new Date(),
      lastTestSuccess: result.success,
      lastTestError: result.success ? null : result.message,
      updatedAt: new Date(),
    })
    .where(eq(configStores.id, id));

  return {
    success: result.success,
    message: result.message ?? '',
    latencyMs: result.latencyMs,
  };
}

export async function updateConfigStore(
  id: string,
  input: UpdateStoreInput
): Promise<ConfigStore | null> {
  const existing = await getConfigStore(id);
  if (!existing) return null;

  const updateData: Partial<NewConfigStore> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  if (input.credentials !== undefined && existing.type !== 'builtin') {
    const encrypted = encryptStoreCredentials(input.credentials, existing.organizationId);
    updateData.encryptedCredentials = encrypted.encryptedCredentials;
    updateData.credentialsIv = encrypted.iv;
  }

  if (input.isDefault) {
    await db.update(configStores)
      .set({ isDefault: false })
      .where(eq(configStores.organizationId, existing.organizationId));
    updateData.isDefault = true;
  }

  const [updated] = await db.update(configStores)
    .set(updateData)
    .where(eq(configStores.id, id))
    .returning();

  logger.info('config', 'Config store updated', { storeId: id });

  return updated;
}

export async function deleteConfigStore(id: string): Promise<boolean> {
  const result = await db.delete(configStores)
    .where(eq(configStores.id, id))
    .returning({ id: configStores.id });

  if (result.length > 0) {
    logger.info('config', 'Config store deleted', { storeId: id });
    return true;
  }
  return false;
}

// ============================================================================
// Config Set Service
// ============================================================================

export interface CreateConfigSetInput {
  storeId: string;
  schemaId?: string;
  scope: ConfigScope;
  repositoryId?: string;
  organizationId?: string;
  name: string;
  description?: string;
  environment?: string;
  parentSetId?: string;
  createdBy?: string;
}

export interface UpdateConfigSetInput {
  name?: string;
  description?: string;
  schemaId?: string | null;
  parentSetId?: string | null;
  isActive?: boolean;
  isLocked?: boolean;
  lockedReason?: string;
  lockedBy?: string;
}

export async function createConfigSet(input: CreateConfigSetInput): Promise<ConfigSet> {
  // Calculate hierarchy rank based on parent
  let hierarchyRank = 0;
  if (input.parentSetId) {
    const parent = await getConfigSet(input.parentSetId);
    if (parent) {
      hierarchyRank = parent.hierarchyRank + 1;
    }
  }

  const [configSet] = await db.insert(configSets).values({
    storeId: input.storeId,
    schemaId: input.schemaId,
    scope: input.scope,
    repositoryId: input.repositoryId,
    organizationId: input.organizationId,
    name: input.name,
    description: input.description,
    environment: input.environment,
    parentSetId: input.parentSetId,
    hierarchyRank,
    createdBy: input.createdBy,
  }).returning();

  logger.info('config', 'Config set created', {
    setId: configSet.id,
    name: configSet.name,
    environment: configSet.environment,
  });

  return configSet;
}

export async function getConfigSet(id: string): Promise<ConfigSet | null> {
  const set = await db.query.configSets.findFirst({
    where: eq(configSets.id, id),
  });
  return set ?? null;
}

export async function listConfigSets(options: {
  storeId?: string;
  repositoryId?: string;
  organizationId?: string;
  environment?: string;
  activeOnly?: boolean;
}): Promise<ConfigSet[]> {
  const conditions = [];

  if (options.storeId) {
    conditions.push(eq(configSets.storeId, options.storeId));
  }
  if (options.repositoryId) {
    conditions.push(eq(configSets.repositoryId, options.repositoryId));
  }
  if (options.organizationId) {
    conditions.push(eq(configSets.organizationId, options.organizationId));
  }
  if (options.environment) {
    conditions.push(eq(configSets.environment, options.environment));
  }
  if (options.activeOnly !== false) {
    conditions.push(eq(configSets.isActive, true));
  }

  return db.query.configSets.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [configSets.environment, configSets.name],
  });
}

export async function updateConfigSet(
  id: string,
  input: UpdateConfigSetInput
): Promise<ConfigSet | null> {
  const existing = await getConfigSet(id);
  if (!existing) return null;

  const updateData: Partial<NewConfigSet> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.schemaId !== undefined) updateData.schemaId = input.schemaId;
  if (input.parentSetId !== undefined) updateData.parentSetId = input.parentSetId;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  if (input.isLocked !== undefined) {
    updateData.isLocked = input.isLocked;
    if (input.isLocked) {
      updateData.lockedReason = input.lockedReason;
      updateData.lockedBy = input.lockedBy;
      updateData.lockedAt = new Date();
    } else {
      updateData.lockedReason = null;
      updateData.lockedBy = null;
      updateData.lockedAt = null;
    }
  }

  const [updated] = await db.update(configSets)
    .set(updateData)
    .where(eq(configSets.id, id))
    .returning();

  logger.info('config', 'Config set updated', { setId: id });

  return updated;
}

export async function deleteConfigSet(id: string): Promise<boolean> {
  const result = await db.delete(configSets)
    .where(eq(configSets.id, id))
    .returning({ id: configSets.id });

  if (result.length > 0) {
    logger.info('config', 'Config set deleted', { setId: id });
    return true;
  }
  return false;
}

export async function cloneConfigSet(
  sourceId: string,
  input: {
    name: string;
    environment?: string;
    createdBy?: string;
  }
): Promise<ConfigSet> {
  const source = await getConfigSet(sourceId);
  if (!source) {
    throw new NotFoundError('Config set');
  }

  // Create new set
  const newSet = await createConfigSet({
    storeId: source.storeId,
    schemaId: source.schemaId ?? undefined,
    scope: source.scope,
    repositoryId: source.repositoryId ?? undefined,
    organizationId: source.organizationId ?? undefined,
    name: input.name,
    description: source.description ?? undefined,
    environment: input.environment ?? source.environment ?? undefined,
    parentSetId: source.parentSetId ?? undefined,
    createdBy: input.createdBy,
  });

  // Copy all values
  const sourceValues = await db.query.configValues.findMany({
    where: eq(configValues.configSetId, sourceId),
  });

  for (const value of sourceValues) {
    await db.insert(configValues).values({
      configSetId: newSet.id,
      key: value.key,
      valueType: value.valueType,
      encryptedValue: value.encryptedValue,
      encryptionIv: value.encryptionIv,
      isSecret: value.isSecret,
      isEncrypted: value.isEncrypted,
      description: value.description,
      createdBy: input.createdBy,
    });
  }

  logger.info('config', 'Config set cloned', { sourceId, newSetId: newSet.id });

  return newSet;
}

// ============================================================================
// Config Value Service
// ============================================================================

export interface SetValueInput {
  configSetId: string;
  key: string;
  value: unknown;
  valueType?: ConfigValueType;
  isSecret?: boolean;
  description?: string;
  changeReason?: string;
  changedBy?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface GetValueResult {
  key: string;
  value: unknown;
  valueType: ConfigValueType;
  isSecret: boolean;
  version: number;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function setConfigValue(input: SetValueInput): Promise<ConfigValue> {
  const configSet = await getConfigSet(input.configSetId);
  if (!configSet) {
    throw new NotFoundError('Config set');
  }

  if (configSet.isLocked) {
    throw new ConflictError('Config set is locked');
  }

  const valueType = input.valueType ?? 'string';
  const serialized = serializeValue(input.value, valueType);
  const { encryptedValue, iv } = encryptConfigValue(serialized, {
    configSetId: input.configSetId,
  });

  // Check if value already exists
  const existing = await db.query.configValues.findFirst({
    where: and(
      eq(configValues.configSetId, input.configSetId),
      eq(configValues.key, input.key)
    ),
  });

  let result: ConfigValue;
  let changeType: 'create' | 'update';

  if (existing) {
    // Update existing value
    changeType = 'update';

    // Record history
    await db.insert(configValueHistory).values({
      configValueId: existing.id,
      configSetId: input.configSetId,
      key: input.key,
      previousEncryptedValue: existing.encryptedValue,
      previousEncryptionIv: existing.encryptionIv,
      newEncryptedValue: encryptedValue,
      newEncryptionIv: iv,
      previousVersion: existing.version,
      newVersion: existing.version + 1,
      changedBy: input.changedBy,
      changeReason: input.changeReason,
      changeType,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    const [updated] = await db.update(configValues)
      .set({
        encryptedValue,
        encryptionIv: iv,
        valueType,
        isSecret: input.isSecret ?? existing.isSecret,
        description: input.description ?? existing.description,
        version: existing.version + 1,
        lastUpdatedBy: input.changedBy,
        updatedAt: new Date(),
      })
      .where(eq(configValues.id, existing.id))
      .returning();

    result = updated;
  } else {
    // Create new value
    changeType = 'create';

    const [created] = await db.insert(configValues).values({
      configSetId: input.configSetId,
      key: input.key,
      valueType,
      encryptedValue,
      encryptionIv: iv,
      isSecret: input.isSecret ?? false,
      description: input.description,
      createdBy: input.changedBy,
    }).returning();

    // Record history for creation
    await db.insert(configValueHistory).values({
      configValueId: created.id,
      configSetId: input.configSetId,
      key: input.key,
      newEncryptedValue: encryptedValue,
      newEncryptionIv: iv,
      newVersion: 1,
      changedBy: input.changedBy,
      changeReason: input.changeReason,
      changeType,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    result = created;
  }

  logger.info('config', `Config value ${changeType}d`, {
    setId: input.configSetId,
    key: input.key,
  });

  return result;
}

export async function getConfigValue(
  configSetId: string,
  key: string,
  includeValue: boolean = true
): Promise<GetValueResult | null> {
  const value = await db.query.configValues.findFirst({
    where: and(
      eq(configValues.configSetId, configSetId),
      eq(configValues.key, key)
    ),
  });

  if (!value) return null;

  let decryptedValue: unknown = '[ENCRYPTED]';
  if (includeValue) {
    try {
      const decrypted = decryptConfigValue(
        value.encryptedValue,
        value.encryptionIv,
        { configSetId }
      );
      decryptedValue = deserializeValue(decrypted, value.valueType);

      if (value.isSecret) {
        decryptedValue = maskSecretValue(String(decryptedValue));
      }
    } catch {
      decryptedValue = '[DECRYPTION_ERROR]';
    }
  }

  return {
    key: value.key,
    value: decryptedValue,
    valueType: value.valueType,
    isSecret: value.isSecret,
    version: value.version,
    description: value.description ?? undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function deleteConfigValue(
  configSetId: string,
  key: string,
  options?: {
    changedBy?: string;
    changeReason?: string;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<boolean> {
  const existing = await db.query.configValues.findFirst({
    where: and(
      eq(configValues.configSetId, configSetId),
      eq(configValues.key, key)
    ),
  });

  if (!existing) return false;

  // Record deletion in history
  await db.insert(configValueHistory).values({
    configValueId: existing.id,
    configSetId,
    key,
    previousEncryptedValue: existing.encryptedValue,
    previousEncryptionIv: existing.encryptionIv,
    previousVersion: existing.version,
    newVersion: existing.version,
    changedBy: options?.changedBy,
    changeReason: options?.changeReason,
    changeType: 'delete',
    ipAddress: options?.ipAddress,
    userAgent: options?.userAgent,
  });

  await db.delete(configValues).where(eq(configValues.id, existing.id));

  logger.info('config', 'Config value deleted', { setId: configSetId, key });

  return true;
}

export async function bulkSetConfigValues(
  configSetId: string,
  values: Array<{
    key: string;
    value: unknown;
    valueType?: ConfigValueType;
    isSecret?: boolean;
    description?: string;
  }>,
  options?: {
    changedBy?: string;
    changeReason?: string;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<{ set: number; errors: Array<{ key: string; error: string }> }> {
  const errors: Array<{ key: string; error: string }> = [];
  let set = 0;

  for (const item of values) {
    try {
      await setConfigValue({
        configSetId,
        key: item.key,
        value: item.value,
        valueType: item.valueType,
        isSecret: item.isSecret,
        description: item.description,
        changedBy: options?.changedBy,
        changeReason: options?.changeReason,
        ipAddress: options?.ipAddress,
        userAgent: options?.userAgent,
      });
      set++;
    } catch (error: any) {
      errors.push({ key: item.key, error: error.message });
    }
  }

  return { set, errors };
}

export async function getConfigValueHistory(
  configSetId: string,
  key: string,
  limit: number = 50
): Promise<ConfigValueHistoryEntry[]> {
  return db.query.configValueHistory.findMany({
    where: and(
      eq(configValueHistory.configSetId, configSetId),
      eq(configValueHistory.key, key)
    ),
    orderBy: [desc(configValueHistory.createdAt)],
    limit,
  });
}

// ============================================================================
// Access Token Service
// ============================================================================

export interface CreateTokenInput {
  configSetId: string;
  name: string;
  description?: string;
  permission?: ConfigTokenPermission;
  allowedSetIds?: string[];
  expiresAt?: Date;
  createdBy?: string;
}

export async function createConfigToken(input: CreateTokenInput): Promise<{
  token: ConfigAccessToken;
  plainToken: string;
}> {
  const { token, tokenPrefix, tokenHash } = generateConfigToken();

  const [created] = await db.insert(configAccessTokens).values({
    configSetId: input.configSetId,
    name: input.name,
    description: input.description,
    tokenPrefix,
    tokenHash,
    permission: input.permission ?? 'read',
    allowedSetIds: input.allowedSetIds,
    expiresAt: input.expiresAt,
    createdBy: input.createdBy,
  }).returning();

  logger.info('config', 'Config access token created', {
    tokenId: created.id,
    setId: input.configSetId,
  });

  return { token: created, plainToken: token };
}

export async function validateConfigToken(token: string): Promise<ConfigAccessToken | null> {
  // Extract prefix for lookup
  const prefix = token.substring(0, 8);

  const tokens = await db.query.configAccessTokens.findMany({
    where: and(
      eq(configAccessTokens.tokenPrefix, prefix),
      eq(configAccessTokens.isActive, true)
    ),
  });

  for (const t of tokens) {
    if (verifyConfigToken(token, t.tokenHash)) {
      // Check expiration
      if (t.expiresAt && t.expiresAt < new Date()) {
        return null;
      }

      // Update usage
      await db.update(configAccessTokens)
        .set({
          lastUsedAt: new Date(),
          usageCount: t.usageCount + 1,
        })
        .where(eq(configAccessTokens.id, t.id));

      return t;
    }
  }

  return null;
}

export async function listConfigTokens(configSetId: string): Promise<ConfigAccessToken[]> {
  return db.query.configAccessTokens.findMany({
    where: eq(configAccessTokens.configSetId, configSetId),
    orderBy: [desc(configAccessTokens.createdAt)],
  });
}

export async function revokeConfigToken(id: string): Promise<boolean> {
  const [updated] = await db.update(configAccessTokens)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(configAccessTokens.id, id))
    .returning();

  if (updated) {
    logger.info('config', 'Config access token revoked', { tokenId: id });
    return true;
  }
  return false;
}

// ============================================================================
// Export Service
// ============================================================================

export async function exportConfigSet(
  configSetId: string,
  format: ConfigExportFormat,
  options?: {
    includeSecrets?: boolean;
    keyPrefix?: string;
    keyTransform?: 'uppercase' | 'lowercase' | 'none';
  }
): Promise<string> {
  const resolved = await getResolvedValuesAsObject(configSetId, {
    includeSecrets: options?.includeSecrets ?? false,
    keyPrefix: options?.keyPrefix,
    keyTransform: options?.keyTransform,
  });

  switch (format) {
    case 'dotenv':
      return Object.entries(resolved)
        .map(([key, value]) => {
          // Escape special characters for dotenv
          const escaped = value.replace(/"/g, '\\"').replace(/\n/g, '\\n');
          return `${key}="${escaped}"`;
        })
        .join('\n');

    case 'json':
      return JSON.stringify(resolved, null, 2);

    case 'yaml':
      // Simple YAML serialization
      return Object.entries(resolved)
        .map(([key, value]) => `${key}: "${value.replace(/"/g, '\\"')}"`)
        .join('\n');

    case 'k8s_configmap':
      return JSON.stringify({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'config' },
        data: resolved,
      }, null, 2);

    case 'k8s_secret':
      const base64Data: Record<string, string> = {};
      for (const [key, value] of Object.entries(resolved)) {
        base64Data[key] = Buffer.from(value).toString('base64');
      }
      return JSON.stringify({
        apiVersion: 'v1',
        kind: 'Secret',
        type: 'Opaque',
        metadata: { name: 'config' },
        data: base64Data,
      }, null, 2);

    case 'terraform':
      return Object.entries(resolved)
        .map(([key, value]) => `variable "${key}" {\n  default = "${value.replace(/"/g, '\\"')}"\n}`)
        .join('\n\n');

    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

export async function importConfigSet(
  configSetId: string,
  content: string,
  format: 'dotenv' | 'json',
  options?: {
    changedBy?: string;
    changeReason?: string;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<{ imported: number; skipped: number; errors: Array<{ key: string; error: string }> }> {
  let values: Record<string, string> = {};

  if (format === 'json') {
    values = JSON.parse(content);
  } else if (format === 'dotenv') {
    // Parse dotenv format
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        // Unescape
        value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
        values[key] = value;
      }
    }
  }

  const items = Object.entries(values).map(([key, value]) => ({
    key,
    value,
    valueType: 'string' as ConfigValueType,
  }));

  const result = await bulkSetConfigValues(configSetId, items, options);

  return {
    imported: result.set,
    skipped: items.length - result.set - result.errors.length,
    errors: result.errors,
  };
}

// ============================================================================
// Validation Service
// ============================================================================

export async function validateConfigSet(configSetId: string): Promise<{
  valid: boolean;
  errors: Array<{ key: string; message: string; validatorName?: string }>;
  warnings: Array<{ key: string; message: string }>;
}> {
  const configSet = await getConfigSet(configSetId);
  if (!configSet) {
    throw new NotFoundError('Config set');
  }

  const errors: Array<{ key: string; message: string; validatorName?: string }> = [];
  const warnings: Array<{ key: string; message: string }> = [];

  if (!configSet.schemaId) {
    // No schema, nothing to validate
    return { valid: true, errors, warnings };
  }

  const schema = await getConfigSchema(configSet.schemaId);
  if (!schema) {
    return { valid: true, errors, warnings };
  }

  const resolved = await resolveConfigValues(configSetId, {
    includeSecrets: true,
    maskSecrets: false,
    decryptValues: true,
  });

  const valueMap = new Map(resolved.values.map(v => [v.key, v]));

  // Validate against schema
  for (const keyDef of schema.definition.keys) {
    const value = valueMap.get(keyDef.key);

    // Check required
    if (keyDef.required && !value) {
      errors.push({
        key: keyDef.key,
        message: `Required key "${keyDef.key}" is missing`,
      });
      continue;
    }

    if (!value) continue;

    // Check deprecated
    if (keyDef.deprecated) {
      warnings.push({
        key: keyDef.key,
        message: keyDef.deprecationMessage || `Key "${keyDef.key}" is deprecated`,
      });
    }

    // Type validation
    if (keyDef.type === 'number' && typeof value.value !== 'number') {
      errors.push({
        key: keyDef.key,
        message: `Expected number, got ${typeof value.value}`,
      });
    }

    if (keyDef.type === 'boolean' && typeof value.value !== 'boolean') {
      errors.push({
        key: keyDef.key,
        message: `Expected boolean, got ${typeof value.value}`,
      });
    }

    // Pattern validation
    if (keyDef.pattern && typeof value.value === 'string') {
      const regex = new RegExp(keyDef.pattern);
      if (!regex.test(value.value)) {
        errors.push({
          key: keyDef.key,
          message: `Value does not match pattern: ${keyDef.pattern}`,
        });
      }
    }

    // Enum validation
    if (keyDef.enum && !keyDef.enum.includes(String(value.value))) {
      errors.push({
        key: keyDef.key,
        message: `Value must be one of: ${keyDef.enum.join(', ')}`,
      });
    }

    // Range validation
    if (typeof value.value === 'number') {
      if (keyDef.min !== undefined && value.value < keyDef.min) {
        errors.push({
          key: keyDef.key,
          message: `Value must be >= ${keyDef.min}`,
        });
      }
      if (keyDef.max !== undefined && value.value > keyDef.max) {
        errors.push({
          key: keyDef.key,
          message: `Value must be <= ${keyDef.max}`,
        });
      }
    }

    // Length validation
    if (typeof value.value === 'string') {
      if (keyDef.minLength !== undefined && value.value.length < keyDef.minLength) {
        errors.push({
          key: keyDef.key,
          message: `Value must be at least ${keyDef.minLength} characters`,
        });
      }
      if (keyDef.maxLength !== undefined && value.value.length > keyDef.maxLength) {
        errors.push({
          key: keyDef.key,
          message: `Value must be at most ${keyDef.maxLength} characters`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Compare Service
// ============================================================================

export async function compareConfigSets(
  setId1: string,
  setId2: string
): Promise<{
  onlyInFirst: Array<{ key: string; value: unknown }>;
  onlyInSecond: Array<{ key: string; value: unknown }>;
  different: Array<{ key: string; firstValue: unknown; secondValue: unknown }>;
  same: Array<{ key: string; value: unknown }>;
}> {
  const [resolved1, resolved2] = await Promise.all([
    resolveConfigValues(setId1, { includeSecrets: true, maskSecrets: true }),
    resolveConfigValues(setId2, { includeSecrets: true, maskSecrets: true }),
  ]);

  const map1 = new Map(resolved1.values.map(v => [v.key, v.value]));
  const map2 = new Map(resolved2.values.map(v => [v.key, v.value]));

  const onlyInFirst: Array<{ key: string; value: unknown }> = [];
  const onlyInSecond: Array<{ key: string; value: unknown }> = [];
  const different: Array<{ key: string; firstValue: unknown; secondValue: unknown }> = [];
  const same: Array<{ key: string; value: unknown }> = [];

  // Check keys in first set
  for (const [key, value] of map1) {
    if (!map2.has(key)) {
      onlyInFirst.push({ key, value });
    } else {
      const value2 = map2.get(key);
      if (JSON.stringify(value) !== JSON.stringify(value2)) {
        different.push({ key, firstValue: value, secondValue: value2 });
      } else {
        same.push({ key, value });
      }
    }
  }

  // Check keys only in second set
  for (const [key, value] of map2) {
    if (!map1.has(key)) {
      onlyInSecond.push({ key, value });
    }
  }

  return { onlyInFirst, onlyInSecond, different, same };
}

// ============================================================================
// CI/CD Integration Helpers
// ============================================================================

/**
 * Get a config set by name and optional environment
 */
export async function getConfigSetByName(
  organizationId: string,
  name: string,
  environment?: string
): Promise<ConfigSet | null> {
  const conditions = [
    eq(configSets.organizationId, organizationId),
    eq(configSets.name, name),
  ];

  if (environment) {
    conditions.push(eq(configSets.environment, environment));
  }

  const configSet = await db.query.configSets.findFirst({
    where: and(...conditions),
  });

  return configSet ?? null;
}

/**
 * Verify a config access token and return token info for authorization
 */
export async function verifyConfigAccessToken(token: string): Promise<{
  tokenId: string;
  configSetId: string;
  organizationId: string;
  permission: ConfigTokenPermission;
  allowedConfigSetIds: string[] | null;
} | null> {
  const validated = await validateConfigToken(token);
  if (!validated) return null;

  // Get the config set to find the organization ID
  const configSet = await getConfigSet(validated.configSetId);
  if (!configSet) return null;

  // Get organization ID either from config set or from the store
  let organizationId = configSet.organizationId;
  if (!organizationId) {
    const store = await getConfigStore(configSet.storeId);
    if (!store) return null;
    organizationId = store.organizationId;
  }

  return {
    tokenId: validated.id,
    configSetId: validated.configSetId,
    organizationId,
    permission: validated.permission,
    allowedConfigSetIds: validated.allowedSetIds,
  };
}

// Re-export resolver functions
export { resolveConfigValues, getResolvedValuesAsObject, getInheritanceChain };
