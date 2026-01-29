/**
 * Job Dispatch Service
 * Manages CI/CD job queues via BullMQ
 */

import { Queue, Worker, Job } from 'bullmq';
import { db } from '../../db';
import { pipelineRuns, pipelineJobs } from '../../db/schema/ci-cd';
import type { PipelineRun, PipelineJob, StepResult as SchemaStepResult } from '../../db/schema/ci-cd';
import { eq, and, or } from 'drizzle-orm';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { getReadyJobs, updateJobStatus, updatePipelineRunStatus } from './pipeline.service';

// Type aliases for status values
type JobStatus = 'pending' | 'queued' | 'running' | 'success' | 'failure' | 'cancelled' | 'skipped';
type PipelineRunStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out';

// Queue names
const PIPELINE_ORCHESTRATION_QUEUE = 'ci-pipeline-orchestration';
const JOB_EXECUTION_QUEUE = 'ci-job-execution';

// Job data interfaces
export interface PipelineOrchestrationJobData {
  runId: string;
  action: 'start' | 'check_completion' | 'cancel';
}

export interface JobExecutionJobData {
  jobId: string;
  runId: string;
  repositoryId: string;
  jobKey: string;
  containerImage: string;
  steps: JobStep[];
  environment: Record<string, string>;
  workspaceConfig: WorkspaceConfig;
}

export interface JobStep {
  name: string;
  uses?: string;
  run?: string;
  with?: Record<string, any>;
  env?: Record<string, string>;
  workingDirectory?: string;
  continueOnError?: boolean;
  timeout?: number;
}

export interface WorkspaceConfig {
  ownerSlug: string;
  repoSlug: string;
  ref: string;
  sha: string;
}

// Job result interfaces
export interface PipelineOrchestrationResult {
  status: 'dispatched' | 'completed' | 'cancelled' | 'waiting';
  jobsDispatched?: number;
  message?: string;
}

export interface JobExecutionResult {
  status: JobStatus;
  exitCode?: number;
  durationMs: number;
  stepResults: StepResult[];
  outputs?: Record<string, string>;
  error?: string;
}

export interface StepResult {
  name: string;
  status: 'success' | 'failure' | 'skipped' | 'cancelled';
  exitCode?: number;
  durationMs: number;
  output?: string;
  error?: string;
  startedAt: string;
  completedAt: string;
}

// Queue instances (singletons)
let orchestrationQueue: Queue<PipelineOrchestrationJobData, PipelineOrchestrationResult> | null = null;
let executionQueue: Queue<JobExecutionJobData, JobExecutionResult> | null = null;

// Workers
let orchestrationWorker: Worker<PipelineOrchestrationJobData, PipelineOrchestrationResult> | null = null;
let executionWorker: Worker<JobExecutionJobData, JobExecutionResult> | null = null;

/**
 * Get Redis connection config
 */
function getRedisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379'),
    password: url.password || undefined,
  };
}

/**
 * Get or create the pipeline orchestration queue
 */
export function getOrchestrationQueue(): Queue<PipelineOrchestrationJobData, PipelineOrchestrationResult> {
  if (!orchestrationQueue) {
    orchestrationQueue = new Queue<PipelineOrchestrationJobData, PipelineOrchestrationResult>(
      PIPELINE_ORCHESTRATION_QUEUE,
      {
        connection: getRedisConnection(),
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: {
            age: 24 * 60 * 60,
            count: 500,
          },
          removeOnFail: {
            age: 7 * 24 * 60 * 60,
          },
        },
      }
    );
  }
  return orchestrationQueue;
}

/**
 * Get or create the job execution queue
 */
export function getExecutionQueue(): Queue<JobExecutionJobData, JobExecutionResult> {
  if (!executionQueue) {
    executionQueue = new Queue<JobExecutionJobData, JobExecutionResult>(JOB_EXECUTION_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 10000,
        },
        removeOnComplete: {
          age: 24 * 60 * 60,
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 60 * 60,
        },
      },
    });
  }
  return executionQueue;
}

