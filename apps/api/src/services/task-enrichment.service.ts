/**
 * Task Enrichment Service
 * Injects manifold context, code intelligence, and recent task history
 * into task prompts before dispatch to the executor.
 */

import { eq, desc, and, inArray } from 'drizzle-orm';
import { db } from '../db';
import { contextVersions, agentTasks, taskEvents } from '../db/schema';
import { getFocusedContext } from './context-engine.service';

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

  const nodes = latest.nodes as Array<Record<string, unknown>>;
  const decisions = nodes.filter((n) => n.type === 'decision' && n.status !== 'archived');
  const constraints = nodes.filter((n) => n.type === 'constraint' && n.status !== 'archived');
  const architecture = nodes.filter((n) => n.type === 'architecture' && n.status !== 'archived');

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
