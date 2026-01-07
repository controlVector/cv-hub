/**
 * Graph Sync Service
 * Manages graph sync jobs via BullMQ
 */

import { Queue, Worker, Job } from 'bullmq';
import { db } from '../../db';
import { repositories, graphSyncJobs, commits, branches } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { env } from '../../config/env';
import { getGraphManager, GraphManager } from './graph.service';
import type { FileNode, CommitNode } from './types';
import * as gitBackend from '../git/git-backend.service';
import {
  isEmbeddingServiceAvailable,
  generateEmbeddingsBatch,
  chunkFileContent,
  prepareCodeForEmbedding,
  type CodeChunk,
} from '../embedding.service';
import {
  isVectorServiceAvailable,
  ensureCollection,
  upsertVectors,
  type VectorPoint,
} from '../vector.service';
import { CodeParser } from '../parser';
import type { ParseResult, SymbolInfo, ImportInfo } from '../parser/types';
import { isCodeFile as parserIsCodeFile, getLanguageFromPath as parserGetLanguage } from '../parser/types';

// Queue name
const GRAPH_SYNC_QUEUE = 'graph-sync';

// Job data interface
export interface GraphSyncJobData {
  repositoryId: string;
  jobType: 'full' | 'delta' | 'incremental';
  triggerRef?: string; // For incremental: the ref that triggered the sync
}

// Job result interface
export interface GraphSyncJobResult {
  nodesCreated: number;
  edgesCreated: number;
  vectorsCreated: number;
  duration: number;
}

// Queue instance (singleton)
let graphSyncQueue: Queue<GraphSyncJobData, GraphSyncJobResult> | null = null;

/**
 * Get or create the graph sync queue
 */
export function getGraphSyncQueue(): Queue<GraphSyncJobData, GraphSyncJobResult> {
  if (!graphSyncQueue) {
    graphSyncQueue = new Queue<GraphSyncJobData, GraphSyncJobResult>(GRAPH_SYNC_QUEUE, {
      connection: {
        host: new URL(env.REDIS_URL).hostname,
        port: parseInt(new URL(env.REDIS_URL).port || '6379'),
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          age: 24 * 60 * 60, // Keep completed jobs for 24 hours
          count: 100,
        },
        removeOnFail: {
          age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
        },
      },
    });
  }
  return graphSyncQueue;
}

/**
 * Enqueue a graph sync job
 */
export async function enqueueGraphSync(
  repositoryId: string,
  jobType: 'full' | 'delta' | 'incremental' = 'full',
  triggerRef?: string
): Promise<string> {
  const queue = getGraphSyncQueue();

  // Create job record in database
  const [job] = await db.insert(graphSyncJobs).values({
    repositoryId,
    jobType,
    status: 'pending',
  }).returning();

  // Add to queue
  await queue.add(
    `graph-sync-${repositoryId}`,
    {
      repositoryId,
      jobType,
      triggerRef,
    },
    {
      jobId: job.id,
      priority: jobType === 'incremental' ? 1 : 5, // Incremental jobs have higher priority
    }
  );

  // Update repo status
  await db.update(repositories)
    .set({
      graphSyncStatus: 'pending',
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId));

  console.log(`[GraphSync] Enqueued ${jobType} sync for repository ${repositoryId}`);
  return job.id;
}

/**
 * Get the status of a sync job
 */
export async function getJobStatus(jobId: string) {
  const job = await db.query.graphSyncJobs.findFirst({
    where: eq(graphSyncJobs.id, jobId),
  });

  if (!job) {
    return null;
  }

  return {
    id: job.id,
    repositoryId: job.repositoryId,
    jobType: job.jobType,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    nodesCreated: job.nodesCreated,
    edgesCreated: job.edgesCreated,
    vectorsCreated: job.vectorsCreated,
    errorMessage: job.errorMessage,
    attemptCount: job.attemptCount,
  };
}

/**
 * Get recent sync jobs for a repository
 */