/**
 * Enqueue a pipeline run for orchestration
 */
export async function enqueuePipelineRun(runId: string): Promise<string> {
  const queue = getOrchestrationQueue();

  const job = await queue.add(
    `orchestrate-${runId}`,
    {
      runId,
      action: 'start',
    },
    {
      jobId: `orch-${runId}`,
      priority: 5,
    }
  );

  logger.info('ci', 'Pipeline run enqueued for orchestration', { runId, jobId: job.id });
  return job.id!;
}

/**
 * Enqueue a check for pipeline completion
 */
export async function enqueueCompletionCheck(runId: string, delay = 1000): Promise<void> {
  const queue = getOrchestrationQueue();

  await queue.add(
    `check-completion-${runId}`,
    {
      runId,
      action: 'check_completion',
    },
    {
      delay,
      jobId: `check-${runId}-${Date.now()}`,
    }
  );
}

/**
 * Enqueue pipeline cancellation
 */
export async function enqueuePipelineCancellation(runId: string): Promise<void> {
  const queue = getOrchestrationQueue();

  await queue.add(
    `cancel-${runId}`,
    {
      runId,
      action: 'cancel',
    },
    {
      priority: 1, // High priority
    }
  );

  logger.info('ci', 'Pipeline cancellation enqueued', { runId });
}

/**
 * Dispatch a job for execution
 */
export async function dispatchJobForExecution(
  job: PipelineJob,
  run: PipelineRun,
  workspaceConfig: WorkspaceConfig
): Promise<string> {
  const queue = getExecutionQueue();

  // Update job status to queued
  await updateJobStatus(job.id, 'queued');

  const executionJob = await queue.add(
    `execute-${job.jobKey}`,
    {
      jobId: job.id,
      runId: run.id,
      repositoryId: run.repositoryId,
      jobKey: job.jobKey,
      containerImage: job.containerImage || 'node:20-alpine',
      steps: (job.steps as JobStep[]) || [],
      environment: (job.environment as Record<string, string>) || {},
      workspaceConfig,
    },
    {
      jobId: `exec-${job.id}`,
      priority: job.stageIndex * 10 + job.jobIndex,
    }
  );

  logger.info('ci', 'Job dispatched for execution', {
    jobId: job.id,
    jobKey: job.jobKey,
    runId: run.id,
    queueJobId: executionJob.id,
  });

  return executionJob.id!;
}

/**
 * Process pipeline orchestration
 */
async function processOrchestration(
  queueJob: Job<PipelineOrchestrationJobData, PipelineOrchestrationResult>
): Promise<PipelineOrchestrationResult> {
  const { runId, action } = queueJob.data;

  logger.info('ci', 'Processing orchestration', { runId, action });

  switch (action) {
    case 'start':
      return await startPipelineExecution(runId);
    case 'check_completion':
      return await checkPipelineCompletion(runId);
    case 'cancel':
      return await cancelPipelineExecution(runId);
    default:
      throw new Error(`Unknown orchestration action: ${action}`);
  }
}

/**
 * Start pipeline execution - dispatch initial jobs
 */
