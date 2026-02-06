import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  configSets,
  configValues,
  type ConfigSet,
  type ConfigValue,
  type ConfigScope,
} from '../db/schema';
import {
  decryptConfigValue,
  deserializeValue,
  maskSecretValue,
} from './config-encryption.service';
import { logger } from '../utils/logger';

// ============================================================================
// Config Resolver Service
// Handles hierarchy resolution (repo → org → env) with inheritance
// ============================================================================

export interface ResolvedValue {
  key: string;
  value: unknown;
  valueType: string;
  isSecret: boolean;
  source: {
    setId: string;
    setName: string;
    environment?: string;
    scope: ConfigScope;
    hierarchyRank: number;
  };
  version: number;
  maskedValue?: string;
}

export interface ResolvedConfigSet {
  setId: string;
  setName: string;
  environment?: string;
  values: ResolvedValue[];
  inheritedFrom: Array<{
    setId: string;
    setName: string;
    scope: ConfigScope;
    valueCount: number;
  }>;
}

/**
 * Get the inheritance chain for a config set
 * Returns sets in order from most specific to least specific
 */
export async function getInheritanceChain(configSetId: string): Promise<ConfigSet[]> {
  const chain: ConfigSet[] = [];
  let currentSetId: string | null = configSetId;

  while (currentSetId) {
    const foundSet: ConfigSet | undefined = await db.query.configSets.findFirst({
      where: eq(configSets.id, currentSetId),
    });

    if (!foundSet) break;

    chain.push(foundSet);
    currentSetId = foundSet.parentSetId;
  }

  // Sort by hierarchy rank (higher rank = more specific = higher priority)
  chain.sort((a, b) => b.hierarchyRank - a.hierarchyRank);

  return chain;
}

/**
 * Get all values for a config set (without inheritance)
 */
export async function getConfigSetValues(
  configSetId: string,
  includeSecrets: boolean = false
): Promise<ConfigValue[]> {
  const values = await db.query.configValues.findMany({
    where: eq(configValues.configSetId, configSetId),
    orderBy: [configValues.key],
  });

  return values;
}

/**
 * Resolve all config values for a set with inheritance
 * Values from child sets override parent values
 */
export async function resolveConfigValues(
  configSetId: string,
  options: {
    includeSecrets?: boolean;
    maskSecrets?: boolean;
    decryptValues?: boolean;
  } = {}
): Promise<ResolvedConfigSet> {
  const {
    includeSecrets = false,
    maskSecrets = true,
    decryptValues = true,
  } = options;

  // Get the inheritance chain
  const chain = await getInheritanceChain(configSetId);

  if (chain.length === 0) {
    throw new Error('Config set not found');
  }

  const targetSet = chain[0];

  // Collect all values from the chain
  // Later values (higher priority) override earlier ones
  const valueMap = new Map<string, ResolvedValue>();
  const inheritedFrom: ResolvedConfigSet['inheritedFrom'] = [];

  // Process from least specific to most specific (reverse order)
  for (let i = chain.length - 1; i >= 0; i--) {
    const set = chain[i];
    const values = await getConfigSetValues(set.id);

    let valueCount = 0;

    for (const value of values) {
      // Skip secrets if not included
      if (value.isSecret && !includeSecrets) {
        continue;
      }

      let resolvedValue: unknown;
      let maskedValue: string | undefined;

      if (decryptValues) {
        try {
          const decrypted = decryptConfigValue(
            value.encryptedValue,
            value.encryptionIv,
            {
              configSetId: value.configSetId,
            }
          );
          resolvedValue = deserializeValue(decrypted, value.valueType);

          if (value.isSecret && maskSecrets) {
            maskedValue = maskSecretValue(String(resolvedValue));
          }
        } catch (error) {
          logger.error('config', 'Failed to decrypt value', error as Error);
          resolvedValue = '[DECRYPTION_ERROR]';
        }
      } else {
        resolvedValue = '[ENCRYPTED]';
      }

      valueMap.set(value.key, {
        key: value.key,
        value: value.isSecret && maskSecrets ? maskedValue : resolvedValue,
        valueType: value.valueType,
        isSecret: value.isSecret,
        source: {
          setId: set.id,
          setName: set.name,
          environment: set.environment ?? undefined,
          scope: set.scope,
          hierarchyRank: set.hierarchyRank,
        },
        version: value.version,
        maskedValue,
      });

      valueCount++;
    }

    if (i > 0) {
      // Don't include the target set in inheritedFrom
      inheritedFrom.push({
        setId: set.id,
        setName: set.name,
        scope: set.scope,
        valueCount,
      });
    }
  }

  return {
    setId: targetSet.id,
    setName: targetSet.name,
    environment: targetSet.environment ?? undefined,
    values: Array.from(valueMap.values()).sort((a, b) =>
      a.key.localeCompare(b.key)
    ),
    inheritedFrom: inheritedFrom.reverse(), // Most specific first
  };
}

