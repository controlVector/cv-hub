/**
 * Feature Flags Service
 * Handles CRUD operations for feature flags, segments, and evaluation
 */

import { eq, and, desc, like, inArray, sql, isNull } from 'drizzle-orm';
import { db } from '../db';
import {
  featureFlags,
  featureFlagEnvironments,
  featureFlagSegments,
  featureFlagHistory,
  featureFlagApiKeys,
  featureFlagAnalytics,
  type FeatureFlag,
  type NewFeatureFlag,
  type FeatureFlagEnvironment,
  type NewFeatureFlagEnvironment,
  type FeatureFlagSegment,
  type NewFeatureFlagSegment,
  type FeatureFlagApiKey,
  type FlagRule,
  type SegmentRule,
  type FlagValueType,
} from '../db/schema';
import { evaluateFlag, type EvaluationInput } from './feature-flags-evaluator';
import { generateSecureToken, hashToken } from '../utils/crypto';
import { logger } from '../utils/logger';
import type {
  EvaluationContext,
  EvaluationResult,
  BulkEvaluationResult,
} from '@cv-hub/shared';

// ============================================================================
// Flag CRUD Operations
// ============================================================================

export interface CreateFlagInput {
  organizationId: string;
  key: string;
  name: string;
  description?: string;
  valueType?: FlagValueType;
  defaultValue: unknown;
  tags?: string[];
  createdBy?: string;
}

export async function createFlag(input: CreateFlagInput): Promise<FeatureFlag> {
  // Check for duplicate key
  const existing = await db.query.featureFlags.findFirst({
    where: and(
      eq(featureFlags.organizationId, input.organizationId),
      eq(featureFlags.key, input.key)
    ),
  });

  if (existing) {
    throw new Error(`Flag with key "${input.key}" already exists`);
  }

  const [flag] = await db.insert(featureFlags).values({
    organizationId: input.organizationId,
    key: input.key,
    name: input.name,
    description: input.description,
    valueType: input.valueType || 'boolean',
    defaultValue: input.defaultValue,
    tags: input.tags || [],
    createdBy: input.createdBy,
  }).returning();

  // Record creation in history
  await recordFlagHistory({
    flagId: flag.id,
    changeType: 'created',
    newValue: { key: flag.key, name: flag.name, defaultValue: flag.defaultValue },
    changedBy: input.createdBy,
  });

  logger.info('general', 'Feature flag created', {
    flagId: flag.id,
    key: flag.key,
    organizationId: input.organizationId,
  });

  return flag;
}

export async function getFlag(
  organizationId: string,
  key: string
): Promise<FeatureFlag | null> {
  const flag = await db.query.featureFlags.findFirst({
    where: and(
      eq(featureFlags.organizationId, organizationId),
      eq(featureFlags.key, key)
    ),
  });

  return flag ?? null;
}

export async function getFlagById(id: string): Promise<FeatureFlag | null> {
  const flag = await db.query.featureFlags.findFirst({
    where: eq(featureFlags.id, id),
  });

  return flag ?? null;
}

