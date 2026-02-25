/**
 * MCP Tools: Context Engine
 * On-demand context retrieval from the knowledge graph for Claude Code sessions.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';
import { getGraphManager } from '../../services/graph/graph.service';
import { getFocusedContext, type ContextConcern } from '../../services/context-engine.service';

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerContextEngineTools(
  server: McpServer,
  userId: string,
  scopes: string[],
) {
  const hasRead = scopes.includes('repo:read');

  // ── get_focused_context ───────────────────────────────────────────
  server.tool(
    'get_focused_context',
    'Get ranked relevant context from the knowledge graph for specific files, symbols, or a concern area. Returns summaries, co-change partners, callers/callees, and import neighbors scored by relevance.',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      files: z.array(z.string()).optional().describe('File paths to get context for'),
      symbols: z.array(z.string()).optional().describe('Symbol names or qualifiedNames to get context for'),
      concern: z.enum(['codebase', 'deployment', 'compilation', 'business']).optional().describe('Focus area for scoring weights (default: codebase)'),
      max_tokens: z.number().optional().describe('Token budget for response (default: 2000)'),
    },
    async ({ owner, repo, files, symbols, concern, max_tokens }) => {
      if (!hasRead) {
        return { content: [{ type: 'text' as const, text: 'Insufficient scope: repo:read required' }], isError: true };
      }

      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text' as const, text: 'Repository not found or access denied' }], isError: true };
      }

      if (!files?.length && !symbols?.length) {
        return { content: [{ type: 'text' as const, text: 'Provide at least one file or symbol to get context for' }], isError: true };
      }

      try {
        const graph = await getGraphManager(repoData.id);
        const result = await getFocusedContext(repoData.id, graph, {
          files,
          symbols,
          concern: concern as ContextConcern | undefined,
          max_tokens,
        });

        if (!result.markdown) {
          return { content: [{ type: 'text' as const, text: 'No relevant context found for the given files/symbols.' }] };
        }

        return {
          content: [{
            type: 'text' as const,
            text: result.markdown,
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  // ── get_impact_context ────────────────────────────────────────────
  server.tool(
    'get_impact_context',
    'Get blast-radius analysis for a file or symbol: callers (N hops), co-change partners, and import dependents. Useful before making changes to understand what might break.',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      target: z.string().describe('File path or symbol qualifiedName to analyze'),
      depth: z.number().min(1).max(5).optional().describe('How many hops to traverse for callers (default: 2)'),
    },
    async ({ owner, repo, target, depth }) => {
      if (!hasRead) {
        return { content: [{ type: 'text' as const, text: 'Insufficient scope: repo:read required' }], isError: true };
      }

      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text' as const, text: 'Repository not found or access denied' }], isError: true };
      }

      try {
        const graph = await getGraphManager(repoData.id);
        const hops = depth || 2;

        // Try as symbol first (impact analysis)
        const impact = await graph.getImpactAnalysis(target, hops);

        // Also get file dependents if it looks like a file path
        let fileDependents: any[] = [];
        if (target.includes('/') || target.includes('.')) {
          try {
            const deps = await graph.getFileDependents(target);
            fileDependents = deps.map((r: any) => r.dependent);
          } catch { /* not a file path */ }
        }

        const lines: string[] = [];
        lines.push(`## Impact Analysis: \`${target}\`\n`);

        if (impact.callers.length > 0) {
          lines.push(`### Callers (${impact.callers.length}, up to ${hops} hops)`);
          for (const c of impact.callers.slice(0, 20)) {
            const desc = c.file ? `${c.name} (${c.kind} in ${c.file})` : `${c.name} (${c.kind})`;
            lines.push(`- ${desc}`);
          }
          lines.push('');
        }

        if (impact.coChanged.length > 0) {
          lines.push(`### Co-Changed Symbols (${impact.coChanged.length})`);
          for (const cc of impact.coChanged.slice(0, 15)) {
            lines.push(`- ${cc.name} (${cc.kind} in ${cc.file}) — co-changed ${cc.coChangeCount}x`);
          }
          lines.push('');
        }

        if (fileDependents.length > 0) {
          lines.push(`### Import Dependents (${fileDependents.length})`);
          for (const d of fileDependents.slice(0, 15)) {
            lines.push(`- ${d.path || d}`);
          }
          lines.push('');
        }

        if (impact.callers.length === 0 && impact.coChanged.length === 0 && fileDependents.length === 0) {
          lines.push('No callers, co-change partners, or dependents found.');
        }

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n'),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );
}
