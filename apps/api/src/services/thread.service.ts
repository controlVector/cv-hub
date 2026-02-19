import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import {
  workflowThreads,
  threadSegments,
  threadSegmentEdges,
  contextBridges,
  type WorkflowThread,
  type ThreadSegment,
  type ThreadSegmentEdge,
  type ContextBridge,
  type ContextSnapshot,
  type BridgePayload,
} from '../db/schema';

// ==================== Thread CRUD ====================

export async function createThread(params: {
  userId: string;
  title: string;
  description?: string;
  repositoryId?: string;
  metadata?: Record<string, unknown>;
}): Promise<WorkflowThread> {
  const [thread] = await db
    .insert(workflowThreads)
    .values({
      userId: params.userId,
      title: params.title,
      description: params.description,
      repositoryId: params.repositoryId,
      status: 'active',
      metadata: params.metadata,
    })
    .returning();

  return thread;
}

export async function getThread(
  threadId: string,
  userId: string,
): Promise<WorkflowThread | undefined> {
  return db.query.workflowThreads.findFirst({
    where: and(
      eq(workflowThreads.id, threadId),
      eq(workflowThreads.userId, userId),
    ),
  });
}

export async function listThreads(params: {
  userId: string;
  status?: string;
  repositoryId?: string;
  limit?: number;
}): Promise<WorkflowThread[]> {
  const conditions = [eq(workflowThreads.userId, params.userId)];

  if (params.status) {
    conditions.push(eq(workflowThreads.status, params.status as any));
  }

  if (params.repositoryId) {
    conditions.push(eq(workflowThreads.repositoryId, params.repositoryId));
  }

  return db.query.workflowThreads.findMany({
    where: and(...conditions),
    orderBy: [desc(workflowThreads.updatedAt)],
    limit: params.limit || 20,
  });
}

export async function updateThreadStatus(
  threadId: string,
  userId: string,
  status: 'active' | 'paused' | 'completed' | 'archived',
): Promise<WorkflowThread | null> {
  const [updated] = await db
    .update(workflowThreads)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(workflowThreads.id, threadId),
        eq(workflowThreads.userId, userId),
      ),
    )
    .returning();

  return updated || null;
}

// ==================== Segments ====================

export async function addSegment(params: {
  threadId: string;
  userId: string;
  platform: 'claude_ai' | 'claude_code' | 'cv_hub_api';
  segmentType?: 'planning' | 'execution' | 'review' | 'research' | 'debugging';
  title?: string;
  summary?: string;
  sessionIdentifier?: string;
  contextSnapshot?: ContextSnapshot;
  toolsUsed?: string[];
  filesModified?: string[];
  metadata?: Record<string, unknown>;
  previousSegmentId?: string;
  edgeType?: 'continuation' | 'fork' | 'merge' | 'handoff';
}): Promise<ThreadSegment> {
  // Verify thread ownership
  const thread = await getThread(params.threadId, params.userId);
  if (!thread) {
    throw new Error('Thread not found');
  }

  const [segment] = await db
    .insert(threadSegments)
    .values({
      threadId: params.threadId,
      platform: params.platform,
      segmentType: params.segmentType || 'execution',
      title: params.title,
      summary: params.summary,
      sessionIdentifier: params.sessionIdentifier,
      contextSnapshot: params.contextSnapshot,
      toolsUsed: params.toolsUsed,
      filesModified: params.filesModified,
      startedAt: new Date(),
      metadata: params.metadata,
    })
    .returning();

  // Increment segment count
  await db
    .update(workflowThreads)
    .set({
      totalSegments: thread.totalSegments + 1,
      updatedAt: new Date(),
    })
    .where(eq(workflowThreads.id, params.threadId));

  // Create edge from previous segment if specified
  if (params.previousSegmentId) {
    await db.insert(threadSegmentEdges).values({
      threadId: params.threadId,
      fromSegmentId: params.previousSegmentId,
      toSegmentId: segment.id,
      edgeType: params.edgeType || 'continuation',
    });
  }

  return segment;
}

export async function endSegment(params: {
  segmentId: string;
  threadId: string;
  userId: string;
  summary?: string;
  resultSnapshot?: ContextSnapshot;
  filesModified?: string[];
  toolsUsed?: string[];
}): Promise<ThreadSegment | null> {
  // Verify thread ownership
  const thread = await getThread(params.threadId, params.userId);
  if (!thread) return null;

  const updates: Record<string, unknown> = {
    endedAt: new Date(),
    updatedAt: new Date(),
  };

  if (params.summary) updates.summary = params.summary;
  if (params.resultSnapshot) updates.resultSnapshot = params.resultSnapshot;
  if (params.filesModified) updates.filesModified = params.filesModified;
  if (params.toolsUsed) updates.toolsUsed = params.toolsUsed;

  const [updated] = await db
    .update(threadSegments)
    .set(updates)
    .where(
      and(
        eq(threadSegments.id, params.segmentId),
        eq(threadSegments.threadId, params.threadId),
      ),
    )
    .returning();

  return updated || null;
}

