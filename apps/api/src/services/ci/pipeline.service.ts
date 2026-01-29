import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  pipelines,
  pipelineRuns,
  pipelineJobs,
} from '../../db/schema/ci-cd';
import type {
  Pipeline,
  NewPipeline,
  PipelineRun,
  NewPipelineRun,
  PipelineJob,
  NewPipelineJob,
  PipelineDefinition,
} from '../../db/schema/ci-cd';
import { parsePipelineYaml } from './pipeline-parser';
import { logger } from '../../utils/logger';

// ============================================================================
// Pipeline CRUD
// ============================================================================

export interface CreatePipelineInput {
  repositoryId: string;
  name: string;
  slug?: string;
  description?: string;
  definitionYaml: string;
  filePath?: string;
}

export interface UpdatePipelineInput {
  name?: string;
  description?: string;
  definitionYaml?: string;
  isActive?: boolean;
}

/**
 * Create a new pipeline
 */
export async function createPipeline(input: CreatePipelineInput): Promise<Pipeline> {
  // Parse the YAML definition
  const parseResult = parsePipelineYaml(input.definitionYaml);

  if (!parseResult.success) {
    const errorMessages = parseResult.errors
      .filter((e) => e.severity === 'error')
      .map((e) => `${e.path}: ${e.message}`)
      .join('; ');
    throw new Error(`Invalid pipeline definition: ${errorMessages}`);
  }

  // Generate slug if not provided
  const slug =
    input.slug ||
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  // Check for duplicate slug in repository
  const existing = await db.query.pipelines.findFirst({
    where: and(
      eq(pipelines.repositoryId, input.repositoryId),
      eq(pipelines.slug, slug)
    ),
  });

  if (existing) {
    throw new Error(`Pipeline with slug "${slug}" already exists in this repository`);
  }

  const [pipeline] = await db
    .insert(pipelines)
    .values({
      repositoryId: input.repositoryId,
      name: input.name,
      slug,
      description: input.description,
      filePath: input.filePath || '.cv-hub/pipeline.yaml',
      definitionFormat: 'yaml',
      definition: parseResult.definition,
      definitionHash: parseResult.hash,
    })
    .returning();

  logger.info('general', 'Pipeline created', {
    pipelineId: pipeline.id,
    repositoryId: input.repositoryId,
    name: input.name,
  });

  return pipeline;
}

/**
 * Get pipeline by ID
 */
export async function getPipelineById(id: string): Promise<Pipeline | null> {
  const pipeline = await db.query.pipelines.findFirst({
    where: eq(pipelines.id, id),
  });

  return pipeline || null;
}

/**
 * Get pipeline by repository and slug
 */
export async function getPipelineBySlug(
  repositoryId: string,
  slug: string
): Promise<Pipeline | null> {
  const pipeline = await db.query.pipelines.findFirst({
    where: and(
      eq(pipelines.repositoryId, repositoryId),
      eq(pipelines.slug, slug)
    ),
  });

  return pipeline || null;
}

/**
 * List pipelines for a repository
 */