export async function getRepoSyncJobs(repositoryId: string, limit = 10) {
  return db.query.graphSyncJobs.findMany({
    where: eq(graphSyncJobs.repositoryId, repositoryId),
    orderBy: desc(graphSyncJobs.createdAt),
    limit,
  });
}

/**
 * Process a graph sync job
 */
export async function processGraphSync(
  job: Job<GraphSyncJobData, GraphSyncJobResult>
): Promise<GraphSyncJobResult> {
  const { repositoryId, jobType, triggerRef } = job.data;
  const startTime = Date.now();
  let nodesCreated = 0;
  let edgesCreated = 0;
  let vectorsCreated = 0;

  console.log(`[GraphSync] Processing ${jobType} sync for repository ${repositoryId}`);

  // Update job status
  await db.update(graphSyncJobs)
    .set({
      status: 'syncing',
      startedAt: new Date(),
      currentStep: 'Initializing',
      attemptCount: job.attemptsMade,
      lastAttemptAt: new Date(),
    })
    .where(eq(graphSyncJobs.id, job.id!));

  await db.update(repositories)
    .set({
      graphSyncStatus: 'syncing',
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId));

  // Get repository info
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repo) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }

  const ownerSlug = repo.organization?.slug || repo.owner?.username;
  if (!ownerSlug) {
    throw new Error('Repository has no owner');
  }

  // Get graph manager
  const graph = await getGraphManager(repositoryId);

  try {
    // Update progress
    const updateProgress = async (step: string, progress: number) => {
      await db.update(graphSyncJobs)
        .set({
          currentStep: step,
          progress,
          updatedAt: new Date(),
        })
        .where(eq(graphSyncJobs.id, job.id!));
      await job.updateProgress(progress);
    };

    // Step 1: Sync file nodes
    await updateProgress('Syncing files', 10);
    const fileStats = await syncFileNodes(graph, ownerSlug, repo.slug, repo.defaultBranch || 'main');
    nodesCreated += fileStats.nodesCreated;
    edgesCreated += fileStats.edgesCreated;

    // Step 2: Extract symbols with tree-sitter
    await updateProgress('Extracting symbols', 25);
    const symbolStats = await syncSymbolNodes(
      graph,
      ownerSlug,
      repo.slug,
      repo.defaultBranch || 'main',
      async (step, progress) => {
        await updateProgress(step, 25 + Math.floor(progress * 0.15));
      }
    );
    nodesCreated += symbolStats.nodesCreated;
    edgesCreated += symbolStats.edgesCreated;

    // Step 3: Sync commit nodes
    await updateProgress('Syncing commits', 40);
    const commitStats = await syncCommitNodes(graph, repositoryId, ownerSlug, repo.slug);
    nodesCreated += commitStats.nodesCreated;
    edgesCreated += commitStats.edgesCreated;

    // Step 4: Create file relationships
    await updateProgress('Creating relationships', 50);
    const relStats = await createFileRelationships(graph, ownerSlug, repo.slug);
    edgesCreated += relStats.edgesCreated;

    // Step 5: Generate vector embeddings (if service available)
    await updateProgress('Generating embeddings', 60);
    const vectorStats = await syncVectorEmbeddings(
      repositoryId,
      ownerSlug,
      repo.slug,
      repo.defaultBranch || 'main',
      async (step, progress) => {
        await updateProgress(step, 60 + Math.floor(progress * 0.35));
      }
    );
    vectorsCreated = vectorStats.vectorsCreated;

    // Step 6: Finalize
    await updateProgress('Finalizing', 95);

    // Update job as complete
    await db.update(graphSyncJobs)
      .set({
        status: 'synced',
        progress: 100,
        currentStep: 'Complete',
        completedAt: new Date(),
        nodesCreated,
        edgesCreated,
        vectorsCreated,
        updatedAt: new Date(),
      })
      .where(eq(graphSyncJobs.id, job.id!));

    // Update repo status
    await db.update(repositories)
      .set({
        graphSyncStatus: 'synced',
        graphLastSyncedAt: new Date(),
        graphSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repositoryId));

    const duration = Date.now() - startTime;
    console.log(`[GraphSync] Completed ${jobType} sync for ${ownerSlug}/${repo.slug} in ${duration}ms`);
    console.log(`[GraphSync] Created ${nodesCreated} nodes, ${edgesCreated} edges, ${vectorsCreated} vectors`);

    return { nodesCreated, edgesCreated, vectorsCreated, duration };

  } catch (error: any) {
    // Update job as failed
    await db.update(graphSyncJobs)
      .set({
        status: 'failed',
        errorMessage: error.message,
        errorStack: error.stack,
        updatedAt: new Date(),
      })
      .where(eq(graphSyncJobs.id, job.id!));

    // Update repo status
    await db.update(repositories)
      .set({
        graphSyncStatus: 'failed',
        graphSyncError: error.message,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repositoryId));

    throw error;
  }
}