export async function getThreadSegments(
  threadId: string,
  userId: string,
): Promise<ThreadSegment[]> {
  const thread = await getThread(threadId, userId);
  if (!thread) return [];

  return db.query.threadSegments.findMany({
    where: eq(threadSegments.threadId, threadId),
    orderBy: [desc(threadSegments.createdAt)],
  });
}

// ==================== Context Bridges ====================

export async function createBridge(params: {
  threadId: string;
  userId: string;
  fromSegmentId: string;
  toSegmentId?: string;
  bridgeType?: 'task_dispatch' | 'result_return' | 'context_share' | 'handoff';
  contextPayload: BridgePayload;
  expiresInMinutes?: number;
}): Promise<ContextBridge> {
  // Verify thread ownership
  const thread = await getThread(params.threadId, params.userId);
  if (!thread) {
    throw new Error('Thread not found');
  }

  const expiresAt = params.expiresInMinutes
    ? new Date(Date.now() + params.expiresInMinutes * 60 * 1000)
    : new Date(Date.now() + 24 * 60 * 60 * 1000); // Default 24h

  const [bridge] = await db
    .insert(contextBridges)
    .values({
      threadId: params.threadId,
      fromSegmentId: params.fromSegmentId,
      toSegmentId: params.toSegmentId,
      bridgeType: params.bridgeType || 'context_share',
      contextPayload: params.contextPayload,
      status: 'pending',
      expiresAt,
    })
    .returning();

  // If linking to an existing segment, create an edge too
  if (params.toSegmentId) {
    await db.insert(threadSegmentEdges).values({
      threadId: params.threadId,
      fromSegmentId: params.fromSegmentId,
      toSegmentId: params.toSegmentId,
      edgeType: 'handoff',
      bridgeId: bridge.id,
    });
  }

  return bridge;
}

export async function acceptBridge(
  bridgeId: string,
  toSegmentId: string,
  threadId: string,
  userId: string,
): Promise<ContextBridge | null> {
  const thread = await getThread(threadId, userId);
  if (!thread) return null;

  const [updated] = await db
    .update(contextBridges)
    .set({
      toSegmentId,
      status: 'accepted',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contextBridges.id, bridgeId),
        eq(contextBridges.threadId, threadId),
      ),
    )
    .returning();

  if (updated) {
    // Create an edge for the bridge
    await db.insert(threadSegmentEdges).values({
      threadId,
      fromSegmentId: updated.fromSegmentId,
      toSegmentId,
      edgeType: 'handoff',
      bridgeId: updated.id,
    });
  }

  return updated || null;
}

export async function getPendingBridges(
  threadId: string,
  userId: string,
): Promise<ContextBridge[]> {
  const thread = await getThread(threadId, userId);
  if (!thread) return [];

  return db.query.contextBridges.findMany({
    where: and(
      eq(contextBridges.threadId, threadId),
      eq(contextBridges.status, 'pending'),
    ),
    orderBy: [desc(contextBridges.createdAt)],
  });
}

// ==================== Thread Summary ====================

export interface ThreadSummary {
  thread: WorkflowThread;
  segments: {
    id: string;
    platform: string;
    segmentType: string;
    title: string | null;
    summary: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
    filesModified: string[] | null;
    toolsUsed: string[] | null;
  }[];
  edges: {
    from: string;
    to: string;
    type: string;
  }[];
  pendingBridges: {
    id: string;
    bridgeType: string;
    summary: string | undefined;
    fromSegmentId: string;
  }[];
}

export async function getThreadSummary(
  threadId: string,
  userId: string,
): Promise<ThreadSummary | null> {
  const thread = await getThread(threadId, userId);
  if (!thread) return null;

  const segments = await db.query.threadSegments.findMany({
    where: eq(threadSegments.threadId, threadId),
    orderBy: [threadSegments.createdAt],
  });

  const edges = await db.query.threadSegmentEdges.findMany({
    where: eq(threadSegmentEdges.threadId, threadId),
  });

  const bridges = await db.query.contextBridges.findMany({
    where: and(
      eq(contextBridges.threadId, threadId),
      eq(contextBridges.status, 'pending'),
    ),
  });

  return {
    thread,
    segments: segments.map((s) => ({
      id: s.id,
      platform: s.platform,
      segmentType: s.segmentType,
      title: s.title,
      summary: s.summary,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      filesModified: s.filesModified,
      toolsUsed: s.toolsUsed,
    })),
    edges: edges.map((e) => ({
      from: e.fromSegmentId,
      to: e.toSegmentId,
      type: e.edgeType,
    })),
    pendingBridges: bridges.map((b) => ({
      id: b.id,
      bridgeType: b.bridgeType,
      summary: b.contextPayload?.summary,
      fromSegmentId: b.fromSegmentId,
    })),
  };
}