/**
 * Get resolved values as a flat key-value object
 * Suitable for injection into CI/CD environments
 */
export async function getResolvedValuesAsObject(
  configSetId: string,
  options: {
    includeSecrets?: boolean;
    keyPrefix?: string;
    keyTransform?: 'uppercase' | 'lowercase' | 'none';
  } = {}
): Promise<Record<string, string>> {
  const {
    includeSecrets = true,
    keyPrefix = '',
    keyTransform = 'none',
  } = options;

  const resolved = await resolveConfigValues(configSetId, {
    includeSecrets,
    maskSecrets: false,
    decryptValues: true,
  });

  const result: Record<string, string> = {};

  for (const value of resolved.values) {
    let key = value.key;

    // Apply key transformation
    if (keyTransform === 'uppercase') {
      key = key.toUpperCase();
    } else if (keyTransform === 'lowercase') {
      key = key.toLowerCase();
    }

    // Apply prefix
    if (keyPrefix) {
      key = `${keyPrefix}${key}`;
    }

    // Convert value to string
    let stringValue: string;
    if (typeof value.value === 'object') {
      stringValue = JSON.stringify(value.value);
    } else {
      stringValue = String(value.value);
    }

    result[key] = stringValue;
  }

  return result;
}

/**
 * Check which values would be overridden by a parent set
 */
export async function getOverrideAnalysis(
  configSetId: string
): Promise<{
  overrides: Array<{
    key: string;
    localValue: unknown;
    parentValue: unknown;
    parentSetName: string;
  }>;
  inherited: Array<{
    key: string;
    value: unknown;
    sourceSetName: string;
  }>;
}> {
  const chain = await getInheritanceChain(configSetId);

  if (chain.length < 2) {
    return { overrides: [], inherited: [] };
  }

  const targetSet = chain[0];
  const localValues = await getConfigSetValues(targetSet.id);
  const localValueMap = new Map<string, ConfigValue>();

  for (const value of localValues) {
    localValueMap.set(value.key, value);
  }

  const overrides: Array<{
    key: string;
    localValue: unknown;
    parentValue: unknown;
    parentSetName: string;
  }> = [];

  const inherited: Array<{
    key: string;
    value: unknown;
    sourceSetName: string;
  }> = [];

  // Check parent sets
  for (let i = 1; i < chain.length; i++) {
    const parentSet = chain[i];
    const parentValues = await getConfigSetValues(parentSet.id);

    for (const parentValue of parentValues) {
      const localValue = localValueMap.get(parentValue.key);

      if (localValue) {
        // This key is overridden locally
        try {
          const decryptedLocal = decryptConfigValue(
            localValue.encryptedValue,
            localValue.encryptionIv,
            { configSetId: localValue.configSetId }
          );
          const decryptedParent = decryptConfigValue(
            parentValue.encryptedValue,
            parentValue.encryptionIv,
            { configSetId: parentValue.configSetId }
          );

          overrides.push({
            key: parentValue.key,
            localValue: deserializeValue(decryptedLocal, localValue.valueType),
            parentValue: deserializeValue(decryptedParent, parentValue.valueType),
            parentSetName: parentSet.name,
          });
        } catch {
          // Skip if decryption fails
        }
      } else {
        // This key is inherited
        try {
          const decrypted = decryptConfigValue(
            parentValue.encryptedValue,
            parentValue.encryptionIv,
            { configSetId: parentValue.configSetId }
          );

          inherited.push({
            key: parentValue.key,
            value: deserializeValue(decrypted, parentValue.valueType),
            sourceSetName: parentSet.name,
          });
        } catch {
          // Skip if decryption fails
        }
      }
    }
  }

  return { overrides, inherited };
}

/**
 * Find all config sets that use a specific key
 */
export async function findConfigSetsWithKey(
  key: string,
  organizationId: string
): Promise<Array<{
  setId: string;
  setName: string;
  environment?: string;
  scope: ConfigScope;
  value: unknown;
  isSecret: boolean;
}>> {
  // Get all config sets for the organization
  const sets = await db.query.configSets.findMany({
    where: eq(configSets.organizationId, organizationId),
  });

  const results: Array<{
    setId: string;
    setName: string;
    environment?: string;
    scope: ConfigScope;
    value: unknown;
    isSecret: boolean;
  }> = [];

  for (const set of sets) {
    const value = await db.query.configValues.findFirst({
      where: and(
        eq(configValues.configSetId, set.id),
        eq(configValues.key, key)
      ),
    });

    if (value) {
      try {
        const decrypted = decryptConfigValue(
          value.encryptedValue,
          value.encryptionIv,
          { configSetId: value.configSetId }
        );

        results.push({
          setId: set.id,
          setName: set.name,
          environment: set.environment ?? undefined,
          scope: set.scope,
          value: value.isSecret
            ? maskSecretValue(decrypted)
            : deserializeValue(decrypted, value.valueType),
          isSecret: value.isSecret,
        });
      } catch {
        // Skip if decryption fails
      }
    }
  }

  return results;
}
