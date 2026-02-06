// ============================================================================
// Configuration Management Types
// ============================================================================

// Store Types
export type ConfigStoreType =
  | 'builtin'
  | 'aws_ssm'
  | 'hashicorp_vault'
  | 'azure_keyvault'
  | 'gcp_secrets';

export type ConfigValueType = 'string' | 'number' | 'boolean' | 'json' | 'secret';

export type ConfigScope = 'repository' | 'organization' | 'environment';

export type ConfigValidatorType = 'regex' | 'range' | 'enum' | 'dependency' | 'custom';

export type ConfigExportFormat =
  | 'dotenv'
  | 'json'
  | 'yaml'
  | 'k8s_configmap'
  | 'k8s_secret'
  | 'terraform';

export type ConfigTokenPermission = 'read' | 'write' | 'admin';

// ============================================================================
// Schema Types
// ============================================================================

export interface ConfigSchemaKeyDefinition {
  key: string;
  type: ConfigValueType;
  required?: boolean;
  default?: unknown;
  description?: string;
  pattern?: string;
  enum?: string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  deprecated?: boolean;
  deprecationMessage?: string;
}

export interface ConfigSchemaDefinition {
  version: string;
  keys: ConfigSchemaKeyDefinition[];
}

export interface ConfigSchema {
  id: string;
  repositoryId?: string | null;
  organizationId?: string | null;
  name: string;
  description?: string | null;
  definition: ConfigSchemaDefinition;
  version: number;
  previousVersionId?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Store Types
// ============================================================================

export interface ConfigStoreCredentials {
  // AWS SSM
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  awsRoleArn?: string;
  // HashiCorp Vault
  vaultAddress?: string;
  vaultToken?: string;
  vaultNamespace?: string;
  vaultPath?: string;
  // Azure Key Vault
  azureClientId?: string;
  azureClientSecret?: string;
  azureTenantId?: string;
  azureVaultUrl?: string;
  // GCP Secrets
  gcpProjectId?: string;
  gcpServiceAccountKey?: string;
}

export interface ConfigStore {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  type: ConfigStoreType;
  isDefault: boolean;
  isActive: boolean;
  lastTestedAt?: Date | null;
  lastTestSuccess?: boolean | null;
  lastTestError?: string | null;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Config Set Types
// ============================================================================

export interface ConfigSet {
  id: string;
  storeId: string;
  schemaId?: string | null;
  scope: ConfigScope;
  repositoryId?: string | null;
  organizationId?: string | null;
  name: string;
  description?: string | null;
  environment?: string | null;
  parentSetId?: string | null;
  hierarchyRank: number;
  isActive: boolean;
  isLocked: boolean;
  lockedReason?: string | null;
  lockedBy?: string | null;
  lockedAt?: Date | null;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Config Value Types
// ============================================================================

export interface ConfigValue {
  id: string;
  configSetId: string;
  key: string;
  valueType: ConfigValueType;
  isSecret: boolean;
  isEncrypted: boolean;
  version: number;
  description?: string | null;
  createdBy?: string | null;
  lastUpdatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfigValueWithValue extends ConfigValue {
  value: unknown;
}

export interface ResolvedConfigValue {
  key: string;
  value: unknown;
  valueType: ConfigValueType;
  isSecret: boolean;
  source: {
    setId: string;
    setName: string;
    environment?: string;
    scope: ConfigScope;
  };
}

// ============================================================================
// Config History Types
// ============================================================================

export interface ConfigValueHistoryEntry {
  id: string;
  configValueId: string;
  configSetId: string;
  key: string;
  previousVersion?: number | null;
  newVersion: number;
  changedBy?: string | null;
  changeReason?: string | null;
  changeType: 'create' | 'update' | 'delete';
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

// ============================================================================
// Access Token Types
// ============================================================================

export interface ConfigAccessToken {
  id: string;
  configSetId: string;
  name: string;
  description?: string | null;
  tokenPrefix: string;
  permission: ConfigTokenPermission;
  allowedSetIds?: string[] | null;
  isActive: boolean;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  usageCount: number;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfigAccessTokenWithSecret extends ConfigAccessToken {
  token: string;
}

// ============================================================================
// Export Types
// ============================================================================

export interface ConfigExportDestination {
  type: 'webhook' | 'git' | 's3' | 'local';
  webhookUrl?: string;
  webhookHeaders?: Record<string, string>;
  gitRepoUrl?: string;
  gitBranch?: string;
  gitPath?: string;
  s3Bucket?: string;
  s3Key?: string;
  s3Region?: string;
}

export interface ConfigExport {
  id: string;
  configSetId: string;
  name: string;
  format: ConfigExportFormat;
  destination?: ConfigExportDestination | null;
  cronSchedule?: string | null;
  timezone?: string | null;
  includeSecrets: boolean;
  keyPrefix?: string | null;
  keyTransform?: 'uppercase' | 'lowercase' | 'none' | null;
  isActive: boolean;
  lastExportAt?: Date | null;
  lastExportSuccess?: boolean | null;
  lastExportError?: string | null;
  nextScheduledAt?: Date | null;
  exportCount: number;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Validator Types
// ============================================================================

export interface ConfigValidatorRule {
  type: ConfigValidatorType;
  pattern?: string;
  min?: number;
  max?: number;
  values?: string[];
  dependsOn?: string;
  dependsOnValue?: unknown;
  customScript?: string;
  errorMessage: string;
}

export interface ConfigValidator {
  id: string;
  schemaId: string;
  targetKey?: string | null;
  name: string;
  description?: string | null;
  type: ConfigValidatorType;
  rule: ConfigValidatorRule;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateConfigSchemaInput {
  repositoryId?: string;
  organizationId?: string;
  name: string;
  description?: string;
  definition: ConfigSchemaDefinition;
}

export interface UpdateConfigSchemaInput {
  name?: string;
  description?: string;
  definition?: ConfigSchemaDefinition;
  isActive?: boolean;
}

export interface CreateConfigStoreInput {
  organizationId: string;
  name: string;
  description?: string;
  type: ConfigStoreType;
  credentials?: ConfigStoreCredentials;
  isDefault?: boolean;
}

export interface UpdateConfigStoreInput {
  name?: string;
  description?: string;
  credentials?: ConfigStoreCredentials;
  isDefault?: boolean;
  isActive?: boolean;
}

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
}

export interface UpdateConfigSetInput {
  name?: string;
  description?: string;
  schemaId?: string | null;
  parentSetId?: string | null;
  isActive?: boolean;
  isLocked?: boolean;
  lockedReason?: string;
}

export interface SetConfigValueInput {
  key: string;
  value: unknown;
  valueType?: ConfigValueType;
  isSecret?: boolean;
  description?: string;
  changeReason?: string;
}

export interface BulkSetConfigValuesInput {
  values: SetConfigValueInput[];
  changeReason?: string;
}

export interface CreateConfigTokenInput {
  configSetId: string;
  name: string;
  description?: string;
  permission?: ConfigTokenPermission;
  allowedSetIds?: string[];
  expiresAt?: Date | string;
}

export interface CreateConfigExportInput {
  configSetId: string;
  name: string;
  format: ConfigExportFormat;
  destination?: ConfigExportDestination;
  cronSchedule?: string;
  timezone?: string;
  includeSecrets?: boolean;
  keyPrefix?: string;
  keyTransform?: 'uppercase' | 'lowercase' | 'none';
}

export interface ConfigImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ key: string; error: string }>;
}

export interface ConfigCompareResult {
  onlyInFirst: Array<{ key: string; value: unknown }>;
  onlyInSecond: Array<{ key: string; value: unknown }>;
  different: Array<{
    key: string;
    firstValue: unknown;
    secondValue: unknown;
  }>;
  same: Array<{ key: string; value: unknown }>;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: Array<{
    key: string;
    message: string;
    validatorName?: string;
  }>;
  warnings: Array<{
    key: string;
    message: string;
  }>;
}

// ============================================================================
// CI/CD Integration Types
// ============================================================================

export interface ConfigInjectStep {
  type: 'config-inject';
  configSet: string;
  environment: string;
  format: 'env' | 'file';
  filePath?: string;
  prefix?: string;
}

export interface ConfigInjectResult {
  values: Record<string, string>;
  source: {
    setId: string;
    setName: string;
    environment?: string;
  };
  resolvedAt: Date;
}

// ============================================================================
// Pricing Tier Limits for Config
// ============================================================================

export interface ConfigPricingLimits {
  configSets: number | null;
  configSchemas: number | null;
  externalStores: boolean;
  historyDays: number;
  exportsEnabled: boolean;
}
