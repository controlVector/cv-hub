/**
 * Vector Service
 * Qdrant-based vector storage and search for CV-Hub
 *
 * Each repository gets its own collection for isolation.
 * Vectors are linked to graph nodes via IDs.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../config/env';

// Collection naming: cv_hub_{repositoryId}
function getCollectionName(repositoryId: string): string {
  return `cv_hub_${repositoryId.replace(/-/g, '_')}`;
}

// Vector dimensions for common embedding models
const VECTOR_DIMENSIONS: Record<string, number> = {
  'openai/text-embedding-3-small': 1536,
  'openai/text-embedding-3-large': 3072,
  'openai/text-embedding-ada-002': 1536,
  'voyage/voyage-code-2': 1536,
  'cohere/embed-english-v3.0': 1024,
  'default': 1536,
};

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: {
    repositoryId: string;
    filePath: string;
    language: string;
    content: string;
    startLine?: number;
    endLine?: number;
    symbolName?: string;
    symbolKind?: string;
    chunkType: string;
    graphNodeId?: string; // Link to FalkorDB node
  };
}

export interface SearchResult {
  id: string;
  score: number;
  payload: VectorPoint['payload'];
}

// Singleton client
let qdrantClient: QdrantClient | null = null;

/**
 * Get or create Qdrant client
 */
function getClient(): QdrantClient {
  if (!qdrantClient) {
    const url = new URL(env.QDRANT_URL);
    qdrantClient = new QdrantClient({
      url: `${url.protocol}//${url.host}`,
      apiKey: env.QDRANT_API_KEY,
    });
  }
  return qdrantClient;
}

/**
 * Check if Qdrant is available
 */
export async function isVectorServiceAvailable(): Promise<boolean> {
  try {
    const client = getClient();
    await client.getCollections();
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure collection exists for a repository
 */
export async function ensureCollection(
  repositoryId: string,
  embeddingModel: string = 'default'
): Promise<void> {
  const client = getClient();
  const collectionName = getCollectionName(repositoryId);
  const vectorSize = VECTOR_DIMENSIONS[embeddingModel] || VECTOR_DIMENSIONS['default'];

  try {
    await client.getCollection(collectionName);
    console.log(`[Vector] Collection ${collectionName} already exists`);
  } catch {
    // Collection doesn't exist, create it
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
      optimizers_config: {
        default_segment_number: 2,
      },
      replication_factor: 1,
    });

    // Create payload indexes for filtering
    await client.createPayloadIndex(collectionName, {
      field_name: 'filePath',
      field_schema: 'keyword',
    });

    await client.createPayloadIndex(collectionName, {
      field_name: 'language',
      field_schema: 'keyword',
    });

    await client.createPayloadIndex(collectionName, {
      field_name: 'chunkType',
      field_schema: 'keyword',
    });

    await client.createPayloadIndex(collectionName, {
      field_name: 'symbolKind',
      field_schema: 'keyword',
    });

    console.log(`[Vector] Created collection ${collectionName} with vector size ${vectorSize}`);
  }
}

/**
 * Upsert vectors into collection
 */
export async function upsertVectors(
  repositoryId: string,
  points: VectorPoint[]
): Promise<void> {
  if (points.length === 0) return;

  const client = getClient();
  const collectionName = getCollectionName(repositoryId);

  // Batch upsert in chunks of 100
  const batchSize = 100;
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);

    await client.upsert(collectionName, {
      wait: true,
      points: batch.map(point => ({
        id: point.id,
        vector: point.vector,
        payload: point.payload,
      })),
    });
  }

  console.log(`[Vector] Upserted ${points.length} vectors to ${collectionName}`);
}

/**
 * Search for similar vectors
 */
export async function searchVectors(
  repositoryId: string,
  queryVector: number[],
  options: {
    limit?: number;
    filter?: {
      filePath?: string;
      language?: string;
      chunkType?: string;
      symbolKind?: string;
    };
    scoreThreshold?: number;
  } = {}
): Promise<SearchResult[]> {
  const client = getClient();
  const collectionName = getCollectionName(repositoryId);
  const { limit = 10, filter, scoreThreshold = 0.5 } = options;

  // Build filter conditions
  const must: any[] = [];

  if (filter?.filePath) {
    must.push({ key: 'filePath', match: { value: filter.filePath } });
  }
  if (filter?.language) {
    must.push({ key: 'language', match: { value: filter.language } });
  }
  if (filter?.chunkType) {
    must.push({ key: 'chunkType', match: { value: filter.chunkType } });
  }
  if (filter?.symbolKind) {
    must.push({ key: 'symbolKind', match: { value: filter.symbolKind } });
  }

  const results = await client.search(collectionName, {
    vector: queryVector,
    limit,
    filter: must.length > 0 ? { must } : undefined,
    score_threshold: scoreThreshold,
    with_payload: true,
  });

  return results.map(result => ({
    id: result.id as string,
    score: result.score,
    payload: result.payload as VectorPoint['payload'],
  }));
}

/**
 * Search across multiple repositories
 */
export async function searchVectorsMultiRepo(
  repositoryIds: string[],
  queryVector: number[],
  options: {
    limit?: number;
    scoreThreshold?: number;
  } = {}
): Promise<(SearchResult & { repositoryId: string })[]> {
  const allResults: (SearchResult & { repositoryId: string })[] = [];

  // Search each repo's collection
  for (const repoId of repositoryIds) {
    try {
      const results = await searchVectors(repoId, queryVector, {
        limit: options.limit || 10,
        scoreThreshold: options.scoreThreshold,
      });

      for (const result of results) {
        allResults.push({ ...result, repositoryId: repoId });
      }
    } catch (error) {
      // Collection might not exist for this repo
      console.warn(`[Vector] Search failed for repo ${repoId}:`, error);
    }
  }

  // Sort by score and limit
  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, options.limit || 10);
}

/**
 * Delete vectors for a file (when file is updated)
 */
export async function deleteVectorsByFile(
  repositoryId: string,
  filePath: string
): Promise<void> {
  const client = getClient();
  const collectionName = getCollectionName(repositoryId);

  await client.delete(collectionName, {
    wait: true,
    filter: {
      must: [{ key: 'filePath', match: { value: filePath } }],
    },
  });
}

/**
 * Delete all vectors for a repository
 */
export async function deleteCollection(repositoryId: string): Promise<void> {
  const client = getClient();
  const collectionName = getCollectionName(repositoryId);

  try {
    await client.deleteCollection(collectionName);
    console.log(`[Vector] Deleted collection ${collectionName}`);
  } catch {
    // Collection might not exist
  }
}

/**
 * Get collection info
 */
export async function getCollectionInfo(repositoryId: string): Promise<{
  vectorCount: number;
  indexedCount: number;
} | null> {
  const client = getClient();
  const collectionName = getCollectionName(repositoryId);

  try {
    const info = await client.getCollection(collectionName);
    return {
      vectorCount: info.points_count || 0,
      indexedCount: info.indexed_vectors_count || 0,
    };
  } catch {
    return null;
  }
}