/**
 * Sync file nodes from repository to graph
 */
async function syncFileNodes(
  graph: GraphManager,
  ownerSlug: string,
  repoSlug: string,
  branch: string
): Promise<{ nodesCreated: number; edgesCreated: number }> {
  let nodesCreated = 0;
  let edgesCreated = 0;

  try {
    // Get the file tree
    const tree = await gitBackend.getTree(ownerSlug, repoSlug, branch, '');

    for (const entry of tree) {
      if (entry.type === 'blob') {
        // Determine language from file extension
        const language = getLanguageFromPath(entry.path);

        const fileNode: FileNode = {
          path: entry.path,
          absolutePath: `${ownerSlug}/${repoSlug}/${entry.path}`,
          language,
          lastModified: Date.now(),
          size: entry.size || 0,
          gitHash: entry.sha || '',
          linesOfCode: 0, // Would need to read file to count
          complexity: 0,
        };

        await graph.upsertFileNode(fileNode);
        nodesCreated++;
      }
    }
  } catch (error: any) {
    console.error(`[GraphSync] Error syncing files: ${error.message}`);
  }

  return { nodesCreated, edgesCreated };
}

/**
 * Sync symbol nodes by parsing code files with tree-sitter
 */
async function syncSymbolNodes(
  graph: GraphManager,
  ownerSlug: string,
  repoSlug: string,
  branch: string,
  onProgress?: (step: string, progress: number) => Promise<void>
): Promise<{ nodesCreated: number; edgesCreated: number }> {
  let nodesCreated = 0;
  let edgesCreated = 0;

  // Initialize parser
  const parser = new CodeParser();
  const initResult = await parser.initialize();

  if (!initResult.success) {
    console.warn(`[GraphSync] Parser initialization issues: ${initResult.errors.join(', ')}`);
    // Continue anyway - we may be able to parse some languages
  }

  try {
    // Get all files recursively
    const tree = await gitBackend.getTreeRecursive(ownerSlug, repoSlug, branch);

    // Filter to parseable code files
    const codeFiles = tree.filter(entry =>
      entry.type === 'blob' &&
      parserIsCodeFile(entry.path)
    );

    if (codeFiles.length === 0) {
      console.log('[GraphSync] No parseable code files found');
      return { nodesCreated, edgesCreated };
    }

    console.log(`[GraphSync] Parsing ${codeFiles.length} code files for symbols`);

    // Collect all parsed results for later relationship building
    const allParseResults: ParseResult[] = [];

    // Process files in batches
    const batchSize = 20;
    for (let i = 0; i < codeFiles.length; i += batchSize) {
      const batch = codeFiles.slice(i, i + batchSize);

      for (const file of batch) {
        try {
          // Get file content
          const blob = await gitBackend.getBlob(ownerSlug, repoSlug, branch, file.path);

          if (blob.isBinary || !blob.content) {
            continue;
          }

          // Parse the file
          const parseResult = await parser.parseFile(file.path, blob.content);

          if (parseResult.errors.length > 0) {
            console.warn(`[GraphSync] Parse warnings for ${file.path}: ${parseResult.errors.join(', ')}`);
          }

          allParseResults.push(parseResult);

          // Create symbol nodes
          for (const symbol of parseResult.symbols) {
            const symbolNode = {
              qualifiedName: symbol.qualifiedName,
              name: symbol.name,
              kind: symbol.kind as any,
              file: symbol.file,
              startLine: symbol.startLine,
              endLine: symbol.endLine,
              signature: symbol.signature,
              docstring: symbol.docstring,
              returnType: symbol.returnType,
              visibility: symbol.visibility,
              isAsync: symbol.isAsync,
              isStatic: symbol.isStatic,
              complexity: symbol.complexity,
            };

            await graph.upsertSymbolNode(symbolNode);
            nodesCreated++;

            // Create DEFINES edge (File -> Symbol)
            await graph.createDefinesEdge(symbol.file, symbol.qualifiedName, {
              line: symbol.startLine
            });
            edgesCreated++;
          }

          // Update file node with LOC and complexity
          if (parseResult.linesOfCode > 0 || parseResult.symbols.length > 0) {
            const avgComplexity = parseResult.symbols.length > 0
              ? Math.round(parseResult.symbols.reduce((sum, s) => sum + s.complexity, 0) / parseResult.symbols.length)
              : 0;

            await graph.query(
              `MATCH (f:File {path: $path})
               SET f.linesOfCode = $loc, f.complexity = $complexity`,
              { path: file.path, loc: parseResult.linesOfCode, complexity: avgComplexity }
            );
          }

        } catch (error: any) {
          console.warn(`[GraphSync] Error parsing ${file.path}: ${error.message}`);
        }
      }

      // Update progress
      if (onProgress) {
        await onProgress(
          `Parsing files (${Math.min(i + batchSize, codeFiles.length)}/${codeFiles.length})`,
          (i + batchSize) / codeFiles.length
        );
      }
    }

    // Second pass: Create relationships between symbols
    console.log('[GraphSync] Creating symbol relationships...');

    // Build a map of symbol names to qualified names for resolution
    const symbolMap = new Map<string, string[]>();
    for (const result of allParseResults) {
      for (const symbol of result.symbols) {
        const existing = symbolMap.get(symbol.name) || [];
        existing.push(symbol.qualifiedName);
        symbolMap.set(symbol.name, existing);
      }
    }

    // Create CALLS edges
    for (const result of allParseResults) {
      for (const symbol of result.symbols) {
        for (const call of symbol.calls) {
          // Try to resolve the callee
          const calleeQualifiedNames = symbolMap.get(call.callee);
          if (calleeQualifiedNames && calleeQualifiedNames.length > 0) {
            // Prefer callee in same file, then take first match
            let calleeQN = calleeQualifiedNames.find(qn => qn.startsWith(symbol.file + ':'))
                          || calleeQualifiedNames[0];

            try {
              await graph.createCallsEdge(symbol.qualifiedName, calleeQN, {
                line: call.line,
                callCount: 1,
                isConditional: call.isConditional
              });
              edgesCreated++;
            } catch {
              // Callee might not exist in graph
            }
          }
        }
      }
    }

    // Create IMPORTS edges (File -> File)
    for (const result of allParseResults) {
      for (const imp of result.imports) {
        if (!imp.isExternal) {
          // Resolve relative import to file path
          const resolvedPath = resolveImportPath(result.path, imp.source);
          if (resolvedPath) {
            try {
              await graph.createImportsEdge(result.path, resolvedPath, {
                line: imp.line,
                importedSymbols: imp.importedSymbols,
                alias: imp.namespaceImport
              });
              edgesCreated++;
            } catch {
              // Target file might not be in graph
            }
          }
        }
      }
    }

    console.log(`[GraphSync] Created ${nodesCreated} symbol nodes and ${edgesCreated} edges`);

  } catch (error: any) {
    console.error(`[GraphSync] Error syncing symbols: ${error.message}`);
  }

  return { nodesCreated, edgesCreated };
}

