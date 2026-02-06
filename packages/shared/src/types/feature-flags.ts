// ============================================================================
// Feature Flags Types
// Shared types for feature flag functionality
// ============================================================================

// Value types for flags
export type FlagValueType = 'boolean' | 'string' | 'number' | 'json';

// Rule operators for targeting
export type FlagRuleOperator =
  | 'eq'        // equals
  | 'neq'       // not equals
  | 'in'        // in list
  | 'notIn'     // not in list
  | 'contains'  // string contains
  | 'startsWith'
  | 'endsWith'
  | 'matches'   // regex
  | 'gt'        // greater than
  | 'gte'       // greater than or equal
  | 'lt'        // less than
  | 'lte'       // less than or equal
  | 'exists'    // attribute exists
  | 'notExists' // attribute doesn't exist
  | 'semverGt'  // semver greater than
  | 'semverGte'
  | 'semverLt'
  | 'semverLte'
  | 'semverEq';

// ============================================================================
// Core Types
// ============================================================================

export interface FeatureFlag {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description?: string;
  valueType: FlagValueType;
  defaultValue: unknown;
  tags: string[];
  isArchived: boolean;
  archivedAt?: string;
  archivedBy?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureFlagWithEnvironments extends FeatureFlag {
  environments: FeatureFlagEnvironment[];
}

export interface FeatureFlagEnvironment {
  id: string;
  flagId: string;
  environment: string;
  isEnabled: boolean;
  overrideValue?: unknown;
  rolloutPercentage?: number;
  rules: FlagRule[];
  updatedBy?: string;
  updatedAt: string;
}

export interface FlagRuleCondition {
  attribute: string;
  operator: FlagRuleOperator;
  values: unknown[];
}

export interface FlagRule {
  id: string;
  conditions: FlagRuleCondition[];
  segmentId?: string;
  percentage?: number;
  serveValue: unknown;
  priority: number;
}

export interface FeatureFlagSegment {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description?: string;
  rules: SegmentRule[];
  matchMode: 'all' | 'any';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentRule {
  attribute: string;
  operator: FlagRuleOperator;
  values: unknown[];
}

export interface FeatureFlagHistoryEntry {
  id: string;
  flagId: string;
  environment?: string;
  changeType: string;
  previousValue?: unknown;
  newValue?: unknown;
  changeDescription?: string;
  changedBy?: string;
  createdAt: string;
}

export interface FeatureFlagApiKey {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  keyPrefix: string;
  environment: string;
  canRead: boolean;
  canWrite: boolean;
  isActive: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
  usageCount: number;
  createdBy?: string;
  createdAt: string;
}

// ============================================================================
// Evaluation Types
// ============================================================================

export interface EvaluationContext {
  // Standard attributes
  userId?: string;
  email?: string;
  plan?: string;
  environment?: string;

  // Custom attributes
  [key: string]: unknown;
}

export interface EvaluationResult {
  key: string;
  value: unknown;
  valueType: FlagValueType;
  isDefaultValue: boolean;
  matchedRuleId?: string;
  matchedSegmentId?: string;
  reason: EvaluationReason;
}

export type EvaluationReason =
  | 'FLAG_NOT_FOUND'
  | 'FLAG_ARCHIVED'
  | 'ENVIRONMENT_DISABLED'
  | 'RULE_MATCH'
  | 'SEGMENT_MATCH'
  | 'PERCENTAGE_ROLLOUT'
  | 'FALLTHROUGH'
  | 'DEFAULT_VALUE'
  | 'ERROR';

export interface BulkEvaluationResult {
  flags: Record<string, EvaluationResult>;
  evaluatedAt: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

// Create flag
export interface CreateFlagRequest {
  key: string;
  name: string;
  description?: string;
  valueType: FlagValueType;
  defaultValue: unknown;
  tags?: string[];
}

export interface CreateFlagResponse {
  flag: FeatureFlag;
}

// Update flag
export interface UpdateFlagRequest {
  name?: string;
  description?: string;
  defaultValue?: unknown;
  tags?: string[];
}

// List flags
export interface ListFlagsRequest {
  search?: string;
  tags?: string[];
  includeArchived?: boolean;
  environment?: string;
  limit?: number;
  offset?: number;
}

export interface ListFlagsResponse {
  flags: FeatureFlagWithEnvironments[];
  total: number;
  hasMore: boolean;
}

// Update environment config
export interface UpdateEnvironmentRequest {
  isEnabled?: boolean;
  overrideValue?: unknown;
  rolloutPercentage?: number;
}

// Add/update rules
export interface AddRuleRequest {
  conditions: FlagRuleCondition[];
  segmentId?: string;
  percentage?: number;
  serveValue: unknown;
  priority?: number;
}

export interface UpdateRuleRequest {
  conditions?: FlagRuleCondition[];
  segmentId?: string;
  percentage?: number;
  serveValue?: unknown;
  priority?: number;
}

// Segments
export interface CreateSegmentRequest {
  key: string;
  name: string;
  description?: string;
  rules: SegmentRule[];
  matchMode?: 'all' | 'any';
}

export interface UpdateSegmentRequest {
  name?: string;
  description?: string;
  rules?: SegmentRule[];
  matchMode?: 'all' | 'any';
}

export interface ListSegmentsResponse {
  segments: FeatureFlagSegment[];
  total: number;
}

// Evaluation
export interface EvaluateFlagRequest {
  context: EvaluationContext;
}

export interface BulkEvaluateRequest {
  context: EvaluationContext;
  flagKeys?: string[]; // If empty, evaluate all
}

// SDK initialization
export interface SDKInitResponse {
  flags: Record<string, {
    key: string;
    valueType: FlagValueType;
    defaultValue: unknown;
    environmentValue?: unknown;
    isEnabled: boolean;
    rules: FlagRule[];
    rolloutPercentage?: number;
  }>;
  segments: Record<string, {
    key: string;
    rules: SegmentRule[];
    matchMode: 'all' | 'any';
  }>;
  evaluatedAt: string;
}

// API Keys
export interface CreateApiKeyRequest {
  name: string;
  description?: string;
  environment: string;
  canWrite?: boolean;
  expiresAt?: string;
}

export interface CreateApiKeyResponse {
  apiKey: FeatureFlagApiKey;
  plainKey: string; // Only returned on creation
}

// History
export interface FlagHistoryResponse {
  history: FeatureFlagHistoryEntry[];
  total: number;
  hasMore: boolean;
}

// Analytics
export interface FlagAnalytics {
  flagId: string;
  environment: string;
  period: 'hour' | 'day' | 'week';
  dataPoints: Array<{
    timestamp: string;
    evaluationCount: number;
    trueCount: number;
    falseCount: number;
    uniqueUsers: number;
  }>;
}
