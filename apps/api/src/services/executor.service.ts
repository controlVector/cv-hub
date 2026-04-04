import { eq, and, desc, ilike, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  agentExecutors,
  type AgentExecutor,
  type ExecutorCapabilities,
} from '../db/schema';
import { generateSecureToken } from '../utils/crypto';

// ==================== Registration ====================

export async function registerExecutor(params: {
  userId: string;
  name: string;
  machineName?: string;
  type?: 'claude_code' | 'cv_git' | 'custom';
  capabilities?: ExecutorCapabilities;
  workspaceRoot?: string;
  repos?: string[];
  organizationId?: string;
  repositoryId?: string;
  role?: string;
  dispatchGuard?: string;
  integration?: Record<string, unknown>;
  tags?: string[];
  ownerProject?: string;
}): Promise<{ executor: AgentExecutor; registrationToken: string }> {
  // Upsert: if machineName is provided, reuse existing executor for same user+machine
  if (params.machineName) {
    const existing = await db.query.agentExecutors.findFirst({
      where: and(
        eq(agentExecutors.userId, params.userId),
        eq(agentExecutors.machineName, params.machineName),
      ),
    });

    if (existing) {
      const [updated] = await db
        .update(agentExecutors)
        .set({
          name: params.name,
          status: 'online',
          capabilities: params.capabilities,
          workspaceRoot: params.workspaceRoot,
          repos: params.repos,
          organizationId: params.organizationId ?? existing.organizationId,
          repositoryId: params.repositoryId ?? existing.repositoryId,
          role: params.role ?? existing.role,
          dispatchGuard: params.dispatchGuard ?? existing.dispatchGuard,
          integration: (params.integration ?? existing.integration) as any,
          tags: (params.tags ?? existing.tags) as any,
          ownerProject: params.ownerProject ?? existing.ownerProject,
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agentExecutors.id, existing.id))
        .returning();

      return {
        executor: updated,
        registrationToken: existing.registrationToken ?? generateSecureToken(32),
      };
    }
  }

  // New executor — insert
  const registrationToken = generateSecureToken(32);

  const [executor] = await db
    .insert(agentExecutors)
    .values({
      userId: params.userId,
      name: params.name,
      machineName: params.machineName,
      type: params.type || 'claude_code',
      status: 'online',
      capabilities: params.capabilities,
      workspaceRoot: params.workspaceRoot,
      repos: params.repos,
      organizationId: params.organizationId,
      repositoryId: params.repositoryId,
      role: params.role,
      dispatchGuard: params.dispatchGuard,
      integration: params.integration as any,
      tags: params.tags as any,
      ownerProject: params.ownerProject,
      registrationToken,
      lastHeartbeatAt: new Date(),
    })
    .returning();

  return { executor, registrationToken };
}

// ==================== Lookup ====================

export async function getExecutor(
  executorId: string,
  userId: string,
): Promise<AgentExecutor | undefined> {
  return db.query.agentExecutors.findFirst({
    where: and(
      eq(agentExecutors.id, executorId),
      eq(agentExecutors.userId, userId),
    ),
  });
}

export async function getExecutorByToken(
  registrationToken: string,
): Promise<AgentExecutor | undefined> {
  return db.query.agentExecutors.findFirst({
    where: eq(agentExecutors.registrationToken, registrationToken),
  });
}

export async function listExecutors(
  userId: string,
): Promise<AgentExecutor[]> {
  return db.query.agentExecutors.findMany({
    where: eq(agentExecutors.userId, userId),
    orderBy: [desc(agentExecutors.lastHeartbeatAt)],
  });
}

export async function findExecutorByMachineName(
  userId: string,
  machineName: string,
): Promise<AgentExecutor | null> {
  const executor = await db.query.agentExecutors.findFirst({
    where: and(
      eq(agentExecutors.userId, userId),
      ilike(agentExecutors.machineName, machineName),
    ),
    orderBy: [desc(agentExecutors.lastHeartbeatAt)],
  });
  return executor ?? null;
}

export async function listExecutorsFiltered(
  userId: string,
  opts?: { status?: 'online' | 'offline' | 'all' },
): Promise<AgentExecutor[]> {
  const conditions = [eq(agentExecutors.userId, userId)];
  if (opts?.status && opts.status !== 'all') {
    conditions.push(eq(agentExecutors.status, opts.status));
  }
  return db.query.agentExecutors.findMany({
    where: and(...conditions),
    orderBy: [desc(agentExecutors.lastHeartbeatAt)],
  });
}

// ==================== Heartbeat & Status ====================

export async function heartbeat(
  executorId: string,
  userId: string,
): Promise<AgentExecutor | null> {
  const [updated] = await db
    .update(agentExecutors)
    .set({
      lastHeartbeatAt: new Date(),
      status: 'online',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentExecutors.id, executorId),
        eq(agentExecutors.userId, userId),
      ),
    )
    .returning();

  return updated || null;
}

export async function updateExecutorStatus(
  executorId: string,
  userId: string,
  status: 'online' | 'offline' | 'busy' | 'error',
): Promise<AgentExecutor | null> {
  const [updated] = await db
    .update(agentExecutors)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentExecutors.id, executorId),
        eq(agentExecutors.userId, userId),
      ),
    )
    .returning();

  return updated || null;
}

export async function markExecutorTaskComplete(
  executorId: string,
  userId?: string,
): Promise<void> {
  const conditions = [eq(agentExecutors.id, executorId)];
  if (userId) conditions.push(eq(agentExecutors.userId, userId));

  await db
    .update(agentExecutors)
    .set({
      status: 'online',
      lastTaskAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions));
}

// ==================== Update (rename) ====================

export async function updateExecutor(
  executorId: string,
  userId: string,
  updates: { name?: string; machineName?: string },
): Promise<AgentExecutor | null> {
  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) setClause.name = updates.name;
  if (updates.machineName !== undefined) setClause.machineName = updates.machineName;

  const [updated] = await db
    .update(agentExecutors)
    .set(setClause)
    .where(
      and(
        eq(agentExecutors.id, executorId),
        eq(agentExecutors.userId, userId),
      ),
    )
    .returning();

  return updated || null;
}

// ==================== Sweep Stale Executors ====================

/**
 * Mark executors as offline if their last heartbeat exceeds the threshold.
 * Returns the number of executors marked offline.
 */
export async function sweepStaleExecutors(
  staleThresholdMinutes: number = 5,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleThresholdMinutes * 60 * 1000);

  const result = await db
    .update(agentExecutors)
    .set({
      status: 'offline',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentExecutors.status, 'online'),
        sql`${agentExecutors.lastHeartbeatAt} < ${cutoff}`,
      ),
    )
    .returning({ id: agentExecutors.id });

  return result.length;
}

// ==================== Unregister ====================

export async function unregisterExecutor(
  executorId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(agentExecutors)
    .where(
      and(
        eq(agentExecutors.id, executorId),
        eq(agentExecutors.userId, userId),
      ),
    )
    .returning({ id: agentExecutors.id });

  return result.length > 0;
}
