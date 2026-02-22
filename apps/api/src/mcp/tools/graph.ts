/**
 * MCP Tools: Knowledge Graph
 * Exposes FalkorDB graph query and analysis to AI agents via MCP
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';
import { getGraphManager } from '../../services/graph/graph.service';

/** Block write operations in user-supplied Cypher */
const WRITE_KEYWORDS = /\b(DELETE|CREATE|MERGE|SET|REMOVE|DROP|DETACH)\b/i;

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerGraphTools(
  server: McpServer,
  userId: string,
  scopes: string[],
) {
  const hasRead = scopes.includes('repo:read');

  // ── query_graph ─────────────────────────────────────────────────────
  server.tool(
    'query_graph',
    'Execute a read-only Cypher query against a repository knowledge graph',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      cypher: z.string().describe('Cypher query (read-only — no CREATE/DELETE/SET/etc.)'),
    },
    async ({ owner, repo, cypher }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      if (WRITE_KEYWORDS.test(cypher)) {
        return { content: [{ type: 'text', text: 'Write operations are not allowed in graph queries' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const gm = await getGraphManager(repoData.id);
        const results = await gm.query(cypher);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Graph query error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_symbol ──────────────────────────────────────────────────────
  server.tool(
    'get_symbol',
    'Get detailed information about a code symbol including its callers and callees',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      qualified_name: z.string().describe('Fully qualified symbol name'),
    },
    async ({ owner, repo, qualified_name }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const gm = await getGraphManager(repoData.id);
        const usage = await gm.getSymbolUsage(qualified_name);
        if (!usage) {
          return { content: [{ type: 'text', text: 'Symbol not found' }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(usage, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── find_callers ────────────────────────────────────────────────────
  server.tool(
    'find_callers',
    'Find all symbols that call a given function/method',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      qualified_name: z.string().describe('Fully qualified name of the target symbol'),
    },
    async ({ owner, repo, qualified_name }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const gm = await getGraphManager(repoData.id);
        const results = await gm.getCallers(qualified_name);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── find_callees ────────────────────────────────────────────────────
  server.tool(
    'find_callees',
    'Find all functions/methods called by a given symbol',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      qualified_name: z.string().describe('Fully qualified name of the source symbol'),
    },
    async ({ owner, repo, qualified_name }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const gm = await getGraphManager(repoData.id);
        const results = await gm.getCallees(qualified_name);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── find_call_paths ─────────────────────────────────────────────────
  server.tool(
    'find_call_paths',
    'Find call paths between two symbols in the code graph',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      from: z.string().describe('Source symbol name or qualified name'),
      to: z.string().describe('Target symbol name or qualified name'),
      max_depth: z.number().optional().describe('Max path depth (default 10)'),
    },
    async ({ owner, repo, from: fromSymbol, to: toSymbol, max_depth }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const gm = await getGraphManager(repoData.id);
        const results = await gm.findCallPaths(fromSymbol, toSymbol, max_depth ?? 10);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── find_dead_code ──────────────────────────────────────────────────
  server.tool(
    'find_dead_code',
    'Find potentially unused functions/methods with no callers',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
    },
    async ({ owner, repo }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const gm = await getGraphManager(repoData.id);
        const symbols = await gm.findDeadCode();
        const data = symbols.map((s) => ({
          name: s.name,
          qualified_name: s.qualifiedName,
          kind: s.kind,
          file: s.file,
          start_line: s.startLine,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── complexity_hotspots ─────────────────────────────────────────────
  server.tool(
    'complexity_hotspots',
    'Find functions/methods with the highest cyclomatic complexity',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      threshold: z.number().optional().describe('Min complexity to include (default 10)'),
    },
    async ({ owner, repo, threshold }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const gm = await getGraphManager(repoData.id);
        const symbols = await gm.findComplexityHotspots(threshold ?? 10);
        const data = symbols.map((s) => ({
          name: s.name,
          qualified_name: s.qualifiedName,
          complexity: s.complexity,
          file: s.file,
          start_line: s.startLine,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── graph_stats ─────────────────────────────────────────────────────
  server.tool(
    'graph_stats',
    'Get statistics about a repository knowledge graph (node/edge counts)',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
    },
    async ({ owner, repo }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }
      try {
        const gm = await getGraphManager(repoData.id);
        const stats = await gm.getStats();
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );
}
