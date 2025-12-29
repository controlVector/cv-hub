import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import { apiKeys, type aiProviderEnum } from '../db/schema';
import { encrypt, decrypt } from '../utils/crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Types
export type AIProvider = typeof aiProviderEnum.enumValues[number];

export interface CreateApiKeyInput {
  userId: string;
  provider: AIProvider;
  name: string;
  apiKey: string;
  customEndpoint?: string;
  expiresAt?: Date;
}

export interface ApiKeyInfo {
  id: string;
  provider: AIProvider;
  name: string;
  keyHint: string;
  customEndpoint?: string | null;
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Derive per-user encryption key
function getEncryptionKey(userId: string): string {
  // Combine master key with user ID for user-specific encryption
  return `${env.MFA_ENCRYPTION_KEY}:${userId}`;
}

// Extract key hint (last 4 chars)
function getKeyHint(apiKey: string): string {
  if (apiKey.length <= 4) return '****';
  return `...${apiKey.slice(-4)}`;
}

// Create a new API key
export async function createApiKey(input: CreateApiKeyInput): Promise<ApiKeyInfo> {
  const encryptionKey = getEncryptionKey(input.userId);
  const { encrypted, iv } = encrypt(input.apiKey, encryptionKey);

  // Store encrypted key with IV (format: iv:encrypted)
  const encryptedKey = `${iv}:${encrypted}`;
  const keyHint = getKeyHint(input.apiKey);

  const [key] = await db.insert(apiKeys).values({
    userId: input.userId,
    provider: input.provider,
    name: input.name,
    encryptedKey,
    keyHint,
    customEndpoint: input.customEndpoint,
    expiresAt: input.expiresAt,
  }).returning();

  logger.info('general', 'API key created', { userId: input.userId, provider: input.provider, keyId: key.id });

  return {
    id: key.id,
    provider: key.provider,
    name: key.name,
    keyHint: key.keyHint,
    customEndpoint: key.customEndpoint,
    isActive: key.isActive,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    usageCount: key.usageCount,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  };
}

// Get all API keys for a user (without decrypted keys)
export async function getUserApiKeys(userId: string): Promise<ApiKeyInfo[]> {
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, userId),
    orderBy: (keys, { desc }) => [desc(keys.createdAt)],
  });

  return keys.map(key => ({
    id: key.id,
    provider: key.provider,
    name: key.name,
    keyHint: key.keyHint,
    customEndpoint: key.customEndpoint,
    isActive: key.isActive,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    usageCount: key.usageCount,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  }));
}

// Get a single API key info
export async function getApiKeyById(userId: string, keyId: string): Promise<ApiKeyInfo | null> {
  const key = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.id, keyId),
      eq(apiKeys.userId, userId),
    ),
  });

  if (!key) return null;

  return {
    id: key.id,
    provider: key.provider,
    name: key.name,
    keyHint: key.keyHint,
    customEndpoint: key.customEndpoint,
    isActive: key.isActive,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    usageCount: key.usageCount,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  };
}

// Get decrypted API key for a provider (for cv-git integration)
export async function getDecryptedApiKey(userId: string, provider: AIProvider): Promise<string | null> {
  const key = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.userId, userId),
      eq(apiKeys.provider, provider),
      eq(apiKeys.isActive, true),
    ),
    orderBy: (keys, { desc }) => [desc(keys.lastUsedAt), desc(keys.createdAt)],
  });

  if (!key) return null;

  // Check expiry
  if (key.expiresAt && key.expiresAt < new Date()) {
    logger.warn('general', 'API key expired', { userId, provider, keyId: key.id });
    return null;
  }

  try {
    const encryptionKey = getEncryptionKey(userId);
    const [iv, encrypted] = key.encryptedKey.split(':');
    const decryptedKey = decrypt(encrypted, iv, encryptionKey);

    // Update last used and usage count
    await db.update(apiKeys)
      .set({
        lastUsedAt: new Date(),
        usageCount: key.usageCount + 1,
      })
      .where(eq(apiKeys.id, key.id));

    return decryptedKey;
  } catch (error) {
    logger.error('general', 'Failed to decrypt API key', error as Error);
    return null;
  }
}

// Update API key
export async function updateApiKey(
  userId: string,
  keyId: string,
  updates: {
    name?: string;
    apiKey?: string;
    customEndpoint?: string | null;
    isActive?: boolean;
    expiresAt?: Date | null;
  }
): Promise<ApiKeyInfo | null> {
  const existing = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.id, keyId),
      eq(apiKeys.userId, userId),
    ),
  });

  if (!existing) return null;

  const updateData: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (updates.name !== undefined) {
    updateData.name = updates.name;
  }

  if (updates.apiKey !== undefined) {
    const encryptionKey = getEncryptionKey(userId);
    const { encrypted, iv } = encrypt(updates.apiKey, encryptionKey);
    updateData.encryptedKey = `${iv}:${encrypted}`;
    updateData.keyHint = getKeyHint(updates.apiKey);
  }

  if (updates.customEndpoint !== undefined) {
    updateData.customEndpoint = updates.customEndpoint;
  }

  if (updates.isActive !== undefined) {
    updateData.isActive = updates.isActive;
  }

  if (updates.expiresAt !== undefined) {
    updateData.expiresAt = updates.expiresAt;
  }

  const [updated] = await db.update(apiKeys)
    .set(updateData)
    .where(eq(apiKeys.id, keyId))
    .returning();

  logger.info('general', 'API key updated', { userId, keyId });

  return {
    id: updated.id,
    provider: updated.provider,
    name: updated.name,
    keyHint: updated.keyHint,
    customEndpoint: updated.customEndpoint,
    isActive: updated.isActive,
    expiresAt: updated.expiresAt,
    lastUsedAt: updated.lastUsedAt,
    usageCount: updated.usageCount,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

// Delete API key
export async function deleteApiKey(userId: string, keyId: string): Promise<boolean> {
  const result = await db.delete(apiKeys)
    .where(and(
      eq(apiKeys.id, keyId),
      eq(apiKeys.userId, userId),
    ))
    .returning({ id: apiKeys.id });

  if (result.length > 0) {
    logger.info('general', 'API key deleted', { userId, keyId });
    return true;
  }

  return false;
}

// Provider info for UI
export const PROVIDER_INFO: Record<AIProvider, { name: string; keyPrefix: string; docsUrl: string }> = {
  openai: {
    name: 'OpenAI',
    keyPrefix: 'sk-',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    name: 'Anthropic',
    keyPrefix: 'sk-ant-',
    docsUrl: 'https://console.anthropic.com/account/keys',
  },
  google: {
    name: 'Google AI',
    keyPrefix: 'AI',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  mistral: {
    name: 'Mistral AI',
    keyPrefix: '',
    docsUrl: 'https://console.mistral.ai/api-keys/',
  },
  cohere: {
    name: 'Cohere',
    keyPrefix: '',
    docsUrl: 'https://dashboard.cohere.com/api-keys',
  },
  groq: {
    name: 'Groq',
    keyPrefix: 'gsk_',
    docsUrl: 'https://console.groq.com/keys',
  },
  together: {
    name: 'Together AI',
    keyPrefix: '',
    docsUrl: 'https://api.together.xyz/settings/api-keys',
  },
  openrouter: {
    name: 'OpenRouter',
    keyPrefix: 'sk-or-',
    docsUrl: 'https://openrouter.ai/keys',
  },
  custom: {
    name: 'Custom Provider',
    keyPrefix: '',
    docsUrl: '',
  },
};
