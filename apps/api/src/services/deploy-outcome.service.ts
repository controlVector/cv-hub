/**
 * Deploy Outcome Service
 *
 * When a task completes with deploy events, creates a Decision node
 * in the context manifold so future tasks know about deploy status.
 */

import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { agentTasks, taskEvents, contextVersions } from '../db/schema';

interface DeployDecisionNode {
  id: string;
  type: 'decision';
  title: string;
  description: string;
  rationale: string;
  status: 'active';
  createdAt: string;
  source: 'deploy-outcome';
}

/**
 * Check a completed task for deploy events and record a Decision node
 * in the context manifold if deploy activity was detected.
 *
 * Called fire-and-forget after task completion.
 */
export async function recordDeployOutcome(taskId: string): Promise<void> {
  try {
    // 1. Load task
    const task = await db.query.agentTasks.findFirst({
      where: eq(agentTasks.id, taskId),
    });
    if (!task || !task.repositoryId) return;

    // 2. Check for deploy-related events
    const deployEvents = await db.query.taskEvents.findMany({
      where: eq(taskEvents.taskId, taskId),
    });

    const deployProgress = deployEvents.filter((e) => {
      if (e.eventType !== 'progress' && e.eventType !== 'error') return false;
      const content = typeof e.content === 'string' ? e.content : (e.content as Record<string, unknown>)?.text;
      return typeof content === 'string' && content.startsWith('[deploy:');
    });

    if (deployProgress.length === 0) return;

    // 3. Determine deploy outcome from events
    const hasError = deployProgress.some((e) => e.eventType === 'error');
    const phases = new Set(
      deployProgress.map((e) => {
        const content = typeof e.content === 'string' ? e.content : (e.content as Record<string, unknown>)?.text as string;
        const match = content?.match(/\[deploy:(\w+)\]/);
        return match?.[1] ?? '';
      }).filter(Boolean),
    );

    const result = task.result as Record<string, any> | null;
    const summary = result?.summary ?? task.title;

    // 4. Create Decision node
    const decision: DeployDecisionNode = {
      id: `deploy-${taskId.slice(0, 8)}`,
      type: 'decision',
      title: `Deploy: ${task.title}`,
      description: `Task deployed via phases: ${[...phases].join(', ')}. ${hasError ? 'Encountered errors.' : 'Completed successfully.'}`,
      rationale: summary,
      status: 'active',
      createdAt: new Date().toISOString(),
      source: 'deploy-outcome',
    };

    // 5. Append to latest context version or create a new one
    const [latest] = await db
      .select()
      .from(contextVersions)
      .where(eq(contextVersions.repositoryId, task.repositoryId))
      .orderBy(desc(contextVersions.createdAt))
      .limit(1);

    if (latest) {
      const existingNodes = (latest.nodes as unknown[]) ?? [];
      // Remove any previous deploy decision for this task
      const filtered = existingNodes.filter(
        (n: any) => n.id !== decision.id,
      );
      filtered.push(decision);

      await db
        .update(contextVersions)
        .set({
          nodes: filtered,
          nodeCount: filtered.length,
        })
        .where(eq(contextVersions.id, latest.id));
    } else {
      // No context version yet — create one
      await db.insert(contextVersions).values({
        repositoryId: task.repositoryId,
        commitSha: 'HEAD',
        nodes: [decision],
        edges: [],
        nodeCount: 1,
        changesSummary: `Deploy outcome recorded: ${task.title}`,
      });
    }
  } catch (error) {
    console.warn('[DeployOutcome] Failed to record deploy outcome:', error);
  }
}
