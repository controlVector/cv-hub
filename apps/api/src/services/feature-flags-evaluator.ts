/**
 * Feature Flags Evaluator
 * Core evaluation engine for feature flags
 */

import { createHash } from 'crypto';
import type {
  EvaluationContext,
  EvaluationResult,
  EvaluationReason,
  FlagRule,
  FlagRuleCondition,
  SegmentRule,
  FlagValueType,
} from '@cv-hub/shared';

// ============================================================================
// Evaluation Engine
// ============================================================================

export interface EvaluationInput {
  flagKey: string;
  flagId: string;
  valueType: FlagValueType;
  defaultValue: unknown;
  isArchived: boolean;
  environment?: {
    isEnabled: boolean;
    overrideValue?: unknown;
    rolloutPercentage?: number;
    rules: FlagRule[];
  };
  segments: Map<string, { rules: SegmentRule[]; matchMode: 'all' | 'any' }>;
  context: EvaluationContext;
}

/**
 * Evaluate a feature flag for a given context
 */
export function evaluateFlag(input: EvaluationInput): EvaluationResult {
  const {
    flagKey,
    valueType,
    defaultValue,
    isArchived,
    environment,
    segments,
    context,
  } = input;

  // Check if flag is archived
  if (isArchived) {
    return {
      key: flagKey,
      value: defaultValue,
      valueType,
      isDefaultValue: true,
      reason: 'FLAG_ARCHIVED',
    };
  }

  // No environment config = use default
  if (!environment) {
    return {
      key: flagKey,
      value: defaultValue,
      valueType,
      isDefaultValue: true,
      reason: 'DEFAULT_VALUE',
    };
  }

  // Environment disabled = use default
  if (!environment.isEnabled) {
    return {
      key: flagKey,
      value: defaultValue,
      valueType,
      isDefaultValue: true,
      reason: 'ENVIRONMENT_DISABLED',
    };
  }

  // Evaluate targeting rules (in priority order)
  const sortedRules = [...environment.rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    const ruleMatch = evaluateRule(rule, context, segments);

    if (ruleMatch.matched) {
      // Check percentage rollout for this rule
      if (rule.percentage !== undefined && rule.percentage < 100) {
        const inRollout = isInPercentageRollout(
          flagKey,
          context.userId || '',
          rule.percentage
        );
        if (!inRollout) {
          continue; // Try next rule
        }
      }

      return {
        key: flagKey,
        value: rule.serveValue,
        valueType,
        isDefaultValue: false,
        matchedRuleId: rule.id,
        matchedSegmentId: ruleMatch.matchedSegmentId,
        reason: ruleMatch.matchedSegmentId ? 'SEGMENT_MATCH' : 'RULE_MATCH',
      };
    }
  }

  // Check global rollout percentage
  if (environment.rolloutPercentage !== undefined && environment.rolloutPercentage < 100) {
    const inRollout = isInPercentageRollout(
      flagKey,
      context.userId || '',
      environment.rolloutPercentage
    );

    if (!inRollout) {
      return {
        key: flagKey,
        value: defaultValue,
        valueType,
        isDefaultValue: true,
        reason: 'PERCENTAGE_ROLLOUT',
      };
    }
  }

  // Use environment override or default
  const value = environment.overrideValue !== undefined
    ? environment.overrideValue
    : defaultValue;

  return {
    key: flagKey,
    value,
    valueType,
    isDefaultValue: environment.overrideValue === undefined,
    reason: 'FALLTHROUGH',
  };
}

// ============================================================================
// Rule Evaluation
// ============================================================================

interface RuleMatchResult {
  matched: boolean;
  matchedSegmentId?: string;
}

function evaluateRule(
  rule: FlagRule,
  context: EvaluationContext,
  segments: Map<string, { rules: SegmentRule[]; matchMode: 'all' | 'any' }>
): RuleMatchResult {
  // If rule has segment, check segment membership first
  if (rule.segmentId) {
    const segment = segments.get(rule.segmentId);
    if (!segment) {
      return { matched: false };
    }

    const segmentMatch = evaluateSegment(segment.rules, segment.matchMode, context);
    if (!segmentMatch) {
      return { matched: false };
    }

    // If no additional conditions, segment match is sufficient
    if (rule.conditions.length === 0) {
      return { matched: true, matchedSegmentId: rule.segmentId };
    }
  }

  // Evaluate conditions (all must match = AND logic)
  for (const condition of rule.conditions) {
    if (!evaluateCondition(condition, context)) {
      return { matched: false };
    }
  }

  return {
    matched: rule.conditions.length > 0 || rule.segmentId !== undefined,
    matchedSegmentId: rule.segmentId,
  };
}

function evaluateSegment(
  rules: SegmentRule[],
  matchMode: 'all' | 'any',
  context: EvaluationContext
): boolean {
  if (rules.length === 0) {
    return false;
  }

  if (matchMode === 'all') {
    // AND: all rules must match
    return rules.every((rule) => evaluateCondition(rule, context));
  } else {
    // OR: any rule must match
    return rules.some((rule) => evaluateCondition(rule, context));
  }
}

