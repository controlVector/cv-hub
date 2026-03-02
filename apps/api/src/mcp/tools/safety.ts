/**
 * MCP Tools: Safety Analysis (CV-Safe)
 * Composes existing graph queries into safety-oriented reports.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAnnotations } from './annotations';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';
import { getGraphManager } from '../../services/graph/graph.service';

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerSafetyTools(
  server: McpServer,
  userId: string,
  scopes: string[],
) {
  const hasRead = scopes.includes('repo:read');

  // ── cv_safety_check ─────────────────────────────────────────────────
  server.tool(
    'cv_safety_check',
    'Run a safety analysis on a repository: dead code, complexity hotspots, and dependency risks',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
      complexity_threshold: z.number().optional().describe('Min complexity to flag (default 10)'),
    },
    getAnnotations('cv_safety_check'),
    async ({ owner, repo, complexity_threshold }) => {
      if (!hasRead) {
        return { content: [{ type: 'text', text: 'Insufficient scope: repo:read required' }], isError: true };
      }
      const repoData = await resolveRepo(owner, repo, userId);
      if (!repoData) {
        return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
      }

      try {
        const gm = await getGraphManager(repoData.id);

        const [deadCode, hotspots, stats] = await Promise.all([
          gm.findDeadCode(),
          gm.findComplexityHotspots(complexity_threshold ?? 10),
          gm.getStats(),
        ]);

        // Build markdown report
        const lines: string[] = [
          `# Safety Report: ${owner}/${repo}`,
          '',
          `## Overview`,
          `- **Files:** ${stats.fileCount}`,
          `- **Symbols:** ${stats.symbolCount}`,
          `- **Functions:** ${stats.functionCount}`,
          `- **Relationships:** ${stats.relationshipCount}`,
          '',
        ];

        // Dead code section
        lines.push(`## Potentially Unused Code (${deadCode.length} symbols)`);
        if (deadCode.length === 0) {
          lines.push('No dead code detected.');
        } else {
          for (const s of deadCode.slice(0, 20)) {
            lines.push(`- \`${s.qualifiedName || s.name}\` (${s.kind}) in \`${s.file}:${s.startLine}\``);
          }
          if (deadCode.length > 20) {
            lines.push(`- ... and ${deadCode.length - 20} more`);
          }
        }
        lines.push('');

        // Complexity hotspots
        lines.push(`## Complexity Hotspots (${hotspots.length} symbols)`);
        if (hotspots.length === 0) {
          lines.push('No complexity hotspots detected.');
        } else {
          for (const s of hotspots.slice(0, 15)) {
            lines.push(`- \`${s.qualifiedName || s.name}\` — complexity ${s.complexity} in \`${s.file}:${s.startLine}\``);
          }
        }
        lines.push('');

        // Risk summary
        const riskLevel = deadCode.length > 20 || hotspots.length > 10 ? 'HIGH' :
                          deadCode.length > 5 || hotspots.length > 3 ? 'MEDIUM' : 'LOW';
        lines.push(`## Risk Level: **${riskLevel}**`);

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Safety check error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── cv_architecture_review ──────────────────────────────────────────
  server.tool(
    'cv_architecture_review',
    'Analyze repository architecture: module dependencies, file structure, and potential issues',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository slug'),
    },
    getAnnotations('cv_architecture_review'),
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

        // Run multiple graph queries to build architecture report
        const [stats, circularImports, orphanFiles, highFanOut] = await Promise.all([
          gm.getStats(),
          // Circular imports: A imports B and B imports A
          gm.query(`
            MATCH (a:File)-[:IMPORTS]->(b:File)-[:IMPORTS]->(a)
            WHERE a.path < b.path
            RETURN a.path AS fileA, b.path AS fileB
            LIMIT 20
          `),
          // Orphan files: no incoming or outgoing imports
          gm.query(`
            MATCH (f:File)
            WHERE NOT (f)-[:IMPORTS]->() AND NOT ()-[:IMPORTS]->(f)
              AND NOT f.path ENDS WITH '.json'
              AND NOT f.path ENDS WITH '.md'
            RETURN f.path AS path, f.language AS language
            LIMIT 30
          `),
          // High fan-out: files that import many others
          gm.query(`
            MATCH (f:File)-[:IMPORTS]->(dep:File)
            WITH f, count(dep) AS depCount
            WHERE depCount > 10
            RETURN f.path AS path, depCount
            ORDER BY depCount DESC
            LIMIT 15
          `),
        ]);

        const lines: string[] = [
          `# Architecture Review: ${owner}/${repo}`,
          '',
          `## Codebase Stats`,
          `- Files: ${stats.fileCount}`,
          `- Modules: ${stats.moduleCount}`,
          `- Classes: ${stats.classCount}`,
          `- Functions: ${stats.functionCount}`,
          `- Commits: ${stats.commitCount}`,
          '',
        ];

        // Circular imports
        lines.push(`## Circular Imports (${circularImports.length} pairs)`);
        if (circularImports.length === 0) {
          lines.push('No circular imports detected.');
        } else {
          for (const r of circularImports) {
            lines.push(`- \`${r.fileA}\` <-> \`${r.fileB}\``);
          }
        }
        lines.push('');

        // Orphan files
        lines.push(`## Orphan Files (${orphanFiles.length} files)`);
        if (orphanFiles.length === 0) {
          lines.push('No orphan files detected.');
        } else {
          for (const r of orphanFiles) {
            lines.push(`- \`${r.path}\` (${r.language || 'unknown'})`);
          }
        }
        lines.push('');

        // High fan-out
        lines.push(`## High Fan-Out Files`);
        if (highFanOut.length === 0) {
          lines.push('No high fan-out files detected.');
        } else {
          for (const r of highFanOut) {
            lines.push(`- \`${r.path}\` — ${r.depCount} imports`);
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Architecture review error: ${err.message}` }], isError: true };
      }
    },
  );
}