/**
 * Resolve relative import path to actual file path
 */
function resolveImportPath(fromFile: string, importSource: string): string | null {
  // Handle relative imports
  if (!importSource.startsWith('.')) {
    return null; // External package
  }

  const fromDir = fromFile.substring(0, fromFile.lastIndexOf('/'));
  const parts = importSource.split('/');
  let currentPath = fromDir;

  for (const part of parts) {
    if (part === '.') {
      continue;
    } else if (part === '..') {
      currentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
    } else {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
    }
  }

  // Try common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
  for (const ext of extensions) {
    // Direct file
    if (currentPath.endsWith(ext)) {
      return currentPath;
    }
  }

  // Try adding extensions
  for (const ext of extensions) {
    const withExt = `${currentPath}${ext}`;
    return withExt; // Assume it exists - graph will ignore if not found
  }

  // Try index file
  for (const ext of extensions) {
    const indexPath = `${currentPath}/index${ext}`;
    return indexPath;
  }

  return currentPath;
}

/**
 * Sync commit nodes from database to graph
 */
async function syncCommitNodes(
  graph: GraphManager,
  repositoryId: string,
  ownerSlug: string,
  repoSlug: string
): Promise<{ nodesCreated: number; edgesCreated: number }> {
  let nodesCreated = 0;
  let edgesCreated = 0;

  // Get commits from database
  const repoCommits = await db.query.commits.findMany({
    where: eq(commits.repositoryId, repositoryId),
    orderBy: desc(commits.authorDate),
    limit: 500, // Limit for performance
  });

  for (const commit of repoCommits) {
    const commitNode: CommitNode = {
      sha: commit.sha,
      message: commit.message,
      author: commit.authorName || 'Unknown',
      authorEmail: commit.authorEmail || '',
      committer: commit.committerName || 'Unknown',
      timestamp: commit.authorDate?.getTime() || Date.now(),
      branch: '', // Could track this from refs
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      createdAt: commit.createdAt.getTime(),
    };

    await graph.upsertCommitNode(commitNode);
    nodesCreated++;
  }

  // Create PARENT_OF relationships between commits
  for (const commit of repoCommits) {
    if (commit.parentShas && Array.isArray(commit.parentShas)) {
      for (const parentSha of commit.parentShas) {
        try {
          await graph.query(`
            MATCH (child:Commit {sha: $childSha})
            MATCH (parent:Commit {sha: $parentSha})
            MERGE (child)-[:PARENT_OF]->(parent)
          `, { childSha: commit.sha, parentSha: parentSha as string });
          edgesCreated++;
        } catch {
          // Parent might not be in graph yet
        }
      }
    }
  }

  return { nodesCreated, edgesCreated };
}