export interface ListFlagsInput {
  organizationId: string;
  search?: string;
  tags?: string[];
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListFlagsResult {
  flags: (FeatureFlag & { environments: FeatureFlagEnvironment[] })[];
  total: number;
}

export async function listFlags(input: ListFlagsInput): Promise<ListFlagsResult> {
  const { organizationId, search, tags, includeArchived, limit = 50, offset = 0 } = input;

  const conditions = [eq(featureFlags.organizationId, organizationId)];

  if (!includeArchived) {
    conditions.push(eq(featureFlags.isArchived, false));
  }

  if (search) {
    conditions.push(
      sql`(${featureFlags.key} ILIKE ${'%' + search + '%'} OR ${featureFlags.name} ILIKE ${'%' + search + '%'})`
    );
  }

  if (tags && tags.length > 0) {
    conditions.push(sql`${featureFlags.tags} ?| ${sql.raw(`ARRAY[${tags.map(t => `'${t}'`).join(',')}]`)}`);
  }

  const [flags, countResult] = await Promise.all([
    db.query.featureFlags.findMany({
      where: and(...conditions),
      with: {
        environments: true,
      },
      orderBy: [desc(featureFlags.createdAt)],
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)` })
      .from(featureFlags)
      .where(and(...conditions)),
  ]);

  return {
    flags: flags as (FeatureFlag & { environments: FeatureFlagEnvironment[] })[],
    total: Number(countResult[0]?.count || 0),
  };
}

export interface UpdateFlagInput {
  name?: string;
  description?: string;
  defaultValue?: unknown;
  tags?: string[];
  updatedBy?: string;
}

export async function updateFlag(
  id: string,
  input: UpdateFlagInput
): Promise<FeatureFlag | null> {
  const existing = await getFlagById(id);
  if (!existing) return null;

  const updateData: Partial<NewFeatureFlag> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.defaultValue !== undefined) updateData.defaultValue = input.defaultValue;
  if (input.tags !== undefined) updateData.tags = input.tags;

  const [updated] = await db.update(featureFlags)
    .set(updateData)
    .where(eq(featureFlags.id, id))
    .returning();

  if (updated) {
    await recordFlagHistory({
      flagId: id,
      changeType: 'updated',
      previousValue: {
        name: existing.name,
        description: existing.description,
        defaultValue: existing.defaultValue,
        tags: existing.tags,
      },
      newValue: {
        name: updated.name,
        description: updated.description,
        defaultValue: updated.defaultValue,
        tags: updated.tags,
      },
      changedBy: input.updatedBy,
    });
  }

  return updated ?? null;
}

export async function archiveFlag(
  id: string,
  archivedBy?: string
): Promise<FeatureFlag | null> {
  const [updated] = await db.update(featureFlags)
    .set({
      isArchived: true,
      archivedAt: new Date(),
      archivedBy,
      updatedAt: new Date(),
    })
    .where(eq(featureFlags.id, id))
    .returning();

  if (updated) {
    await recordFlagHistory({
      flagId: id,
      changeType: 'archived',
      changedBy: archivedBy,
    });

    logger.info('general', 'Feature flag archived', { flagId: id });
  }

  return updated ?? null;
}

export async function restoreFlag(
  id: string,
  restoredBy?: string
): Promise<FeatureFlag | null> {
  const [updated] = await db.update(featureFlags)
    .set({
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(featureFlags.id, id))
    .returning();

  if (updated) {
    await recordFlagHistory({
      flagId: id,
      changeType: 'restored',
      changedBy: restoredBy,
    });

    logger.info('general', 'Feature flag restored', { flagId: id });
  }

  return updated ?? null;
}

// ============================================================================
// Environment Configuration
// ============================================================================

export async function getFlagEnvironment(
  flagId: string,
  environment: string
): Promise<FeatureFlagEnvironment | null> {
  const env = await db.query.featureFlagEnvironments.findFirst({
    where: and(
      eq(featureFlagEnvironments.flagId, flagId),
      eq(featureFlagEnvironments.environment, environment)
    ),
  });

  return env ?? null;
}

export async function listFlagEnvironments(
  flagId: string
): Promise<FeatureFlagEnvironment[]> {
  return db.query.featureFlagEnvironments.findMany({
    where: eq(featureFlagEnvironments.flagId, flagId),
    orderBy: [featureFlagEnvironments.environment],
  });
}

export interface UpdateEnvironmentInput {
  isEnabled?: boolean;
  overrideValue?: unknown;
  rolloutPercentage?: number | null;
  updatedBy?: string;
}

export async function updateFlagEnvironment(
  flagId: string,
  environment: string,
  input: UpdateEnvironmentInput
): Promise<FeatureFlagEnvironment> {
  const existing = await getFlagEnvironment(flagId, environment);

  const updateData: Partial<NewFeatureFlagEnvironment> = {
    updatedAt: new Date(),
    updatedBy: input.updatedBy,
  };

  if (input.isEnabled !== undefined) updateData.isEnabled = input.isEnabled;
  if (input.overrideValue !== undefined) updateData.overrideValue = input.overrideValue;
  if (input.rolloutPercentage !== undefined) {
    updateData.rolloutPercentage = input.rolloutPercentage;
  }

  if (existing) {
    const [updated] = await db.update(featureFlagEnvironments)
      .set(updateData)
      .where(eq(featureFlagEnvironments.id, existing.id))
      .returning();

    await recordFlagHistory({
      flagId,
      environment,
      changeType: 'environment_updated',
      previousValue: {
        isEnabled: existing.isEnabled,
        overrideValue: existing.overrideValue,
        rolloutPercentage: existing.rolloutPercentage,
      },
      newValue: {
        isEnabled: updated.isEnabled,
        overrideValue: updated.overrideValue,
        rolloutPercentage: updated.rolloutPercentage,
      },
      changedBy: input.updatedBy,
    });

    return updated;
  }

  // Create new environment config
  const [created] = await db.insert(featureFlagEnvironments).values({
    flagId,
    environment,
    isEnabled: input.isEnabled ?? false,
    overrideValue: input.overrideValue,
    rolloutPercentage: input.rolloutPercentage,
    rules: [],
    updatedBy: input.updatedBy,
  }).returning();

  await recordFlagHistory({
    flagId,
    environment,
    changeType: 'environment_created',
    newValue: {
      isEnabled: created.isEnabled,
      overrideValue: created.overrideValue,
      rolloutPercentage: created.rolloutPercentage,
    },
    changedBy: input.updatedBy,
  });

  return created;
}

// ============================================================================
// Targeting Rules
// ============================================================================

export interface AddRuleInput {
  conditions: FlagRule['conditions'];
  segmentId?: string;
  percentage?: number;
  serveValue: unknown;
  priority?: number;
  updatedBy?: string;
}

export async function addTargetingRule(
  flagId: string,
  environment: string,
  input: AddRuleInput
): Promise<FeatureFlagEnvironment> {
  let envConfig = await getFlagEnvironment(flagId, environment);

  if (!envConfig) {
    // Create environment config first
    envConfig = await updateFlagEnvironment(flagId, environment, {
      isEnabled: false,
      updatedBy: input.updatedBy,
    });
  }

  const rules = envConfig.rules as FlagRule[] || [];

  const newRule: FlagRule = {
    id: crypto.randomUUID(),
    conditions: input.conditions,
    segmentId: input.segmentId,
    percentage: input.percentage,
    serveValue: input.serveValue,
    priority: input.priority ?? rules.length,
  };

  rules.push(newRule);

  const [updated] = await db.update(featureFlagEnvironments)
    .set({
      rules,
      updatedAt: new Date(),
      updatedBy: input.updatedBy,
    })
    .where(eq(featureFlagEnvironments.id, envConfig.id))
    .returning();

  await recordFlagHistory({
    flagId,
    environment,
    changeType: 'rule_added',
    newValue: newRule,
    changedBy: input.updatedBy,
  });

  return updated;
}

export async function updateTargetingRule(
  flagId: string,
  environment: string,
  ruleId: string,
  input: Partial<AddRuleInput>
): Promise<FeatureFlagEnvironment | null> {
  const envConfig = await getFlagEnvironment(flagId, environment);
  if (!envConfig) return null;

  const rules = (envConfig.rules as FlagRule[] || []).map((rule) => {
    if (rule.id !== ruleId) return rule;

    return {
      ...rule,
      conditions: input.conditions ?? rule.conditions,
      segmentId: input.segmentId ?? rule.segmentId,
      percentage: input.percentage ?? rule.percentage,
      serveValue: input.serveValue ?? rule.serveValue,
      priority: input.priority ?? rule.priority,
    };
  });

  const [updated] = await db.update(featureFlagEnvironments)
    .set({
      rules,
      updatedAt: new Date(),
      updatedBy: input.updatedBy,
    })
    .where(eq(featureFlagEnvironments.id, envConfig.id))
    .returning();

  await recordFlagHistory({
    flagId,
    environment,
    changeType: 'rule_updated',
    changedBy: input.updatedBy,
  });

  return updated;
}

export async function deleteTargetingRule(
  flagId: string,
  environment: string,
  ruleId: string,
  deletedBy?: string
): Promise<FeatureFlagEnvironment | null> {
  const envConfig = await getFlagEnvironment(flagId, environment);
  if (!envConfig) return null;

  const rules = (envConfig.rules as FlagRule[] || []).filter((r) => r.id !== ruleId);

  const [updated] = await db.update(featureFlagEnvironments)
    .set({
      rules,
      updatedAt: new Date(),
      updatedBy: deletedBy,
    })
    .where(eq(featureFlagEnvironments.id, envConfig.id))
    .returning();

  await recordFlagHistory({
    flagId,
    environment,
    changeType: 'rule_deleted',
    previousValue: { ruleId },
    changedBy: deletedBy,
  });

  return updated;
}

// ============================================================================
// Segments
// ============================================================================

export interface CreateSegmentInput {
  organizationId: string;
  key: string;
  name: string;
  description?: string;
  rules: SegmentRule[];
  matchMode?: 'all' | 'any';
  createdBy?: string;
}

export async function createSegment(input: CreateSegmentInput): Promise<FeatureFlagSegment> {
  const existing = await db.query.featureFlagSegments.findFirst({
    where: and(
      eq(featureFlagSegments.organizationId, input.organizationId),
      eq(featureFlagSegments.key, input.key)
    ),
  });

  if (existing) {
    throw new Error(`Segment with key "${input.key}" already exists`);
  }

  const [segment] = await db.insert(featureFlagSegments).values({
    organizationId: input.organizationId,
    key: input.key,
    name: input.name,
    description: input.description,
    rules: input.rules,
    matchMode: input.matchMode || 'all',
    createdBy: input.createdBy,
  }).returning();

  logger.info('general', 'Feature flag segment created', {
    segmentId: segment.id,
    key: segment.key,
  });

  return segment;
}

export async function getSegment(
  organizationId: string,
  key: string
): Promise<FeatureFlagSegment | null> {
  const segment = await db.query.featureFlagSegments.findFirst({
    where: and(
      eq(featureFlagSegments.organizationId, organizationId),
      eq(featureFlagSegments.key, key)
    ),
  });

  return segment ?? null;
}

export async function getSegmentById(id: string): Promise<FeatureFlagSegment | null> {
  const segment = await db.query.featureFlagSegments.findFirst({
    where: eq(featureFlagSegments.id, id),
  });

  return segment ?? null;
}

export async function listSegments(organizationId: string): Promise<FeatureFlagSegment[]> {
  return db.query.featureFlagSegments.findMany({
    where: eq(featureFlagSegments.organizationId, organizationId),
    orderBy: [featureFlagSegments.name],
  });
}

export async function updateSegment(
  id: string,
  input: Partial<CreateSegmentInput>
): Promise<FeatureFlagSegment | null> {
  const updateData: Partial<NewFeatureFlagSegment> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.rules !== undefined) updateData.rules = input.rules;
  if (input.matchMode !== undefined) updateData.matchMode = input.matchMode;

  const [updated] = await db.update(featureFlagSegments)
    .set(updateData)
    .where(eq(featureFlagSegments.id, id))
    .returning();

  return updated ?? null;
}

export async function deleteSegment(id: string): Promise<boolean> {
  const result = await db.delete(featureFlagSegments)
    .where(eq(featureFlagSegments.id, id));

  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Evaluation
// ============================================================================

export async function evaluate(
  organizationId: string,
  flagKey: string,
  environment: string,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const flag = await getFlag(organizationId, flagKey);

  if (!flag) {
    return {
      key: flagKey,
      value: null,
      valueType: 'boolean',
      isDefaultValue: true,
      reason: 'FLAG_NOT_FOUND',
    };
  }

  const envConfig = await getFlagEnvironment(flag.id, environment);
  const segments = await loadSegmentsForOrg(organizationId);

  const input: EvaluationInput = {
    flagKey: flag.key,
    flagId: flag.id,
    valueType: flag.valueType,
    defaultValue: flag.defaultValue,
    isArchived: flag.isArchived,
    environment: envConfig ? {
      isEnabled: envConfig.isEnabled,
      overrideValue: envConfig.overrideValue ?? undefined,
      rolloutPercentage: envConfig.rolloutPercentage ?? undefined,
      rules: (envConfig.rules as FlagRule[]) || [],
    } : undefined,
    segments,
    context,
  };

  const result = evaluateFlag(input);

  // Track analytics (fire and forget)
  trackEvaluation(flag.id, environment, result).catch(() => {});

  return result;
}

export async function evaluateBulk(
  organizationId: string,
  environment: string,
  context: EvaluationContext,
  flagKeys?: string[]
): Promise<BulkEvaluationResult> {
  // Get all flags for org (or specific keys)
  const conditions = [
    eq(featureFlags.organizationId, organizationId),
    eq(featureFlags.isArchived, false),
  ];

  if (flagKeys && flagKeys.length > 0) {
    conditions.push(inArray(featureFlags.key, flagKeys));
  }

  const flags = await db.query.featureFlags.findMany({
    where: and(...conditions),
    with: {
      environments: {
        where: eq(featureFlagEnvironments.environment, environment),
      },
    },
  });

  const segments = await loadSegmentsForOrg(organizationId);
  const results: Record<string, EvaluationResult> = {};

  for (const flag of flags) {
    const envConfig = flag.environments?.[0];

    const input: EvaluationInput = {
      flagKey: flag.key,
      flagId: flag.id,
      valueType: flag.valueType,
      defaultValue: flag.defaultValue,
      isArchived: flag.isArchived,
      environment: envConfig ? {
        isEnabled: envConfig.isEnabled,
        overrideValue: envConfig.overrideValue ?? undefined,
        rolloutPercentage: envConfig.rolloutPercentage ?? undefined,
        rules: (envConfig.rules as FlagRule[]) || [],
      } : undefined,
      segments,
      context,
    };

    results[flag.key] = evaluateFlag(input);
  }

  return {
    flags: results,
    evaluatedAt: new Date().toISOString(),
  };
}

async function loadSegmentsForOrg(
  organizationId: string
): Promise<Map<string, { rules: SegmentRule[]; matchMode: 'all' | 'any' }>> {
  const segments = await listSegments(organizationId);
  const map = new Map<string, { rules: SegmentRule[]; matchMode: 'all' | 'any' }>();

  for (const segment of segments) {
    map.set(segment.id, {
      rules: segment.rules as SegmentRule[],
      matchMode: segment.matchMode as 'all' | 'any',
    });
  }

  return map;
}

// ============================================================================
// API Keys
// ============================================================================

export interface CreateApiKeyInput {
  organizationId: string;
  name: string;
  description?: string;
  environment: string;
  canWrite?: boolean;
  expiresAt?: Date;
  createdBy?: string;
}

export async function createApiKey(
  input: CreateApiKeyInput
): Promise<{ apiKey: FeatureFlagApiKey; plainKey: string }> {
  const plainKey = `ff_${generateSecureToken(32)}`;
  const keyPrefix = plainKey.substring(0, 7);
  const keyHash = hashToken(plainKey);

  const [apiKey] = await db.insert(featureFlagApiKeys).values({
    organizationId: input.organizationId,
    name: input.name,
    description: input.description,
    keyPrefix,
    keyHash,
    environment: input.environment,
    canRead: true,
    canWrite: input.canWrite ?? false,
    expiresAt: input.expiresAt,
    createdBy: input.createdBy,
  }).returning();

  logger.info('general', 'Feature flag API key created', {
    keyId: apiKey.id,
    environment: input.environment,
  });

  return { apiKey, plainKey };
}

export async function validateApiKey(key: string): Promise<FeatureFlagApiKey | null> {
  const keyHash = hashToken(key);

  const apiKey = await db.query.featureFlagApiKeys.findFirst({
    where: and(
      eq(featureFlagApiKeys.keyHash, keyHash),
      eq(featureFlagApiKeys.isActive, true)
    ),
  });

  if (!apiKey) return null;

  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null;
  }

  // Update usage
  await db.update(featureFlagApiKeys)
    .set({
      lastUsedAt: new Date(),
      usageCount: apiKey.usageCount + 1,
    })
    .where(eq(featureFlagApiKeys.id, apiKey.id));

  return apiKey;
}

export async function listApiKeys(organizationId: string): Promise<FeatureFlagApiKey[]> {
  return db.query.featureFlagApiKeys.findMany({
    where: eq(featureFlagApiKeys.organizationId, organizationId),
    orderBy: [desc(featureFlagApiKeys.createdAt)],
  });
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const result = await db.update(featureFlagApiKeys)
    .set({ isActive: false })
    .where(eq(featureFlagApiKeys.id, id));

  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// History
// ============================================================================

interface RecordHistoryInput {
  flagId: string;
  environment?: string;
  changeType: string;
  previousValue?: unknown;
  newValue?: unknown;
  changeDescription?: string;
  changedBy?: string;
  ipAddress?: string;
  userAgent?: string;
}

async function recordFlagHistory(input: RecordHistoryInput): Promise<void> {
  await db.insert(featureFlagHistory).values({
    flagId: input.flagId,
    environment: input.environment,
    changeType: input.changeType,
    previousValue: input.previousValue,
    newValue: input.newValue,
    changeDescription: input.changeDescription,
    changedBy: input.changedBy,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
}

export async function getFlagHistory(
  flagId: string,
  limit = 50,
  offset = 0
): Promise<{ history: typeof featureFlagHistory.$inferSelect[]; total: number }> {
  const [history, countResult] = await Promise.all([
    db.query.featureFlagHistory.findMany({
      where: eq(featureFlagHistory.flagId, flagId),
      orderBy: [desc(featureFlagHistory.createdAt)],
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)` })
      .from(featureFlagHistory)
      .where(eq(featureFlagHistory.flagId, flagId)),
  ]);

