/**
 * Context Engine Egress Service
 *
 * Write path: after every turn, structured knowledge flows from the session
 * back into FalkorDB and Qdrant. When compaction happens, less is lost because
 * the important stuff is already in the graph.
 *
 * v1: No LLM calls. Summaries are extracted via truncation, file descriptions
 * via regex pattern matching. Conservative by design.
 *
 * ── 8-Step Egress Pipeline ──────────────────────────────────────────────
 *
 * 1. Extract file references    — Regex-match file paths in the transcript,
 *                                 validate against known File nodes in FalkorDB.
 * 2. Extract symbol references  — Regex-match PascalCase/camelCase identifiers
 *                                 and qualified names, resolve against known
 *                                 Symbol nodes.
 * 3. Build summary              — Truncate the transcript to 500 chars (no LLM).
 * 4. Create SessionKnowledge    — Upsert a SessionKnowledge node in the graph
 *    node                         with turn metadata, summary, files, and symbols.
 * 5. Create ABOUT edges         — Link the SessionKnowledge node to each
 *                                 referenced File and Symbol node (role:
 *                                 touched vs referenced).
 * 6. Create FOLLOWS edge        — Chain this turn to the previous turn's
 *                                 SessionKnowledge node for temporal ordering.
 * 7. Enrich file summaries      — Extract "file handles/implements…" patterns
 *                                 from the transcript and update File node
 *                                 summaries when the new description is richer.
 * 8. Embed in Qdrant            — Generate a vector embedding of the summary
 *                                 and store it as a session_knowledge point
 *                                 for semantic search.
 */

import { getGraphManager } from './graph/graph.service';
import { queryGraph } from './context-engine-adapter';
import { generateEmbedding } from './embedding.service';
import { upsertVectors, ensureCollection } from './vector.service';
import type { VectorPoint } from './vector.service';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface EgressInput {
  sessionId: string;
  turnNumber: number;
  transcriptSegment: string;
  filesTouched: string[];
  symbolsReferenced: string[];
  concern: string;
  repositoryId: string;
  organizationId?: string | null;
}

export interface EgressResult {
  knowledgeNodeId: string;
  fileSummariesUpdated: number;
  symbolSummariesUpdated: number;
  edgesCreated: number;
  vectorStored: boolean;
}

// ── Regex patterns ──────────────────────────────────────────────────────

