/**
 * Embedding Service
 * Tiered embedding generation with usage tracking
 *
 * Config Resolution Order:
 * 1. Repository-level BYOK
 * 2. Organization-level BYOK
 * 3. Platform default (with quotas)
 *
 * Usage is tracked for billing/quota enforcement.
 */

import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { db } from '../db';
import {
  repositoryEmbeddingConfig,
  organizationEmbeddingConfig,
  embeddingUsage,
  embeddingUsageSummary,
  repositories,
} from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingConfig {
  apiKey: string;
  model: string;
  provider: 'openrouter' | 'openai' | 'platform';
  billedTo: 'platform' | 'organization' | 'repository';
  billedToId?: string;
  enabled: boolean;
  quotaRemaining?: number; // null = unlimited
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokensUsed: number;
}

export interface EmbeddingBatchResult {
  embeddings: number[][];
  model: string;
  totalTokensUsed: number;
}

export interface UsageRecord {
  repositoryId: string;
  organizationId?: string;
  operation: 'sync' | 'search' | 'assistant';
  tokensUsed: number;
  embeddingsGenerated: number;
  config: EmbeddingConfig;
}

export interface CodeChunk {
  id: string;
  content: string;
  metadata: {
    repositoryId: string;
    filePath: string;
    language: string;
    startLine?: number;
    endLine?: number;
    symbolName?: string;
    symbolKind?: string;
    chunkType: 'file' | 'symbol' | 'function' | 'class' | 'docstring';
  };
}

// ============================================================================
// Platform Defaults
// ============================================================================

const PLATFORM_CONFIG = {
  model: env.EMBEDDING_MODEL || 'openai/text-embedding-3-small',
  apiKey: env.OPENROUTER_API_KEY,
  // Free tier limits (can be overridden by tier system later)
  freeMonthlyEmbeddings: 50000,
  freeMonthlySearches: 5000,
};

// Cost per 1M tokens (in microdollars) - for tracking
const MODEL_COSTS: Record<string, number> = {
  'openai/text-embedding-3-small': 20000, // $0.02 per 1M tokens
  'openai/text-embedding-3-large': 130000, // $0.13 per 1M tokens
  'openai/text-embedding-ada-002': 100000, // $0.10 per 1M tokens
  'voyage/voyage-code-2': 120000, // estimate
};

// ============================================================================
// Config Resolution
// ============================================================================

/**
 * Check if embedding service is available at platform level
 */
export function isEmbeddingServiceAvailable(): boolean {
  return !!PLATFORM_CONFIG.apiKey;
}

/**
 * Get configured embedding model
 */
export function getEmbeddingModel(): string {
  return PLATFORM_CONFIG.model;
}

/**
 * Resolve embedding config for a repository
 * Checks repo → org → platform in order
 */
export async function resolveEmbeddingConfig(
  repositoryId: string
): Promise<EmbeddingConfig | null> {
  // Get repository with org info
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
  });

  if (!repo) {
    return null;
  }

  // 1. Check repository-level config (if table exists)
  try {
    const repoConfig = await db.query.repositoryEmbeddingConfig?.findFirst({
      where: eq(repositoryEmbeddingConfig.repositoryId, repositoryId),
    });

    if (repoConfig?.apiKeyEncrypted && repoConfig.enabled !== false) {
      return {
        apiKey: decryptApiKey(repoConfig.apiKeyEncrypted),
        model: repoConfig.embeddingModel || PLATFORM_CONFIG.model,
        provider: (repoConfig.apiKeyProvider as any) || 'openrouter',
        billedTo: 'repository',
        billedToId: repositoryId,
        enabled: true,
        quotaRemaining: undefined, // BYOK = unlimited
      };
    }

    // 2. Check organization-level config (if repo belongs to org)
    if (repo.organizationId) {
      const orgConfig = await db.query.organizationEmbeddingConfig?.findFirst({
        where: eq(organizationEmbeddingConfig.organizationId, repo.organizationId),
      });

      if (orgConfig?.apiKeyEncrypted && orgConfig.enabled !== false) {
        const quotaRemaining = orgConfig.monthlyQuota
          ? await getQuotaRemaining('organization', repo.organizationId)
          : undefined;

        return {
          apiKey: decryptApiKey(orgConfig.apiKeyEncrypted),
          model: repoConfig?.embeddingModel || orgConfig.embeddingModel || PLATFORM_CONFIG.model,
          provider: (orgConfig.apiKeyProvider as any) || 'openrouter',
          billedTo: 'organization',
          billedToId: repo.organizationId,
          enabled: true,
          quotaRemaining,
        };
      }
    }
  } catch (error) {
    // Tables might not exist yet, fall through to platform default
    console.warn('[Embedding] Config tables not ready, using platform default');
  }

  // 3. Fall back to platform default
  if (!PLATFORM_CONFIG.apiKey) {
    return null;
  }

  return {
    apiKey: PLATFORM_CONFIG.apiKey,
    model: PLATFORM_CONFIG.model,
    provider: 'platform',
    billedTo: 'platform',
    enabled: true,
    quotaRemaining: undefined, // No quota for now during development
  };
}