async function startPipelineExecution(runId: string): Promise<PipelineOrchestrationResult> {
  // Get run with pipeline and repository info
  const run = await db.query.pipelineRuns.findFirst({
    where: eq(pipelineRuns.id, runId),
    with: {
      pipeline: {
        with: {
          repository: {
            with: {
              organization: true,
              owner: true,
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw new Error(`Pipeline run not found: ${runId}`);
  }

  if (run.status !== 'pending') {
    logger.warn('ci', 'Pipeline run already started', { runId, status: run.status });
    return { status: 'waiting', message: 'Run already started' };
  }

  // Update run to running
  await updatePipelineRunStatus(runId, 'running');

  const repo = run.pipeline.repository;
  const ownerSlug = repo.organization?.slug || repo.owner?.username || '';

  const workspaceConfig: WorkspaceConfig = {
    ownerSlug,
    repoSlug: repo.slug,
    ref: run.triggerRef || repo.defaultBranch || 'main',
    sha: run.triggerSha || '',
  };

  // Get jobs ready to execute (no dependencies or dependencies satisfied)
  const readyJobs = await getReadyJobs(runId);

  if (readyJobs.length === 0) {
    // No jobs to run - might be a configuration issue
    await updatePipelineRunStatus(runId, 'success');
    return { status: 'completed', jobsDispatched: 0, message: 'No jobs to execute' };
  }

  // Dispatch ready jobs
  for (const job of readyJobs) {
    await dispatchJobForExecution(job, run, workspaceConfig);
  }

  logger.info('ci', 'Pipeline execution started', {
    runId,
    jobsDispatched: readyJobs.length,
  });

  return { status: 'dispatched', jobsDispatched: readyJobs.length };
}

/**
 * Check if pipeline is complete and handle next steps
 */
async function checkPipelineCompletion(runId: string): Promise<PipelineOrchestrationResult> {
  const run = await db.query.pipelineRuns.findFirst({
    where: eq(pipelineRuns.id, runId),
    with: {
      pipeline: {
        with: {
          repository: {
            with: {
              organization: true,
              owner: true,
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw new Error(`Pipeline run not found: ${runId}`);
  }

  // Get all jobs for this run
  const jobs = await db.query.pipelineJobs.findMany({
    where: eq(pipelineJobs.runId, runId),
  });

  // Count by status
  const statusCounts = jobs.reduce(
    (acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const pendingOrQueued = (statusCounts['pending'] || 0) + (statusCounts['queued'] || 0);
  const running = statusCounts['running'] || 0;
  const failed = statusCounts['failure'] || 0;
  const cancelled = statusCounts['cancelled'] || 0;

  // If any jobs are still running or queued, not complete yet
  if (running > 0 || pendingOrQueued > 0) {
    // But check if we can dispatch more jobs
    const readyJobs = await getReadyJobs(runId);

    if (readyJobs.length > 0) {
      const repo = run.pipeline.repository;
      const ownerSlug = repo.organization?.slug || repo.owner?.username || '';

      const workspaceConfig: WorkspaceConfig = {
        ownerSlug,
        repoSlug: repo.slug,
        ref: run.triggerRef || repo.defaultBranch || 'main',
        sha: run.triggerSha || '',
      };

      for (const job of readyJobs) {
        await dispatchJobForExecution(job, run, workspaceConfig);
      }

      return { status: 'dispatched', jobsDispatched: readyJobs.length };
    }

    return { status: 'waiting' };
  }

  // All jobs complete - determine final status
  let finalStatus: PipelineRunStatus;
  if (cancelled > 0 && failed === 0) {
    finalStatus = 'cancelled';
  } else if (failed > 0) {
    finalStatus = 'failure';
  } else {
    finalStatus = 'success';
  }

  await updatePipelineRunStatus(runId, finalStatus);

  logger.info('ci', 'Pipeline run completed', {
    runId,
    finalStatus,
    statusCounts,
  });

  return { status: 'completed', message: `Pipeline ${finalStatus}` };
}

/**
 * Cancel a running pipeline
 */
async function cancelPipelineExecution(runId: string): Promise<PipelineOrchestrationResult> {
  // Get all pending/running jobs
  const jobs = await db.query.pipelineJobs.findMany({
    where: and(
      eq(pipelineJobs.runId, runId),
      or(
        eq(pipelineJobs.status, 'pending'),
        eq(pipelineJobs.status, 'queued'),
        eq(pipelineJobs.status, 'running')
      )
    ),
  });

  // Cancel all pending/queued jobs
  for (const job of jobs) {
    if (job.status === 'pending' || job.status === 'queued') {
      await updateJobStatus(job.id, 'cancelled');
    }
    // Running jobs need to be interrupted (handled by worker)
  }

  // Try to remove queued execution jobs
  const execQueue = getExecutionQueue();
  for (const job of jobs) {
    try {
      const queueJob = await execQueue.getJob(`exec-${job.id}`);
      if (queueJob && (await queueJob.isWaiting())) {
        await queueJob.remove();
      }
    } catch {
      // Job might not exist or already processing
    }
  }

  await updatePipelineRunStatus(runId, 'cancelled');

  logger.info('ci', 'Pipeline cancelled', { runId, jobsCancelled: jobs.length });

  return { status: 'cancelled', message: `Cancelled ${jobs.length} jobs` };
}

/**
 * Process job execution (stub - actual execution in worker)
 */
async function processJobExecution(
  queueJob: Job<JobExecutionJobData, JobExecutionResult>
): Promise<JobExecutionResult> {
  const { jobId, runId, jobKey, steps, containerImage, environment, workspaceConfig } = queueJob.data;
  const startTime = Date.now();

  logger.info('ci', 'Processing job execution', { jobId, jobKey, runId });

  // Update job to running
  await updateJobStatus(jobId, 'running');

  const stepResults: StepResult[] = [];
  let overallStatus: JobStatus = 'success';
  let exitCode = 0;
  const outputs: Record<string, string> = {};

  try {
    // Execute each step
    for (const step of steps) {
      const stepStartedAt = new Date();
      const stepStartTime = Date.now();

      try {
        // For now, we simulate execution
        // Real implementation will use Docker
        const result = await executeStep(step, workspaceConfig, environment);
        const stepCompletedAt = new Date();

        stepResults.push({
          name: step.name,
          status: 'success',
          exitCode: 0,
          durationMs: Date.now() - stepStartTime,
          output: result.output,
          startedAt: stepStartedAt.toISOString(),
          completedAt: stepCompletedAt.toISOString(),
        });

        // Capture outputs
        if (result.outputs) {
          Object.assign(outputs, result.outputs);
        }
      } catch (error: any) {
        const stepCompletedAt = new Date();

        stepResults.push({
          name: step.name,
          status: 'failure',
          exitCode: 1,
          durationMs: Date.now() - stepStartTime,
          error: error.message,
          startedAt: stepStartedAt.toISOString(),
          completedAt: stepCompletedAt.toISOString(),
        });

        if (!step.continueOnError) {
          overallStatus = 'failure';
          exitCode = 1;
          break;
        }
      }
    }
  } catch (error: any) {
    overallStatus = 'failure';
    exitCode = 1;
    logger.error('ci', 'Job execution failed', { jobId, error: error.message });
  }

  const durationMs = Date.now() - startTime;

  // Update job status in database
  await db
    .update(pipelineJobs)
    .set({
      status: overallStatus,
      exitCode,
      completedAt: new Date(),
      durationMs,
      stepResults,
      outputs,
      updatedAt: new Date(),
    })
    .where(eq(pipelineJobs.id, jobId));

  // Schedule completion check for the pipeline
  await enqueueCompletionCheck(runId);

  logger.info('ci', 'Job execution completed', {
    jobId,
    jobKey,
    status: overallStatus,
    durationMs,
  });

  return {
    status: overallStatus,
    exitCode,
    durationMs,
    stepResults,
    outputs,
  };
}

/**
 * Execute a single step (stub implementation)
 * This will be replaced with Docker container execution
 */
async function executeStep(
  step: JobStep,
  workspace: WorkspaceConfig,
  environment: Record<string, string>
): Promise<{ output?: string; outputs?: Record<string, string> }> {
  // Handle built-in actions
  if (step.uses) {
    const [action, version] = step.uses.split('@');

    switch (action) {
      case 'checkout':
        logger.info('ci', 'Checkout action', { workspace });
        return { output: `Checked out ${workspace.ownerSlug}/${workspace.repoSlug}@${workspace.ref}` };

      case 'upload-artifact':
        logger.info('ci', 'Upload artifact action', { with: step.with });
        return { output: `Would upload artifact: ${step.with?.name}` };

      case 'download-artifact':
        logger.info('ci', 'Download artifact action', { with: step.with });
        return { output: `Would download artifact: ${step.with?.name}` };

      case 'cache':
        logger.info('ci', 'Cache action', { with: step.with });
        return { output: `Would handle cache: ${step.with?.key}` };

      case 'setup-node':
        logger.info('ci', 'Setup Node action', { with: step.with });
        return { output: `Would setup Node.js ${step.with?.['node-version'] || 'latest'}` };

      default:
        logger.warn('ci', 'Unknown action', { action });
        return { output: `Unknown action: ${action}` };
    }
  }

  // Handle run commands
  if (step.run) {
    logger.info('ci', 'Run command', { run: step.run });
    // In real implementation, this would execute in Docker
    return { output: `Would execute: ${step.run}` };
  }

  return { output: 'No-op step' };
}

/**
 * Start the orchestration worker
 */
export function startOrchestrationWorker(): Worker<PipelineOrchestrationJobData, PipelineOrchestrationResult> {
  if (orchestrationWorker) {
    return orchestrationWorker;
  }

  orchestrationWorker = new Worker<PipelineOrchestrationJobData, PipelineOrchestrationResult>(
    PIPELINE_ORCHESTRATION_QUEUE,
    processOrchestration,
    {
      connection: getRedisConnection(),
      concurrency: 10,
    }
  );

  orchestrationWorker.on('completed', (job, result) => {
    logger.info('ci', 'Orchestration job completed', { jobId: job.id, result });
  });

  orchestrationWorker.on('failed', (job, error) => {
    logger.error('ci', 'Orchestration job failed', { jobId: job?.id, error: error.message });
  });

  orchestrationWorker.on('error', (error) => {
    logger.error('ci', 'Orchestration worker error', { error: error.message });
  });

  logger.info('ci', 'Orchestration worker started');
  return orchestrationWorker;
}

/**
 * Start the execution worker
 */
export function startExecutionWorker(): Worker<JobExecutionJobData, JobExecutionResult> {
  if (executionWorker) {
    return executionWorker;
  }

  executionWorker = new Worker<JobExecutionJobData, JobExecutionResult>(
    JOB_EXECUTION_QUEUE,
    processJobExecution,
    {
      connection: getRedisConnection(),
      concurrency: 5, // Limit concurrent job executions
    }
  );

  executionWorker.on('completed', (job, result) => {
    logger.info('ci', 'Execution job completed', {
      jobId: job.id,
      status: result.status,
      durationMs: result.durationMs,
    });
  });

  executionWorker.on('failed', (job, error) => {
    logger.error('ci', 'Execution job failed', { jobId: job?.id, error: error.message });
  });

  executionWorker.on('error', (error) => {
    logger.error('ci', 'Execution worker error', { error: error.message });
  });

  logger.info('ci', 'Execution worker started');
  return executionWorker;
}

/**
 * Stop all workers
 */
export async function stopWorkers(): Promise<void> {
  if (orchestrationWorker) {
    await orchestrationWorker.close();
    orchestrationWorker = null;
  }
  if (executionWorker) {
    await executionWorker.close();
    executionWorker = null;
  }
  logger.info('ci', 'CI/CD workers stopped');
}

/**
 * Close all queues
 */
export async function closeQueues(): Promise<void> {
  if (orchestrationQueue) {
    await orchestrationQueue.close();
    orchestrationQueue = null;
  }
  if (executionQueue) {
    await executionQueue.close();
    executionQueue = null;
  }
  logger.info('ci', 'CI/CD queues closed');
}

/**
 * Get queue stats
 */
interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

export async function getQueueStats(): Promise<{
  orchestration: QueueCounts;
  execution: QueueCounts;
}> {
  const orchQueue = getOrchestrationQueue();
  const execQueue = getExecutionQueue();

  const [orchCounts, execCounts] = await Promise.all([
    orchQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    execQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
  ]);

  return {
    orchestration: {
      waiting: orchCounts.waiting ?? 0,
      active: orchCounts.active ?? 0,
      completed: orchCounts.completed ?? 0,
      failed: orchCounts.failed ?? 0,
    },
    execution: {
      waiting: execCounts.waiting ?? 0,
      active: execCounts.active ?? 0,
      completed: execCounts.completed ?? 0,
      failed: execCounts.failed ?? 0,
    },
  };
}