// File paths: explicit paths like src/foo/bar.ts or ./foo/bar.ts
const FILE_PATH_RE = /(?:^|[\s`"'(])(\.?\/?(?:[\w@.-]+\/)*[\w@.-]+\.[\w]+)/gm;

// Backtick-quoted paths
const BACKTICK_PATH_RE = /`(\.?\/?(?:[\w@.-]+\/)*[\w@.-]+\.[\w]+)`/g;

// File description patterns: `path.ts` handles/implements/provides ...
const FILE_DESC_RE = /`(\.?\/?(?:[\w@.-]+\/)*[\w@.-]+\.[\w]+)`\s+(?:handles|implements|provides|manages|contains|defines|exports|wraps|orchestrates|configures)\s+(.+?)(?:\.|$)/gm;

// PascalCase or camelCase identifiers (at least 2 chars)
const SYMBOL_RE = /(?:^|[\s`(,])([A-Z][a-zA-Z0-9]+|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)/gm;

// Qualified names in backticks
const QUALIFIED_SYMBOL_RE = /`([\w.]+:[\w.]+)`|`([\w]+\.[\w.]+)`/g;

// ── Helpers ─────────────────────────────────────────────────────────────

function uniqueStrings(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Check if a candidate description is meaningfully richer than an existing one.
 * No LLM — purely length + novel word heuristic.
 */
function isRicher(existing: string | undefined | null, candidate: string): boolean {
  if (!existing || existing.trim() === '') return true;
  if (candidate.length <= existing.length * 1.2) return false;

  const existingWords = new Set(
    existing.toLowerCase().split(/\s+/).filter(w => w.length > 3),
  );
  const candidateWords = candidate.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  let novelCount = 0;
  for (const w of candidateWords) {
    if (!existingWords.has(w)) novelCount++;
  }

  return novelCount >= 2;
}

// ── Main egress function ────────────────────────────────────────────────

export async function processEgress(input: EgressInput): Promise<EgressResult> {
  const {
    sessionId,
    turnNumber,
    transcriptSegment,
    filesTouched,
    symbolsReferenced,
    concern,
    repositoryId,
    organizationId,
  } = input;

  const knowledgeNodeId = `${sessionId}:turn:${turnNumber}`;
  let fileSummariesUpdated = 0;
  let symbolSummariesUpdated = 0;
  let edgesCreated = 0;
  let vectorStored = false;

  const gm = await getGraphManager(repositoryId);

  // ── Step 1: Extract file references from transcript ────────────────
  // NOTE: Bulk fetch of all file paths for transcript validation — CV-Hub enrichment,
  // not a SK operation. Uses raw Cypher via queryGraph (no GraphManager method for this).

  const knownFiles = await queryGraph(
    repositoryId,
    'MATCH (f:File) RETURN f.path AS path',
  );
  const knownFilePaths = new Set(knownFiles.map((r: any) => r.path as string));

  const transcriptFilePaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const re of [FILE_PATH_RE, BACKTICK_PATH_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(transcriptSegment)) !== null) {
      const candidate = m[1];
      if (candidate && knownFilePaths.has(candidate) && !seenPaths.has(candidate)) {
        seenPaths.add(candidate);
        transcriptFilePaths.push(candidate);
      }
    }
  }

  const allFiles = uniqueStrings([...filesTouched, ...transcriptFilePaths]);

  // ── Step 2: Extract symbol references from transcript ──────────────
  // NOTE: Bulk fetch of all symbol names for transcript resolution — CV-Hub enrichment,
  // not a SK operation. Uses raw Cypher via queryGraph (no GraphManager method for this).

  const knownSymbols = await queryGraph(
    repositoryId,
    'MATCH (s:Symbol) RETURN s.name AS name, s.qualifiedName AS qualifiedName',
  );
  const symbolNameToQualified = new Map<string, string>();
  const qualifiedNames = new Set<string>();
  for (const r of knownSymbols as any[]) {
    if (r.qualifiedName) {
      qualifiedNames.add(r.qualifiedName);
      if (r.name) {
        symbolNameToQualified.set(r.name, r.qualifiedName);
      }
    }
  }

  const transcriptSymbols: string[] = [];
  const seenSymbols = new Set<string>();

  // Qualified names in backticks first
  QUALIFIED_SYMBOL_RE.lastIndex = 0;
  let sm: RegExpExecArray | null;
  while ((sm = QUALIFIED_SYMBOL_RE.exec(transcriptSegment)) !== null) {
    const candidate = sm[1] || sm[2];
    if (candidate && qualifiedNames.has(candidate) && !seenSymbols.has(candidate)) {
      seenSymbols.add(candidate);
      transcriptSymbols.push(candidate);
    }
  }

  // Simple names resolved via lookup
  SYMBOL_RE.lastIndex = 0;
  while ((sm = SYMBOL_RE.exec(transcriptSegment)) !== null) {
    const name = sm[1];
    if (!name) continue;
    const qn = symbolNameToQualified.get(name);
    if (qn && !seenSymbols.has(qn)) {
      seenSymbols.add(qn);
      transcriptSymbols.push(qn);
    }
  }

  // Merge with explicit input (resolve simple names if needed)
  for (const s of symbolsReferenced) {
    const qn = qualifiedNames.has(s) ? s : symbolNameToQualified.get(s);
    if (qn && !seenSymbols.has(qn)) {
      seenSymbols.add(qn);
      transcriptSymbols.push(qn);
    }
  }

  const allSymbols = transcriptSymbols;

  // ── Step 3: Build summary ──────────────────────────────────────────

  const summary = transcriptSegment.slice(0, 500).trim();

  // ── Step 4: Create SessionKnowledge node ───────────────────────────

  await gm.upsertSessionKnowledgeNode({
    sessionId,
    turnNumber,
    timestamp: Date.now(),
    summary,
    concern,
    source: 'claude_code',
    filesTouched: allFiles,
    symbolsReferenced: allSymbols,
    repoId: repositoryId,
    orgId: organizationId || null,
  });

  // ── Step 5: Create ABOUT edges ─────────────────────────────────────

  const touchedSet = new Set(filesTouched);

  for (const filePath of allFiles) {
    try {
      const role = touchedSet.has(filePath) ? 'touched' : 'referenced';
      await gm.createAboutFileEdge(sessionId, turnNumber, filePath, { role });
      edgesCreated++;
    } catch {
      // File node doesn't exist in graph — skip silently
    }
  }

  for (const qn of allSymbols) {
    try {
      await gm.createAboutSymbolEdge(sessionId, turnNumber, qn, { role: 'referenced' });
      edgesCreated++;
    } catch {
      // Symbol node doesn't exist in graph — skip silently
    }
  }

  // ── Step 6: Create FOLLOWS edge ────────────────────────────────────

  if (turnNumber > 1) {
    const previousTurn = turnNumber - 1;
    const prev = await gm.getSessionKnowledgeNode(sessionId, previousTurn);
    if (prev) {
      try {
        await gm.createFollowsEdge(sessionId, turnNumber, previousTurn);
        edgesCreated++;
      } catch {
        // Non-fatal
      }
    }
  }

  // ── Step 7: Enrich file summaries ──────────────────────────────────
  // NOTE: File summary enrichment is a CV-Hub concern. Uses raw Cypher for SET because
  // GraphManager.upsertFileNode() expects a full FileNode (would overwrite other fields).
  // TODO: Add GraphManager.updateFileSummary(path, summary) if this pattern repeats.

  FILE_DESC_RE.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = FILE_DESC_RE.exec(transcriptSegment)) !== null) {
    const filePath = dm[1];
    const description = dm[2]?.trim();
    if (!filePath || !description || !knownFilePaths.has(filePath)) continue;

    try {
      const fileNode = await gm.getFileNode(filePath);
      if (fileNode && isRicher(fileNode.summary, description)) {
        await gm.query(
          `MATCH (f:File {path: $path}) SET f.summary = $summary RETURN f`,
          { path: filePath, summary: description },
        );
        fileSummariesUpdated++;
      }
    } catch {
      // Non-fatal
    }
  }

  // ── Step 8: Embed in Qdrant ────────────────────────────────────────

  if (summary.length > 0) {
    try {
      await ensureCollection(repositoryId);

      const embeddingResult = await generateEmbedding(summary);

      const point: VectorPoint = {
        id: knowledgeNodeId,
        vector: embeddingResult.embedding,
        payload: {
          repositoryId,
          filePath: allFiles[0] || '',
          language: '',
          content: summary,
          chunkType: 'session_knowledge',
          graphNodeId: knowledgeNodeId,
          sessionId,
        },
      };

      await upsertVectors(repositoryId, [point]);
      vectorStored = true;
    } catch (err) {
      console.warn('[Egress] Vector embedding failed (non-fatal):', err);
    }
  }

  return {
    knowledgeNodeId,
    fileSummariesUpdated,
    symbolSummariesUpdated,
    edgesCreated,
    vectorStored,
  };
}