/**
 * Create file import relationships based on content analysis
 * This is a simplified version - cv-git uses tree-sitter for proper parsing
 */
async function createFileRelationships(
  graph: GraphManager,
  ownerSlug: string,
  repoSlug: string
): Promise<{ edgesCreated: number }> {
  let edgesCreated = 0;

  // For now, we create a basic module structure based on directory hierarchy
  // Full parsing would require tree-sitter which comes from @cv-git/core

  try {
    // Create module hierarchy from directories
    await graph.query(`
      MATCH (f:File)
      WITH f, split(f.path, '/') as parts
      WHERE size(parts) > 1
      WITH f, parts[0..-1] as dirParts
      UNWIND range(0, size(dirParts)-1) as idx
      WITH f, reduce(s = '', i IN range(0, idx) | s + '/' + dirParts[i]) as modulePath
      WHERE modulePath <> ''
      MERGE (m:Module {path: substring(modulePath, 1)})
      ON CREATE SET m.name = split(modulePath, '/')[-1], m.type = 'module', m.fileCount = 0
      WITH f, m
      MERGE (m)-[:CONTAINS]->(f)
    `);
    edgesCreated += 1; // Approximate
  } catch (error: any) {
    console.warn(`[GraphSync] Error creating module relationships: ${error.message}`);
  }

  return { edgesCreated };
}

