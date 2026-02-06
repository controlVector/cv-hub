import { encrypt, decrypt, generateSecureToken, hashToken } from '../utils/crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { type ConfigStoreCredentials } from '../db/schema/config';

// ============================================================================
// Config Encryption Service
// Provides AES-256-GCM encryption for configuration values
// ============================================================================

/**
 * Derive an encryption key for config values based on scope
 * Uses a combination of master key and scope-specific identifiers
 */
function deriveConfigKey(scope: {
  organizationId?: string;
  repositoryId?: string;
  configSetId?: string;
}): string {
  const parts = [env.MFA_ENCRYPTION_KEY];

  if (scope.organizationId) {
    parts.push(`org:${scope.organizationId}`);
  }
  if (scope.repositoryId) {
    parts.push(`repo:${scope.repositoryId}`);
  }
  if (scope.configSetId) {
    parts.push(`set:${scope.configSetId}`);
  }

  return parts.join(':');
}

/**
 * Encrypt a configuration value
 */
export function encryptConfigValue(
  value: string,
  scope: {
    organizationId?: string;
    repositoryId?: string;
    configSetId?: string;
  }
): { encryptedValue: string; iv: string } {
  const key = deriveConfigKey(scope);
  const { encrypted, iv } = encrypt(value, key);

  return {
    encryptedValue: encrypted,
    iv,
  };
}

/**
 * Decrypt a configuration value
 */
export function decryptConfigValue(
  encryptedValue: string,
  iv: string,
  scope: {
    organizationId?: string;
    repositoryId?: string;
    configSetId?: string;
  }
): string {
  const key = deriveConfigKey(scope);

  try {
    return decrypt(encryptedValue, iv, key);
  } catch (error) {
    logger.error('config', 'Failed to decrypt config value', error as Error);
    throw new Error('Failed to decrypt configuration value');
  }
}

/**
 * Encrypt store credentials (for external config stores)
 */
export function encryptStoreCredentials(
  credentials: Record<string, unknown>,
  organizationId: string
): { encryptedCredentials: string; iv: string } {
  const key = `${env.MFA_ENCRYPTION_KEY}:store:${organizationId}`;
  const jsonValue = JSON.stringify(credentials);
  const { encrypted, iv } = encrypt(jsonValue, key);

  return {
    encryptedCredentials: encrypted,
    iv,
  };
}

/**
 * Decrypt store credentials
 */
export function decryptStoreCredentials(
  encryptedCredentials: string,
  iv: string,
  organizationId: string
): ConfigStoreCredentials {
  const key = `${env.MFA_ENCRYPTION_KEY}:store:${organizationId}`;

  try {
    const jsonValue = decrypt(encryptedCredentials, iv, key);
    return JSON.parse(jsonValue) as ConfigStoreCredentials;
  } catch (error) {
    logger.error('config', 'Failed to decrypt store credentials', error as Error);
    throw new Error('Failed to decrypt store credentials');
  }
}

/**
 * Generate a new config access token
 * Returns both the full token (to show once) and the hash (to store)
 */
export function generateConfigToken(): {
  token: string;
  tokenPrefix: string;
  tokenHash: string;
} {
  const token = `cfg_${generateSecureToken(32)}`;
  const tokenPrefix = token.substring(0, 8);
  const tokenHash = hashToken(token);

  return {
    token,
    tokenPrefix,
    tokenHash,
  };
}

/**
 * Verify a config access token
 */
export function verifyConfigToken(token: string, storedHash: string): boolean {
  const hash = hashToken(token);
  return hash === storedHash;
}

/**
 * Serialize a value to string for encryption
 */
export function serializeValue(value: unknown, valueType: string): string {
  switch (valueType) {
    case 'string':
    case 'secret':
      return String(value);
    case 'number':
      return String(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'json':
      return JSON.stringify(value);
    default:
      return String(value);
  }
}

/**
 * Deserialize a value from encrypted string
 */
export function deserializeValue(value: string, valueType: string): unknown {
  switch (valueType) {
    case 'string':
    case 'secret':
      return value;
    case 'number':
      return parseFloat(value);
    case 'boolean':
      return value === 'true';
    case 'json':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

/**
 * Create a masked version of a secret value for display
 */
export function maskSecretValue(value: string): string {
  if (value.length <= 4) {
    return '****';
  }
  return `${value.substring(0, 2)}${'*'.repeat(Math.min(value.length - 4, 20))}${value.substring(value.length - 2)}`;
}

/**
 * Re-encrypt a value with a new scope
 * Used when moving values between config sets
 */
export function reEncryptValue(
  encryptedValue: string,
  iv: string,
  oldScope: {
    organizationId?: string;
    repositoryId?: string;
    configSetId?: string;
  },
  newScope: {
    organizationId?: string;
    repositoryId?: string;
    configSetId?: string;
  }
): { encryptedValue: string; iv: string } {
  // Decrypt with old scope
  const plaintext = decryptConfigValue(encryptedValue, iv, oldScope);

  // Encrypt with new scope
  return encryptConfigValue(plaintext, newScope);
}
