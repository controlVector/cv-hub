/**
 * Bandit Feedback Service
 *
 * Processes task outcomes as bandit rewards.
 * When a task completes or fails, the context nodes that were injected
 * into its prompt receive a reward signal so the bandit learns which
 * nodes are most useful for each workflow context.
 */

import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db';
import { agentTasks, contextVersions, taskEvents } from '../db/schema';
import { getGraphManager } from './graph/graph.service';

// ==================== Reward Computation ====================

interface TaskOutcome {
  taskId: string;
  status: 'completed' | 'failed';
  repositoryId: string;
  /** Files that were part of the task input */
  filePaths: string[];
  /** Duration in seconds (null if unknown) */
  durationSeconds: number | null;
  /** Number of files modified by the task */
  filesModified: number;
  /** Whether the task had errors during execution */
  hadErrors: boolean;
}

/**
 * Compute a reward in [0, 1] for a task outcome.
 *
 * Factors:
 * - Completion: completed=0.6 base, failed=0.0
 * - Speed bonus: if faster than 5 minutes, up to +0.2
 * - Output bonus: if files were modified, up to +0.2
 * - Error penalty: if errors were encountered, -0.1
 */
function computeReward(outcome: TaskOutcome): number {
  if (outcome.status === 'failed') return 0;

  let reward = 0.6;

  // Speed bonus (< 300s = 5 min gives up to +0.2)
  if (outcome.durationSeconds != null && outcome.durationSeconds < 300) {
    reward += 0.2 * (1 - outcome.durationSeconds / 300);
  }

  // Output bonus (modified files = productive)
  if (outcome.filesModified > 0) {
    reward += Math.min(0.2, outcome.filesModified * 0.05);
  }

  // Error penalty
  if (outcome.hadErrors) {
    reward -= 0.1;
  }

  return Math.max(0, Math.min(1, reward));
}

// ==================== Bandit Context ====================

/**
 * Build a BanditContext vector from task metadata.
 * Must match the 8-dimensional BanditContext from cv-git.
 */
function buildBanditContext(params: {
  fileCount: number;
  taskIndex: number;
  totalTasks: number;
  errorRate: number;
}): Record<string, number> {
  return {
    phase: 0.5, // task dispatch is mid-workflow
    fileCount: Math.min(params.fileCount / 20, 1), // normalize to [0,1]
    sessionAge: params.totalTasks > 0 ? params.taskIndex / params.totalTasks : 0,
    errorRate: params.errorRate,
    phaseTransitions: 0,
    uniquePhases: 1,
    avgTurnLength: 1,
    concernDiversity: Math.min(params.fileCount / 5, 1),
  };
}

// ==================== Main Hook ====================

/**
 * Process a task outcome as bandit feedback.
 * Called fire-and-forget after task completion or failure.
 */
export async function processBanditFeedback(
  taskId: string,
  status: 'completed' | 'failed',
): Promise<void> {
  try {
    // 1. Load task details
    const task = await db.query.agentTasks.findFirst({
      where: eq(agentTasks.id, taskId),
    });

    if (!task || !task.repositoryId) return;

    // 2. Compute outcome metrics
    const durationSeconds = task.startedAt && task.completedAt
      ? (new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000
      : null;

    const result = task.result as Record<string, any> | null;
    const filesModified = result?.filesModified?.length ?? result?.files?.modified?.length ?? 0;

    // Check for error events
    const errorEvents = await db.query.taskEvents.findMany({
      where: and(
        eq(taskEvents.taskId, taskId),
        eq(taskEvents.eventType, 'error'),
      ),
    });

    const outcome: TaskOutcome = {
      taskId,
      status,
      repositoryId: task.repositoryId,
      filePaths: task.filePaths ?? [],
      durationSeconds,
      filesModified,
      hadErrors: errorEvents.length > 0,
    };

    // 3. Compute reward
    const reward = computeReward(outcome);

    // 4. Get context nodes that were injected into this task
    const contextNodeIds = await getInjectedNodeIds(task.repositoryId);
    if (contextNodeIds.length === 0) return;

    // 5. Count recent tasks for session context
    const recentTasks = await db.query.agentTasks.findMany({
      where: and(
        eq(agentTasks.repositoryId, task.repositoryId),
        eq(agentTasks.userId, task.userId),
      ),
      orderBy: [desc(agentTasks.createdAt)],
      limit: 20,
    });

    const completedTasks = recentTasks.filter(t => t.status === 'completed' || t.status === 'failed');
    const failedTasks = completedTasks.filter(t => t.status === 'failed');
    const errorRate = completedTasks.length > 0 ? failedTasks.length / completedTasks.length : 0;
    const taskIndex = recentTasks.findIndex(t => t.id === taskId);

    const banditCtx = buildBanditContext({
      fileCount: outcome.filePaths.length,
      taskIndex: Math.max(0, taskIndex),
      totalTasks: recentTasks.length,
      errorRate,
    });

    // 6. Update bandit state in graph
    const graph = await getGraphManager(task.repositoryId);

    // Load existing state
    const savedState = await graph.loadBanditState();

    // LinUCB update: for each context node, update A and b
    const DIMENSION = 8;
    const arms: Record<string, any> = savedState?.arms ?? {};
    const x = [
      banditCtx.phase,
      banditCtx.fileCount,
      banditCtx.sessionAge,
      banditCtx.errorRate,
      banditCtx.phaseTransitions,
      banditCtx.uniquePhases,
      banditCtx.avgTurnLength,
      banditCtx.concernDiversity,
    ];

    for (const nodeId of contextNodeIds) {
      if (!arms[nodeId]) {
        // Initialize arm with identity matrix and zero vector
        const A = new Array(DIMENSION * DIMENSION).fill(0);
        for (let i = 0; i < DIMENSION; i++) A[i * DIMENSION + i] = 1;
        arms[nodeId] = {
          nodeId,
          pulls: 0,
          totalReward: 0,
          A,
          b: new Array(DIMENSION).fill(0),
        };
      }

      const arm = arms[nodeId];

      // A += x * x^T
      for (let i = 0; i < DIMENSION; i++) {
        for (let j = 0; j < DIMENSION; j++) {
          arm.A[i * DIMENSION + j] += x[i] * x[j];
        }
      }

      // b += reward * x
      for (let i = 0; i < DIMENSION; i++) {
        arm.b[i] += reward * x[i];
      }

      arm.pulls++;
      arm.totalReward += reward;
    }

    // 7. Persist updated state
    await graph.saveBanditState({
      arms,
      alpha: savedState?.alpha ?? 1.0,
      dimension: savedState?.dimension ?? DIMENSION,
    });

  } catch (error) {
    // Bandit feedback is non-critical; log and continue
    console.warn('[BanditFeedback] Failed to process feedback:', error);
  }
}

// ==================== Helpers ====================

/**
 * Get the IDs of context nodes that were injected into the most recent
 * context version for this repository.
 */
async function getInjectedNodeIds(repositoryId: string): Promise<string[]> {
  const [latest] = await db
    .select()
    .from(contextVersions)
    .where(eq(contextVersions.repositoryId, repositoryId))
    .orderBy(desc(contextVersions.createdAt))
    .limit(1);

  if (!latest || !Array.isArray(latest.nodes)) return [];

  // Each node should have an id or title we can use as a bandit arm ID
  return (latest.nodes as Array<Record<string, unknown>>)
    .filter(n => n.status !== 'archived')
    .map(n => (n.id as string) || (n.title as string) || '')
    .filter(Boolean);
}
