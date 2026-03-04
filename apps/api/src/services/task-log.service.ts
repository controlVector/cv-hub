import { eq, desc, asc } from 'drizzle-orm';
import { db } from '../db';
import { taskLogs, type TaskLog } from '../db/schema';

// ==================== Create Log ====================

export async function createTaskLog(params: {
  taskId: string;
  logType?: 'lifecycle' | 'heartbeat' | 'progress' | 'git' | 'error' | 'info';
  message: string;
  details?: Record<string, unknown>;
  progressPct?: number;
}): Promise<TaskLog> {
  const [log] = await db
    .insert(taskLogs)
    .values({
      taskId: params.taskId,
      logType: params.logType || 'info',
      message: params.message,
      details: params.details,
      progressPct: params.progressPct,
    })
    .returning();

  return log;
}

// ==================== Query Logs ====================

export async function getTaskLogs(
  taskId: string,
  limit = 50,
): Promise<TaskLog[]> {
  return db.query.taskLogs.findMany({
    where: eq(taskLogs.taskId, taskId),
    orderBy: [asc(taskLogs.createdAt)],
    limit,
  });
}

export async function getRecentTaskLogs(
  taskId: string,
  limit = 5,
): Promise<TaskLog[]> {
  return db.query.taskLogs.findMany({
    where: eq(taskLogs.taskId, taskId),
    orderBy: [desc(taskLogs.createdAt)],
    limit,
  });
}
