/**
 * Task Enrichment Service
 * Injects manifold context, code intelligence, and recent task history
 * into task prompts before dispatch to the executor.
 */

import { eq, desc, and, inArray } from 'drizzle-orm';
import { db } from '../db';
import { contextVersions, agentTasks, taskEvents } from '../db/schema';
import { getFocusedContext } from './context-engine.service';
import { getGraphManager } from './graph/graph.service';

// ==================== Enrichment ====================

export async function enrichTaskPrompt(params: {
  repositoryId?: string;
  description?: string;
  filePaths?: string[];
  userId: string;
}): Promise<string> {
  const sections: string[] = [];

  // 1. Context Manifold: Get latest snapshot for the repo
  if (params.repositoryId) {
    try {
      const manifoldContext = await getManifoldContext(params.repositoryId);
      if (manifoldContext) {
        sections.push(manifoldContext);
      }
    } catch {
      // Non-fatal: enrichment failure shouldn't block dispatch
    }
  }

  // 2. Code Intelligence: Get focused context for relevant files
  if (params.repositoryId && params.filePaths?.length) {
    try {
      const codeContext = await getCodeContext(params.repositoryId, params.filePaths);
      if (codeContext) {
        sections.push(codeContext);
      }
    } catch {
      // Non-fatal
    }
  }

  // 3. Recent Task History: What was tried before in this repo
  if (params.repositoryId) {
    try {
      const history = await getRecentTaskHistory(params.repositoryId, params.userId);
      if (history) {
        sections.push(history);
      }
    } catch {
      // Non-fatal
    }
  }

  // 4. Structured output markers instruction
  sections.push(STRUCTURED_OUTPUT_INSTRUCTION);

  return sections.filter(Boolean).join('\n\n');
}

// ==================== Manifold Context ====================

async function getManifoldContext(repositoryId: string): Promise<string | null> {
  // Get the latest context version for this repo
  const [latest] = await db
    .select()
    .from(contextVersions)
    .where(eq(contextVersions.repositoryId, repositoryId))
    .orderBy(desc(contextVersions.createdAt))
    .limit(1);

  if (!latest || !Array.isArray(latest.nodes) || latest.nodes.length === 0) {
    return null;
  }

  const allNodes = latest.nodes as Array<Record<string, unknown>>;
  const activeNodes = allNodes.filter((n) => n.status !== 'archived');

  // Try to rank nodes using bandit scorer
  let ranked = activeNodes;
  try {
    ranked = await rankNodesByBandit(repositoryId, activeNodes);
  } catch {
    // Fall back to unranked
  }

  const decisions = ranked.filter((n) => n.type === 'decision');
  const constraints = ranked.filter((n) => n.type === 'constraint');
  const architecture = ranked.filter((n) => n.type === 'architecture');

  const parts: string[] = ['## Project Context (auto-injected from Context Manifold)'];

  if (decisions.length > 0) {
    parts.push('### Key Decisions');
    for (const d of decisions.slice(0, 5)) {
      parts.push(`- **${d.title}**: ${d.rationale || d.description || ''}`);
    }
  }

  if (constraints.length > 0) {
    parts.push('### Constraints');
    for (const c of constraints.slice(0, 3)) {
      parts.push(`- **${c.title}**: ${c.description || ''}`);
    }
  }

  if (architecture.length > 0) {
    parts.push('### Architecture');
    for (const a of architecture.slice(0, 3)) {
      parts.push(`- **${a.title}**: ${a.component || ''} — ${a.description || ''}`);
    }
  }

  return parts.length > 1 ? parts.join('\n') : null;
}

/**
 * Rank context nodes using the bandit state from FalkorDB.
 * Returns nodes sorted by predicted usefulness (highest first).
 */
async function rankNodesByBandit(
  repositoryId: string,
  nodes: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const graph = await getGraphManager(repositoryId);
  const state = await graph.loadBanditState();
  if (!state || !state.arms || Object.keys(state.arms).length === 0) {
    return nodes; // No bandit data yet
  }

  const DIMENSION = state.dimension ?? 8;
  // Default context vector for scoring (mid-session, moderate file count)
  const x = [0.5, 0.3, 0.5, 0.1, 0, 1, 1, 0.3];

  const scored = nodes.map((node) => {
    const nodeId = (node.id as string) || (node.title as string) || '';
    const arm = state.arms[nodeId];
    if (!arm || arm.pulls === 0) {
      return { node, score: 0.5 }; // neutral score for unknown nodes
    }

    // Simple score: average reward (skip full LinUCB for speed)
    const avgReward = arm.totalReward / arm.pulls;
    return { node, score: avgReward };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.node);
}

// ==================== Code Intelligence ====================

async function getCodeContext(
  repositoryId: string,
  filePaths: string[],
): Promise<string | null> {
  const result = await getFocusedContext(repositoryId, {
    files: filePaths,
    concern: 'codebase',
    max_tokens: 1500,
  });

  if (!result.markdown) return null;

  return `### Related Code\n${result.markdown}`;
}

// ==================== Recent Task History ====================

async function getRecentTaskHistory(
  repositoryId: string,
  userId: string,
): Promise<string | null> {
  // Get last 3 completed/failed tasks for this repo
  const recentTasks = await db.query.agentTasks.findMany({
    where: and(
      eq(agentTasks.repositoryId, repositoryId),
      eq(agentTasks.userId, userId),
      inArray(agentTasks.status, ['completed', 'failed']),
    ),
    orderBy: [desc(agentTasks.completedAt)],
    limit: 3,
  });

  if (recentTasks.length === 0) return null;

  const lines: string[] = ['### Recent History'];
  for (const t of recentTasks) {
    const status = t.status === 'completed' ? 'OK' : 'FAILED';
    lines.push(`- [${status}] ${t.title}`);
    if (t.error) {
      lines.push(`  Error: ${t.error.slice(0, 200)}`);
    }

    // Get last decision/error event from this task
    const lastEvent = await db.query.taskEvents.findFirst({
      where: and(
        eq(taskEvents.taskId, t.id),
        inArray(taskEvents.eventType, ['decision', 'error']),
      ),
      orderBy: [desc(taskEvents.createdAt)],
    });

    if (lastEvent) {
      const content = typeof lastEvent.content === 'string'
        ? lastEvent.content
        : (lastEvent.content as Record<string, unknown>)?.text as string ?? null;
      if (content) {
        lines.push(`  Last ${lastEvent.eventType}: ${content.slice(0, 150)}`);
      }
    }
  }

  return lines.join('\n');
}

// ==================== Structured Output Markers ====================

const STRUCTURED_OUTPUT_INSTRUCTION = `## Output Format

Emit structured markers so the planner can follow your progress:

[THINKING] <your reasoning about the approach>
[DECISION] <a choice you're making and why>
[QUESTION] <something you need the planner to answer — STOP and wait for response>
[PROGRESS] <what you've completed so far>

When you encounter a [QUESTION], output it and then STOP working until you receive a response. The response will appear as a new message from the user.`;