/**
 * Sync vector embeddings for file contents
 */
async function syncVectorEmbeddings(
  repositoryId: string,
  ownerSlug: string,
  repoSlug: string,
  branch: string,
  onProgress?: (step: string, progress: number) => Promise<void>
): Promise<{ vectorsCreated: number }> {
  // Check if embedding services are available
  const embeddingAvailable = isEmbeddingServiceAvailable();
  const vectorAvailable = await isVectorServiceAvailable();

  if (!embeddingAvailable) {
    console.log('[GraphSync] Embedding service not available (no OPENROUTER_API_KEY)');
    return { vectorsCreated: 0 };
  }

  if (!vectorAvailable) {
    console.log('[GraphSync] Vector service not available (Qdrant not reachable)');
    return { vectorsCreated: 0 };
  }

  let vectorsCreated = 0;

  try {
    // Ensure collection exists
    await ensureCollection(repositoryId);
    console.log('[GraphSync] Collection ensured, getting file tree...');

    // Get all files recursively
    const tree = await gitBackend.getTreeRecursive(ownerSlug, repoSlug, branch);
    console.log(`[GraphSync] Got ${tree.length} files recursively`);
    const codeFiles = tree.filter(entry =>
      entry.type === 'blob' &&
      isCodeFile(entry.path)
    );
    console.log(`[GraphSync] Found ${codeFiles.length} code files to embed`);

    if (codeFiles.length === 0) {
      console.log('[GraphSync] No code files to embed');
      return { vectorsCreated: 0 };
    }

    // Process files in batches
    const batchSize = 10;
    const allChunks: CodeChunk[] = [];
    console.log(`[GraphSync] Starting to process ${codeFiles.length} files...`);

    for (let i = 0; i < codeFiles.length; i += batchSize) {
      const batch = codeFiles.slice(i, i + batchSize);

      for (const file of batch) {
        try {
          console.log(`[GraphSync] Reading file: ${file.path}`);
          // Get file content
          const blob = await gitBackend.getBlob(ownerSlug, repoSlug, branch, file.path);

          if (blob.isBinary || !blob.content) {
            continue;
          }

          const language = getLanguageFromPath(file.path);

          // Chunk the file content
          const chunks = chunkFileContent(blob.content, {
            repositoryId,
            filePath: file.path,
            language,
          });

          allChunks.push(...chunks);
        } catch (error: any) {
          console.warn(`[GraphSync] Error reading file ${file.path}: ${error.message}`);
        }
      }

      // Update progress
      if (onProgress) {
        await onProgress(
          `Reading files (${Math.min(i + batchSize, codeFiles.length)}/${codeFiles.length})`,
          (i + batchSize) / codeFiles.length * 0.3
        );
      }
    }

    if (allChunks.length === 0) {
      console.log('[GraphSync] No chunks to embed');
      return { vectorsCreated: 0 };
    }

    console.log(`[GraphSync] Embedding ${allChunks.length} chunks`);

    // Generate embeddings in batches
    const embeddingBatchSize = 20;
    const vectorPoints: VectorPoint[] = [];

    for (let i = 0; i < allChunks.length; i += embeddingBatchSize) {
      const chunkBatch = allChunks.slice(i, i + embeddingBatchSize);
      const texts = chunkBatch.map(chunk => prepareCodeForEmbedding(chunk));

      try {
        const result = await generateEmbeddingsBatch(texts);

        for (let j = 0; j < chunkBatch.length; j++) {
          const chunk = chunkBatch[j];
          const embeddingVector = result.embeddings[j];

          vectorPoints.push({
            id: chunk.id,
            vector: embeddingVector,
            payload: {
              repositoryId: chunk.metadata.repositoryId,
              filePath: chunk.metadata.filePath,
              language: chunk.metadata.language,
              content: chunk.content.slice(0, 500), // Truncate for payload
              startLine: chunk.metadata.startLine,
              endLine: chunk.metadata.endLine,
              symbolName: chunk.metadata.symbolName,
              symbolKind: chunk.metadata.symbolKind,
              chunkType: chunk.metadata.chunkType,
            },
          });
        }
      } catch (error: any) {
        console.error(`[GraphSync] Embedding batch failed: ${error.message}`);
      }

      // Update progress
      if (onProgress) {
        await onProgress(
          `Generating embeddings (${Math.min(i + embeddingBatchSize, allChunks.length)}/${allChunks.length})`,
          0.3 + (i + embeddingBatchSize) / allChunks.length * 0.5
        );
      }
    }

    // Store in Qdrant
    if (vectorPoints.length > 0) {
      await upsertVectors(repositoryId, vectorPoints);
      vectorsCreated = vectorPoints.length;

      if (onProgress) {
        await onProgress('Stored embeddings', 1);
      }
    }

    console.log(`[GraphSync] Created ${vectorsCreated} vector embeddings`);

  } catch (error: any) {
    console.error(`[GraphSync] Vector sync failed: ${error.message}`);
    // Don't throw - embedding is optional, graph sync should still succeed
  }

  return { vectorsCreated };
}