  return {
    history,
    total: Number(countResult[0]?.count || 0),
  };
}

// ============================================================================
// Analytics
// ============================================================================

async function trackEvaluation(
  flagId: string,
  environment: string,
  result: EvaluationResult
): Promise<void> {
  // Round to hour for time bucket
  const now = new Date();
  now.setMinutes(0, 0, 0);

  try {
    // Upsert analytics record
    await db.execute(sql`
      INSERT INTO feature_flag_analytics (flag_id, environment, time_bucket, evaluation_count, true_count, false_count, unique_users)
      VALUES (${flagId}, ${environment}, ${now}, 1,
        ${result.value === true ? 1 : 0},
        ${result.value === false ? 1 : 0},
        1)
      ON CONFLICT (flag_id, environment, time_bucket)
      DO UPDATE SET
        evaluation_count = feature_flag_analytics.evaluation_count + 1,
        true_count = feature_flag_analytics.true_count + ${result.value === true ? 1 : 0},
        false_count = feature_flag_analytics.false_count + ${result.value === false ? 1 : 0}
    `);
  } catch (error) {
    // Don't fail evaluation on analytics error
    logger.debug('general', 'Failed to track flag evaluation', { error });
  }
}

export async function getFlagAnalytics(
  flagId: string,
  environment: string,
  startTime: Date,
  endTime: Date
): Promise<typeof featureFlagAnalytics.$inferSelect[]> {
  return db.query.featureFlagAnalytics.findMany({
    where: and(
      eq(featureFlagAnalytics.flagId, flagId),
      eq(featureFlagAnalytics.environment, environment),
      sql`${featureFlagAnalytics.timeBucket} >= ${startTime}`,
      sql`${featureFlagAnalytics.timeBucket} <= ${endTime}`
    ),
    orderBy: [featureFlagAnalytics.timeBucket],
  });
}
