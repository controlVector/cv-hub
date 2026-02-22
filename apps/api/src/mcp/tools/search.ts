/**
 * MCP Tools: Semantic Search
 * Exposes vector-based code search and symbol search to AI agents via MCP
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';
import { generateEmbedding } from '../../services/embedding.service';
import { searchVectors } from '../../services/vector.service';
import { getGraphManager } from '../../services/graph/graph.service';

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerSearchTools(
  server: McpServer,
  userId: string,
  scopes: string[],
) {
  const hasRead = scopes.includes('repo:read');

  // ── search_code ─────────────────────────────────────────────────────
  server.tool(
    'search_code',
    'Semantic search across repository code using natural language queries',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      query: z.string().describe('Natural language search query'),
      limit: z.number().optional().describe('Max results (default 10)'),
      language: z.string().optional().describe('Filter by language'),
    },
    async ({ owner, repo, query, limit, language }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const embeddingResult = await generateEmbedding(query);
        const results = await searchVectors(repoData.id, embeddingResult.embedding, {
          limit: limit ?? 10,
          filter: language ? { language } : undefined,
        });
        const data = results.map((r) => ({
          score: r.score,
          file_path: r.payload.filePath,
          language: r.payload.language,
          content: r.payload.content,
          start_line: r.payload.startLine ?? null,
          end_line: r.payload.endLine ?? null,
          symbol_name: r.payload.symbolName ?? null,
          symbol_kind: r.payload.symbolKind ?? null,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Search error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── search_symbols ──────────────────────────────────────────────────
  server.tool(
    'search_symbols',
    'Search for code symbols (functions, classes, etc.) by name in the knowledge graph',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      name: z.string().describe('Symbol name to search for (supports partial matches)'),
      kind: z.enum(['function', 'method', 'class', 'interface', 'type', 'variable']).optional()
        .describe('Filter by symbol kind'),
      limit: z.number().optional().describe('Max results (default 20)'),
    },
    async ({ owner, repo, name: symbolName, kind, limit }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const gm = await getGraphManager(repoData.id);
        let cypher = `MATCH (s:Symbol) WHERE s.name CONTAINS $name`;
        if (kind) {
          cypher += ` AND s.kind = $kind`;
        }
        cypher += ` RETURN s ORDER BY s.name LIMIT ${limit ?? 20}`;

        const params: Record<string, any> = { name: symbolName };
        if (kind) params.kind = kind;

        const results = await gm.query(cypher, params);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Search error: ${err.message}` }], isError: true };
      }
    },
  );
}