/**
 * Check if file should be embedded
 */
function isCodeFile(path: string): boolean {
  const codeExtensions = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
    '.c', '.cpp', '.cc', '.h', '.hpp', '.cs',
    '.php', '.swift', '.r',
    '.vue', '.svelte',
  ];

  const ext = '.' + (path.split('.').pop()?.toLowerCase() || '');
  return codeExtensions.includes(ext);
}

/**
 * Get programming language from file path
 */
function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'py': 'python',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'kt': 'kotlin',
    'scala': 'scala',
    'c': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'swift': 'swift',
    'r': 'r',
    'sql': 'sql',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'ps1': 'powershell',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'xml': 'xml',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'md': 'markdown',
    'mdx': 'mdx',
    'vue': 'vue',
    'svelte': 'svelte',
  };
  return languageMap[ext] || 'unknown';
}

// Worker instance (created on startup)
let graphSyncWorker: Worker<GraphSyncJobData, GraphSyncJobResult> | null = null;

/**
 * Start the graph sync worker
 */
export function startGraphSyncWorker(): Worker<GraphSyncJobData, GraphSyncJobResult> {
  if (graphSyncWorker) {
    return graphSyncWorker;
  }

  graphSyncWorker = new Worker<GraphSyncJobData, GraphSyncJobResult>(
    GRAPH_SYNC_QUEUE,
    processGraphSync,
    {
      connection: {
        host: new URL(env.REDIS_URL).hostname,
        port: parseInt(new URL(env.REDIS_URL).port || '6379'),
      },
      concurrency: env.GRAPH_SYNC_CONCURRENCY,
      limiter: {
        max: 10,
        duration: 60000, // Max 10 jobs per minute
      },
    }
  );

  graphSyncWorker.on('completed', (job, result) => {
    console.log(`[GraphSyncWorker] Job ${job.id} completed:`, result);
  });

  graphSyncWorker.on('failed', (job, error) => {
    console.error(`[GraphSyncWorker] Job ${job?.id} failed:`, error);
  });

  graphSyncWorker.on('error', (error) => {
    console.error('[GraphSyncWorker] Worker error:', error);
  });

  console.log('[GraphSyncWorker] Started with concurrency:', env.GRAPH_SYNC_CONCURRENCY);
  return graphSyncWorker;
}

/**
 * Stop the graph sync worker
 */
export async function stopGraphSyncWorker(): Promise<void> {
  if (graphSyncWorker) {
    await graphSyncWorker.close();
    graphSyncWorker = null;
    console.log('[GraphSyncWorker] Stopped');
  }
}

/**
 * Close the queue connection
 */
export async function closeGraphSyncQueue(): Promise<void> {
  if (graphSyncQueue) {
    await graphSyncQueue.close();
    graphSyncQueue = null;
  }
}