/**
 * Get remaining quota for an entity this month
 */
async function getQuotaRemaining(
  entityType: string,
  entityId: string
): Promise<number> {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const summary = await db.query.embeddingUsageSummary?.findFirst({
      where: and(
        eq(embeddingUsageSummary.year, year),
        eq(embeddingUsageSummary.month, month),
        eq(embeddingUsageSummary.entityType, entityType),
        eq(embeddingUsageSummary.entityId, entityId)
      ),
    });

    const used = Number(summary?.totalEmbeddings || 0);
    const limit = PLATFORM_CONFIG.freeMonthlyEmbeddings;

    return Math.max(0, limit - used);
  } catch {
    return PLATFORM_CONFIG.freeMonthlyEmbeddings;
  }
}

// ============================================================================
// Encryption (stub - use proper encryption in production)
// ============================================================================

function decryptApiKey(encrypted: string): string {
  // TODO: Implement proper encryption with env.MFA_ENCRYPTION_KEY
  // For now, just return as-is (keys should be stored encrypted in prod)
  return encrypted;
}

export function encryptApiKey(plaintext: string): string {
  // TODO: Implement proper encryption
  return plaintext;
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(
  text: string,
  config?: Partial<EmbeddingConfig>
): Promise<EmbeddingResult> {
  const effectiveConfig: EmbeddingConfig = {
    apiKey: config?.apiKey || PLATFORM_CONFIG.apiKey!,
    model: config?.model || PLATFORM_CONFIG.model,
    provider: config?.provider || 'platform',
    billedTo: config?.billedTo || 'platform',
    enabled: true,
  };

  if (!effectiveConfig.apiKey) {
    throw new Error('No API key configured for embeddings');
  }

  // Truncate text if too long (most models have 8k token limit)
  const truncatedText = text.slice(0, 30000);

  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${effectiveConfig.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.APP_URL,
      'X-Title': 'Control Fabric Hub',
    },
    body: JSON.stringify({
      model: effectiveConfig.model,
      input: truncatedText,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Embedding] API error:', errorText);
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    embedding: data.data[0].embedding,
    model: data.model || effectiveConfig.model,
    tokensUsed: data.usage?.total_tokens || estimateTokens(truncatedText),
  };
}

/**
 * Generate embeddings for multiple texts (batched)
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  config?: Partial<EmbeddingConfig>
): Promise<EmbeddingBatchResult> {
  const effectiveConfig: EmbeddingConfig = {
    apiKey: config?.apiKey || PLATFORM_CONFIG.apiKey!,
    model: config?.model || PLATFORM_CONFIG.model,
    provider: config?.provider || 'platform',
    billedTo: config?.billedTo || 'platform',
    enabled: true,
  };

  if (!effectiveConfig.apiKey) {
    throw new Error('No API key configured for embeddings');
  }

  if (texts.length === 0) {
    return { embeddings: [], model: effectiveConfig.model, totalTokensUsed: 0 };
  }

  // Truncate texts
  const truncatedTexts = texts.map(t => t.slice(0, 30000));

  // Batch in groups of 100 (API limit)
  const batchSize = 100;
  const allEmbeddings: number[][] = [];
  let totalTokens = 0;
  let model = effectiveConfig.model;

  for (let i = 0; i < truncatedTexts.length; i += batchSize) {
    const batch = truncatedTexts.slice(i, i + batchSize);

    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${effectiveConfig.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env.APP_URL,
        'X-Title': 'Control Fabric Hub',
      },
      body: JSON.stringify({
        model: effectiveConfig.model,
        input: batch,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Embedding] Batch API error:', errorText);
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = await response.json();
    model = data.model || effectiveConfig.model;
    totalTokens += data.usage?.total_tokens || batch.reduce((sum, t) => sum + estimateTokens(t), 0);

    // Sort by index to maintain order
    const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
    for (const item of sorted) {
      allEmbeddings.push(item.embedding);
    }
  }

  return {
    embeddings: allEmbeddings,
    model,
    totalTokensUsed: totalTokens,
  };
}

/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Usage Tracking
// ============================================================================

/**
 * Record embedding usage
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    const costPerMillion = MODEL_COSTS[record.config.model] || MODEL_COSTS['openai/text-embedding-3-small'];
    const costMicrodollars = Math.ceil((record.tokensUsed / 1_000_000) * costPerMillion);

    // Insert usage record
    await db.insert(embeddingUsage).values({
      repositoryId: record.repositoryId,
      organizationId: record.organizationId,
      operation: record.operation,
      model: record.config.model,
      provider: record.config.provider,
      tokensUsed: record.tokensUsed,
      embeddingsGenerated: record.embeddingsGenerated,
      costMicrodollars,
      billedTo: record.config.billedTo,
      billedToId: record.config.billedToId,
    });

    // Update summary
    const now = new Date();
    await upsertUsageSummary('repository', record.repositoryId, now.getFullYear(), now.getMonth() + 1, record, costMicrodollars);

    if (record.organizationId) {
      await upsertUsageSummary('organization', record.organizationId, now.getFullYear(), now.getMonth() + 1, record, costMicrodollars);
    }

    await upsertUsageSummary('platform', null, now.getFullYear(), now.getMonth() + 1, record, costMicrodollars);

    console.log(`[Embedding] Recorded usage: ${record.embeddingsGenerated} embeddings, ${record.tokensUsed} tokens, $${(costMicrodollars / 1_000_000).toFixed(4)}`);
  } catch (error) {
    // Don't fail the main operation if usage tracking fails
    console.warn('[Embedding] Failed to record usage:', error);
  }
}

async function upsertUsageSummary(
  entityType: string,
  entityId: string | null,
  year: number,
  month: number,
  record: UsageRecord,
  costMicrodollars: number
): Promise<void> {
  try {
    // Try to find existing summary
    const existing = await db.query.embeddingUsageSummary?.findFirst({
      where: and(
        eq(embeddingUsageSummary.year, year),
        eq(embeddingUsageSummary.month, month),
        eq(embeddingUsageSummary.entityType, entityType),
        entityId
          ? eq(embeddingUsageSummary.entityId, entityId)
          : sql`${embeddingUsageSummary.entityId} IS NULL`
      ),
    });

    if (existing) {
      // Update existing
      const updateData: any = {
        totalTokens: sql`${embeddingUsageSummary.totalTokens} + ${record.tokensUsed}`,
        totalEmbeddings: sql`${embeddingUsageSummary.totalEmbeddings} + ${record.embeddingsGenerated}`,
        totalCostMicrodollars: sql`${embeddingUsageSummary.totalCostMicrodollars} + ${costMicrodollars}`,
        updatedAt: new Date(),
      };

      if (record.operation === 'sync') {
        updateData.syncEmbeddings = sql`${embeddingUsageSummary.syncEmbeddings} + ${record.embeddingsGenerated}`;
      } else if (record.operation === 'search') {
        updateData.searchEmbeddings = sql`${embeddingUsageSummary.searchEmbeddings} + ${record.embeddingsGenerated}`;
      } else if (record.operation === 'assistant') {
        updateData.assistantEmbeddings = sql`${embeddingUsageSummary.assistantEmbeddings} + ${record.embeddingsGenerated}`;
      }

      await db.update(embeddingUsageSummary)
        .set(updateData)
        .where(eq(embeddingUsageSummary.id, existing.id));
    } else {
      // Insert new
      await db.insert(embeddingUsageSummary).values({
        year,
        month,
        entityType,
        entityId,
        totalTokens: record.tokensUsed,
        totalEmbeddings: record.embeddingsGenerated,
        totalCostMicrodollars: costMicrodollars,
        syncEmbeddings: record.operation === 'sync' ? record.embeddingsGenerated : 0,
        searchEmbeddings: record.operation === 'search' ? record.embeddingsGenerated : 0,
        assistantEmbeddings: record.operation === 'assistant' ? record.embeddingsGenerated : 0,
      });
    }
  } catch (error) {
    console.warn('[Embedding] Failed to update usage summary:', error);
  }
}

// ============================================================================
// Chunking Utilities
// ============================================================================

/**
 * Chunk file content for embedding
 */
export function chunkFileContent(
  content: string,
  metadata: Omit<CodeChunk['metadata'], 'startLine' | 'endLine' | 'chunkType'>,
  maxChunkSize: number = 1500 // ~tokens
): CodeChunk[] {
  const lines = content.split('\n');
  const chunks: CodeChunk[] = [];
  let currentChunk: string[] = [];
  let currentStartLine = 1;
  let chunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    currentChunk.push(lines[i]);

    // Rough estimate: 4 chars per token
    const estimatedTokens = currentChunk.join('\n').length / 4;

    if (estimatedTokens >= maxChunkSize || i === lines.length - 1) {
      if (currentChunk.length > 0) {
        chunks.push({
          id: randomUUID(), // Qdrant requires valid UUIDs or integers
          content: currentChunk.join('\n'),
          metadata: {
            ...metadata,
            startLine: currentStartLine,
            endLine: currentStartLine + currentChunk.length - 1,
            chunkType: 'file',
          },
        });
        chunkIndex++;
      }
      currentChunk = [];
      currentStartLine = i + 2;
    }
  }

  return chunks;
}