export async function listPipelines(
  repositoryId: string,
  options: {
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Pipeline[]> {
  const { includeInactive = false, limit = 50, offset = 0 } = options;

  const conditions = [eq(pipelines.repositoryId, repositoryId)];

  if (!includeInactive) {
    conditions.push(eq(pipelines.isActive, true));
  }

  const result = await db.query.pipelines.findMany({
    where: and(...conditions),
    orderBy: [desc(pipelines.lastRunAt), asc(pipelines.name)],
    limit,
    offset,
  });

  return result;
}

/**
 * Update a pipeline
 */
export async function updatePipeline(
  id: string,
  input: UpdatePipelineInput
): Promise<Pipeline | null> {
  const existing = await getPipelineById(id);
  if (!existing) return null;

  const updates: Partial<NewPipeline> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) {
    updates.name = input.name;
  }

  if (input.description !== undefined) {
    updates.description = input.description;
  }

  if (input.isActive !== undefined) {
    updates.isActive = input.isActive;
  }

  if (input.definitionYaml !== undefined) {
    const parseResult = parsePipelineYaml(input.definitionYaml);

    if (!parseResult.success) {
      const errorMessages = parseResult.errors
        .filter((e) => e.severity === 'error')
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ');
      throw new Error(`Invalid pipeline definition: ${errorMessages}`);
    }

    updates.definition = parseResult.definition;
    updates.definitionHash = parseResult.hash;
  }

  const [updated] = await db
    .update(pipelines)
    .set(updates)
    .where(eq(pipelines.id, id))
    .returning();

  logger.info('general', 'Pipeline updated', { pipelineId: id });

  return updated;
}

/**
 * Delete a pipeline
 */
export async function deletePipeline(id: string): Promise<boolean> {
  const result = await db.delete(pipelines).where(eq(pipelines.id, id));

  if (result.rowCount === 0) {
    return false;
  }

  logger.info('general', 'Pipeline deleted', { pipelineId: id });
  return true;
}

// ============================================================================
// Pipeline Runs
// ============================================================================

export interface TriggerPipelineInput {
  pipelineId: string;
  trigger: 'push' | 'pull_request' | 'schedule' | 'manual' | 'api' | 'tag' | 'release';
  triggeredBy?: string;
  ref: string;
  sha: string;
  pullRequestNumber?: number;
  inputs?: Record<string, string>;
}

/**
 * Trigger a new pipeline run
 */
export async function triggerPipeline(
  input: TriggerPipelineInput
): Promise<PipelineRun> {
  const pipeline = await getPipelineById(input.pipelineId);

  if (!pipeline) {
    throw new Error('Pipeline not found');
  }

  if (!pipeline.isActive) {
    throw new Error('Pipeline is not active');
  }

  // Get next run number
  const lastRun = await db.query.pipelineRuns.findFirst({
    where: eq(pipelineRuns.pipelineId, input.pipelineId),
    orderBy: desc(pipelineRuns.number),
  });

  const runNumber = (lastRun?.number || 0) + 1;

  // Create run record
  const [run] = await db
    .insert(pipelineRuns)
    .values({
      pipelineId: input.pipelineId,
      repositoryId: pipeline.repositoryId,
      number: runNumber,
      trigger: input.trigger,
      triggeredBy: input.triggeredBy,
      triggerRef: input.ref,
      triggerSha: input.sha,
      pullRequestNumber: input.pullRequestNumber,
      status: 'pending',
      contextSnapshot: {
        ref: input.ref,
        sha: input.sha,
        branch: input.ref.startsWith('refs/heads/')
          ? input.ref.slice(11)
          : undefined,
        tag: input.ref.startsWith('refs/tags/')
          ? input.ref.slice(10)
          : undefined,
        actor: input.triggeredBy || 'system',
        event: input.trigger,
        repository: {
          id: pipeline.repositoryId,
          name: '', // Will be populated by caller if needed
          owner: '',
        },
        pullRequest: input.pullRequestNumber
          ? {
              number: input.pullRequestNumber,
              head: input.sha,
              base: '',
            }
          : undefined,
        inputs: input.inputs,
      },
      workflowInputs: input.inputs,
    })
    .returning();

  // Create job records from pipeline definition
  const definition = pipeline.definition as PipelineDefinition;
  const jobsToCreate: NewPipelineJob[] = [];

  for (let stageIdx = 0; stageIdx < definition.stages.length; stageIdx++) {
    const stage = definition.stages[stageIdx];
    for (let jobIdx = 0; jobIdx < stage.jobs.length; jobIdx++) {
      const jobDef = stage.jobs[jobIdx];
      jobsToCreate.push({
        runId: run.id,
        name: jobDef.name,
        jobKey: jobDef.key,
        stageIndex: stageIdx,
        jobIndex: jobIdx,
        dependsOn: jobDef.needs || [],
        status: 'pending',
        containerImage: jobDef.container?.image,
        environment: {
          ...definition.env,
          ...jobDef.env,
        },
        steps: jobDef.steps,
      });
    }
  }

  if (jobsToCreate.length > 0) {
    await db.insert(pipelineJobs).values(jobsToCreate);
  }

  // Update pipeline stats
  await db
    .update(pipelines)
    .set({
      lastRunAt: new Date(),
      totalRuns: sql`${pipelines.totalRuns} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(pipelines.id, pipeline.id));

  logger.info('general', 'Pipeline run triggered', {
    pipelineId: pipeline.id,
    runId: run.id,
    runNumber,
    trigger: input.trigger,
  });

  return run;
}

/**
 * Get pipeline run by ID
 */
export async function getPipelineRunById(
  id: string
): Promise<PipelineRun | null> {
  const run = await db.query.pipelineRuns.findFirst({
    where: eq(pipelineRuns.id, id),
  });

  return run || null;
}

/**
 * Get pipeline run by number
 */
export async function getPipelineRunByNumber(
  pipelineId: string,
  number: number
): Promise<PipelineRun | null> {
  const run = await db.query.pipelineRuns.findFirst({
    where: and(
      eq(pipelineRuns.pipelineId, pipelineId),
      eq(pipelineRuns.number, number)
    ),
  });

  return run || null;
}

/**
 * List pipeline runs
 */
export async function listPipelineRuns(
  pipelineId: string,
  options: {
    status?: PipelineRun['status'];
    limit?: number;
    offset?: number;
  } = {}
): Promise<PipelineRun[]> {
  const { status, limit = 20, offset = 0 } = options;

  const conditions = [eq(pipelineRuns.pipelineId, pipelineId)];

  if (status) {
    conditions.push(eq(pipelineRuns.status, status));
  }

  const result = await db.query.pipelineRuns.findMany({
    where: and(...conditions),
    orderBy: desc(pipelineRuns.number),
    limit,
    offset,
  });

  return result;
}

/**
 * Update pipeline run status
 */
export async function updatePipelineRunStatus(
  id: string,
  status: PipelineRun['status'],
  extra?: {
    conclusion?: string;
    errorMessage?: string;
    errorDetails?: Record<string, unknown>;
  }
): Promise<PipelineRun | null> {
  const now = new Date();
  const updates: Partial<NewPipelineRun> = {
    status,
    updatedAt: now,
  };

  if (status === 'running') {
    updates.startedAt = now;
  }

  if (['success', 'failure', 'cancelled', 'timed_out'].includes(status)) {
    updates.completedAt = now;
    updates.conclusion = extra?.conclusion || status;

    // Calculate duration
    const run = await getPipelineRunById(id);
    if (run?.startedAt) {
      updates.durationMs = now.getTime() - new Date(run.startedAt).getTime();
    }
  }

  if (extra?.errorMessage) {
    updates.errorMessage = extra.errorMessage;
  }

  if (extra?.errorDetails) {
    updates.errorDetails = extra.errorDetails;
  }

  const [updated] = await db
    .update(pipelineRuns)
    .set(updates)
    .where(eq(pipelineRuns.id, id))
    .returning();

  if (!updated) return null;

  // Update pipeline stats if completed
  if (['success', 'failure'].includes(status)) {
    const run = await getPipelineRunById(id);
    if (run) {
      const statsUpdate =
        status === 'success'
          ? { successfulRuns: sql`${pipelines.successfulRuns} + 1` }
          : { failedRuns: sql`${pipelines.failedRuns} + 1` };

      await db
        .update(pipelines)
        .set({
          ...statsUpdate,
          updatedAt: now,
        })
        .where(eq(pipelines.id, run.pipelineId));
    }
  }

  logger.info('general', 'Pipeline run status updated', { runId: id, status });

  return updated;
}

/**
 * Cancel a pipeline run
 */
export async function cancelPipelineRun(id: string): Promise<PipelineRun | null> {
  const run = await getPipelineRunById(id);

  if (!run) return null;

  if (!['pending', 'running'].includes(run.status)) {
    throw new Error('Can only cancel pending or running pipeline runs');
  }

  // Cancel all pending/queued/running jobs
  await db
    .update(pipelineJobs)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pipelineJobs.runId, id),
        sql`${pipelineJobs.status} IN ('pending', 'queued', 'running')`
      )
    );

  return updatePipelineRunStatus(id, 'cancelled');
}

// ============================================================================
// Pipeline Jobs
// ============================================================================

/**
 * Get jobs for a run
 */
export async function getRunJobs(runId: string): Promise<PipelineJob[]> {
  const jobs = await db.query.pipelineJobs.findMany({
    where: eq(pipelineJobs.runId, runId),
    orderBy: [asc(pipelineJobs.stageIndex), asc(pipelineJobs.jobIndex)],
  });

  return jobs;
}

/**
 * Get job by ID
 */
export async function getJobById(id: string): Promise<PipelineJob | null> {
  const job = await db.query.pipelineJobs.findFirst({
    where: eq(pipelineJobs.id, id),
  });

  return job || null;
}

/**
 * Update job status
 */
export async function updateJobStatus(
  id: string,
  status: PipelineJob['status'],
  extra?: {
    exitCode?: number;
    runnerId?: string;
    runnerName?: string;
    stepResults?: PipelineJob['stepResults'];
    outputs?: Record<string, string>;
    logsPath?: string;
  }
): Promise<PipelineJob | null> {
  const now = new Date();
  const updates: Partial<NewPipelineJob> = {
    status,
    updatedAt: now,
  };

  if (status === 'queued') {
    updates.queuedAt = now;
  }

  if (status === 'running') {
    updates.startedAt = now;
  }

  if (['success', 'failure', 'cancelled', 'skipped'].includes(status)) {
    updates.completedAt = now;

    // Calculate duration
    const job = await getJobById(id);
    if (job?.startedAt) {
      updates.durationMs = now.getTime() - new Date(job.startedAt).getTime();
    }
  }

  if (extra?.exitCode !== undefined) {
    updates.exitCode = extra.exitCode;
  }

  if (extra?.runnerId) {
    updates.runnerId = extra.runnerId;
    updates.runnerName = extra.runnerName;
  }

  if (extra?.stepResults) {
    updates.stepResults = extra.stepResults;
  }

  if (extra?.outputs) {
    updates.outputs = extra.outputs;
  }

  if (extra?.logsPath) {
    updates.logsPath = extra.logsPath;
  }

  const [updated] = await db
    .update(pipelineJobs)
    .set(updates)
    .where(eq(pipelineJobs.id, id))
    .returning();

  if (!updated) return null;

  logger.info('general', 'Pipeline job status updated', { jobId: id, status });

  return updated;
}

/**
 * Get jobs ready to run (dependencies satisfied)
 */
export async function getReadyJobs(runId: string): Promise<PipelineJob[]> {
  const allJobs = await getRunJobs(runId);

  // Get completed job keys
  const completedKeys = new Set(
    allJobs
      .filter((j) => j.status === 'success')
      .map((j) => j.jobKey)
  );

  // Find pending jobs with satisfied dependencies
  const readyJobs = allJobs.filter((job) => {
    if (job.status !== 'pending') return false;

    const deps = (job.dependsOn as string[]) || [];
    return deps.every((dep) => completedKeys.has(dep));
  });

  return readyJobs;
}

/**
 * Check if all jobs in a run are complete
 */
export async function isRunComplete(runId: string): Promise<boolean> {
  const jobs = await getRunJobs(runId);

  return jobs.every((job) =>
    ['success', 'failure', 'cancelled', 'skipped'].includes(job.status)
  );
}

/**
 * Determine run conclusion from job statuses
 */
export async function determineRunConclusion(
  runId: string
): Promise<'success' | 'failure'> {
  const jobs = await getRunJobs(runId);

  const hasFailure = jobs.some((job) => job.status === 'failure');

  return hasFailure ? 'failure' : 'success';
}

// ============================================================================
// Repository Pipelines
// ============================================================================

/**
 * Get pipelines matching a trigger event
 */
export async function getPipelinesForTrigger(
  repositoryId: string,
  trigger: 'push' | 'pull_request' | 'tag',
  ref: string
): Promise<Pipeline[]> {
  const allPipelines = await listPipelines(repositoryId);

  return allPipelines.filter((pipeline) => {
    const definition = pipeline.definition as PipelineDefinition;
    if (!definition.on) return false;

    if (trigger === 'push' && definition.on.push) {
      const { branches = [], tags = [] } = definition.on.push;

      // Check branch match
      if (ref.startsWith('refs/heads/')) {
        const branch = ref.slice(11);
        return branches.length === 0 || matchesPattern(branch, branches);
      }

      // Check tag match
      if (ref.startsWith('refs/tags/')) {
        const tag = ref.slice(10);
        return tags.length === 0 || matchesPattern(tag, tags);
      }
    }

    if (trigger === 'pull_request' && definition.on.pull_request) {
      const { branches = [] } = definition.on.pull_request;
      const branch = ref.startsWith('refs/heads/') ? ref.slice(11) : ref;
      return branches.length === 0 || matchesPattern(branch, branches);
    }

    if (trigger === 'tag' && definition.on.push?.tags) {
      const tag = ref.startsWith('refs/tags/') ? ref.slice(10) : ref;
      return matchesPattern(tag, definition.on.push.tags);
    }

    return false;
  });
}

/**
 * Check if a string matches any pattern (supports wildcards)
 */
function matchesPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Convert glob pattern to regex
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
          .replace(/\[/g, '[')
          .replace(/\]/g, ']') +
        '$'
    );
    return regex.test(value);
  });
}