function evaluateCondition(
  condition: FlagRuleCondition | SegmentRule,
  context: EvaluationContext
): boolean {
  const { attribute, operator, values } = condition;
  const contextValue = getContextAttribute(context, attribute);

  switch (operator) {
    case 'eq':
      return values.some((v) => equals(contextValue, v));

    case 'neq':
      return values.every((v) => !equals(contextValue, v));

    case 'in':
      return values.some((v) => equals(contextValue, v));

    case 'notIn':
      return values.every((v) => !equals(contextValue, v));

    case 'contains':
      return (
        typeof contextValue === 'string' &&
        values.some((v) => contextValue.includes(String(v)))
      );

    case 'startsWith':
      return (
        typeof contextValue === 'string' &&
        values.some((v) => contextValue.startsWith(String(v)))
      );

    case 'endsWith':
      return (
        typeof contextValue === 'string' &&
        values.some((v) => contextValue.endsWith(String(v)))
      );

    case 'matches':
      if (typeof contextValue !== 'string') return false;
      return values.some((v) => {
        try {
          const regex = new RegExp(String(v));
          return regex.test(contextValue);
        } catch {
          return false;
        }
      });

    case 'gt':
      return (
        typeof contextValue === 'number' &&
        values.some((v) => contextValue > Number(v))
      );

    case 'gte':
      return (
        typeof contextValue === 'number' &&
        values.some((v) => contextValue >= Number(v))
      );

    case 'lt':
      return (
        typeof contextValue === 'number' &&
        values.some((v) => contextValue < Number(v))
      );

    case 'lte':
      return (
        typeof contextValue === 'number' &&
        values.some((v) => contextValue <= Number(v))
      );

    case 'exists':
      return contextValue !== undefined && contextValue !== null;

    case 'notExists':
      return contextValue === undefined || contextValue === null;

    case 'semverGt':
      return (
        typeof contextValue === 'string' &&
        values.some((v) => compareSemver(contextValue, String(v)) > 0)
      );

    case 'semverGte':
      return (
        typeof contextValue === 'string' &&
        values.some((v) => compareSemver(contextValue, String(v)) >= 0)
      );

    case 'semverLt':
      return (
        typeof contextValue === 'string' &&
        values.some((v) => compareSemver(contextValue, String(v)) < 0)
      );

    case 'semverLte':
      return (
        typeof contextValue === 'string' &&
        values.some((v) => compareSemver(contextValue, String(v)) <= 0)
      );

    case 'semverEq':
      return (
        typeof contextValue === 'string' &&
        values.some((v) => compareSemver(contextValue, String(v)) === 0)
      );

    default:
      return false;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getContextAttribute(context: EvaluationContext, attribute: string): unknown {
  // Support nested attributes with dot notation
  const parts = attribute.split('.');
  let value: unknown = context;

  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === 'object') {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return value;
}

function equals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) {
    // Try coercion for string/number comparison
    if (typeof a === 'string' && typeof b === 'number') {
      return a === String(b);
    }
    if (typeof a === 'number' && typeof b === 'string') {
      return String(a) === b;
    }
  }
  return false;
}

/**
 * Deterministic percentage rollout using hash
 * Same user always gets same result for same flag
 */
function isInPercentageRollout(
  flagKey: string,
  userId: string,
  percentage: number
): boolean {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;
  if (!userId) return false;

  const hash = createHash('sha256')
    .update(`${flagKey}:${userId}`)
    .digest('hex');

  // Use first 8 hex characters (32 bits) for percentage calculation
  const hashValue = parseInt(hash.substring(0, 8), 16);
  const normalizedValue = (hashValue / 0xffffffff) * 100;

  return normalizedValue < percentage;
}

/**
 * Compare semantic versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
  const parseVersion = (v: string): number[] => {
    const match = v.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return [0, 0, 0];
    return [
      parseInt(match[1] || '0', 10),
      parseInt(match[2] || '0', 10),
      parseInt(match[3] || '0', 10),
    ];
  };

  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;

  return 0;
}

// ============================================================================
// Typed Value Getters
// ============================================================================

export function getBooleanValue(result: EvaluationResult, defaultValue: boolean): boolean {
  if (result.valueType === 'boolean' && typeof result.value === 'boolean') {
    return result.value;
  }
  return defaultValue;
}

export function getStringValue(result: EvaluationResult, defaultValue: string): string {
  if (result.valueType === 'string' && typeof result.value === 'string') {
    return result.value;
  }
  return defaultValue;
}

export function getNumberValue(result: EvaluationResult, defaultValue: number): number {
  if (result.valueType === 'number' && typeof result.value === 'number') {
    return result.value;
  }
  return defaultValue;
}

export function getJsonValue<T>(result: EvaluationResult, defaultValue: T): T {
  if (result.valueType === 'json' && result.value !== undefined) {
    return result.value as T;
  }
  return defaultValue;
}