/**
 * Prepare code for embedding
 * Formats code with context for better semantic understanding
 */
export function prepareCodeForEmbedding(chunk: CodeChunk): string {
  const parts: string[] = [];

  // Add context header
  if (chunk.metadata.symbolName) {
    parts.push(`${chunk.metadata.symbolKind || 'symbol'}: ${chunk.metadata.symbolName}`);
  }

  if (chunk.metadata.filePath) {
    parts.push(`file: ${chunk.metadata.filePath}`);
  }

  if (chunk.metadata.language) {
    parts.push(`language: ${chunk.metadata.language}`);
  }

  // Add the actual content
  parts.push('');
  parts.push(chunk.content);

  return parts.join('\n');
}

// ============================================================================
// High-Level API
// ============================================================================

/**
 * Generate embeddings for a repository with config resolution and usage tracking
 */
export async function generateRepositoryEmbeddings(
  repositoryId: string,
  texts: string[],
  operation: 'sync' | 'search' | 'assistant',
  organizationId?: string
): Promise<EmbeddingBatchResult> {
  // Resolve config
  const config = await resolveEmbeddingConfig(repositoryId);

  if (!config) {
    throw new Error('Embedding service not configured for this repository');
  }

  if (!config.enabled) {
    throw new Error('Embeddings disabled for this repository');
  }

  // Check quota
  if (config.quotaRemaining !== undefined && config.quotaRemaining < texts.length) {
    throw new Error(`Quota exceeded: ${config.quotaRemaining} embeddings remaining, ${texts.length} requested`);
  }

  // Generate embeddings
  const result = await generateEmbeddingsBatch(texts, config);

  // Record usage
  await recordUsage({
    repositoryId,
    organizationId,
    operation,
    tokensUsed: result.totalTokensUsed,
    embeddingsGenerated: texts.length,
    config,
  });

  return result;
}
