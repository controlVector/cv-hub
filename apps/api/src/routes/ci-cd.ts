/**
 * CI/CD API Routes
 * Endpoints for managing pipelines, runs, and AI-powered CI/CD features
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import {
  createPipeline,
  getPipelineById,
  getPipelineBySlug,
  listPipelines,
  updatePipeline,
  deletePipeline,
  triggerPipeline,
  getPipelineRunByNumber,
  listPipelineRuns,
  cancelPipelineRun,
  getRunJobs,
  getJobById,
} from '../services/ci/pipeline.service';
import {
  analyzeFailure,
  suggestFixes,
  analyzePerformance,
  summarizeRun,
} from '../services/ci/ai-analysis.service';
import {
  generatePipelineFromPrompt,
  analyzeRepository,
  suggestPipelineOptimizations,
} from '../services/ci/ai-generator.service';
import { parsePipelineYaml, serializePipelineToYaml, validatePipelineDefinition } from '../services/ci/pipeline-parser';
import { getQueueStats, enqueuePipelineRun } from '../services/ci/job-dispatch.service';
import { executeCICDTool, getAvailableTools, processNaturalLanguageCommand } from '../mcp/tools/ci-cd';
import { getRepositoryByOwnerAndSlug, canUserAccessRepo, canUserWriteToRepo } from '../services/repository.service';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import type { AppEnv } from '../app';

const cicdRoutes = new Hono<AppEnv>();

// Validation schemas
const pipelineTriggers = ['push', 'pull_request', 'schedule', 'manual', 'api', 'tag', 'release'] as const;
const runStatuses = ['pending', 'running', 'success', 'failure', 'cancelled', 'skipped', 'timed_out'] as const;

// Helper to get repository and verify access
async function getRepoWithAccess(
  c: any,
  owner: string,
  repo: string,
  requireWrite = false
): Promise<{ repositoryId: string; repository: any }> {
  const repository = await getRepositoryByOwnerAndSlug(owner, repo);
  if (!repository) {
    throw new NotFoundError('Repository not found');
  }

  const userId = c.get('userId');
  const canAccess = await canUserAccessRepo(userId, repository.id);
  if (!canAccess) {
    throw new ForbiddenError('Access denied');
  }

  if (requireWrite) {
    const canWrite = await canUserWriteToRepo(userId, repository.id);
    if (!canWrite) {
      throw new ForbiddenError('Write access required');
    }
  }

  return { repositoryId: repository.id, repository };
}

// ============================================================================
// Pipeline Management
// ============================================================================

// GET /api/v1/repos/:owner/:repo/pipelines - List pipelines
cicdRoutes.get(
  '/repos/:owner/:repo/pipelines',
  requireAuth,
  async (c) => {
    const { owner, repo } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo);

    const pipelineList = await listPipelines(repositoryId);

    return c.json({
      pipelines: pipelineList.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        filePath: p.filePath,
        isActive: p.isActive,
        totalRuns: p.totalRuns,
        successfulRuns: p.successfulRuns,
        failedRuns: p.failedRuns,
        avgDurationMs: p.avgDurationMs,
        lastRunAt: p.lastRunAt,
        createdAt: p.createdAt,
      })),
    });
  }
);

// POST /api/v1/repos/:owner/:repo/pipelines - Create pipeline
const createPipelineSchema = z.object({
  yaml: z.string().min(1).max(100000),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  filePath: z.string().max(500).optional(),
});

cicdRoutes.post(
  '/repos/:owner/:repo/pipelines',
  requireAuth,
  zValidator('json', createPipelineSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo, true);
    const body = c.req.valid('json');

    // Parse and validate YAML
    const parseResult = parsePipelineYaml(body.yaml);
    if (!parseResult.success) {
      const errorMessages = parseResult.errors.map((e) => e.message).join(', ');
      throw new ValidationError(`Invalid pipeline YAML: ${errorMessages}`);
    }

    const validationErrors = validatePipelineDefinition(parseResult.definition);
    const criticalErrors = validationErrors.filter((e) => e.severity === 'error');
    if (criticalErrors.length > 0) {
      const errorMessages = criticalErrors.map((e) => e.message).join(', ');
      throw new ValidationError(`Invalid pipeline: ${errorMessages}`);
    }

    const pipeline = await createPipeline({
      repositoryId,
      name: body.name || parseResult.definition.name,
      description: body.description,
      filePath: body.filePath,
      definitionYaml: body.yaml,
    });

    return c.json({ pipeline }, 201);
  }
);

// POST /api/v1/repos/:owner/:repo/pipelines/generate - AI-generate pipeline
const generatePipelineSchema = z.object({
  prompt: z.string().min(10).max(1000),
});

cicdRoutes.post(
  '/repos/:owner/:repo/pipelines/generate',
  requireAuth,
  zValidator('json', generatePipelineSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo, true);
    const userId = c.get('userId')!;
    const { prompt } = c.req.valid('json');

    const generated = await generatePipelineFromPrompt(repositoryId, userId, prompt);
    if (!generated) {
      throw new ValidationError('Failed to generate pipeline. AI service may be unavailable.');
    }

    return c.json({
      yaml: generated.yaml,
      definition: generated.definition,
      confidence: generated.confidence,
      reasoning: generated.reasoning,
      alternatives: generated.alternatives,
    });
  }
);

// GET /api/v1/repos/:owner/:repo/pipelines/:slug - Get pipeline
cicdRoutes.get(
  '/repos/:owner/:repo/pipelines/:slug',
  requireAuth,
  async (c) => {
    const { owner, repo, slug } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo);

    const pipeline = await getPipelineBySlug(repositoryId, slug);
    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    // Generate YAML from definition
    const yaml = serializePipelineToYaml(pipeline.definition);

    return c.json({
      pipeline: {
        ...pipeline,
        yaml,
      },
    });
  }
);

// PATCH /api/v1/repos/:owner/:repo/pipelines/:slug - Update pipeline
const updatePipelineSchema = z.object({
  yaml: z.string().min(1).max(100000).optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});

cicdRoutes.patch(
  '/repos/:owner/:repo/pipelines/:slug',
  requireAuth,
  zValidator('json', updatePipelineSchema),
  async (c) => {
    const { owner, repo, slug } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo, true);
    const body = c.req.valid('json');

    const existing = await getPipelineBySlug(repositoryId, slug);
    if (!existing) {
      throw new NotFoundError('Pipeline not found');
    }

    if (body.yaml) {
      const parseResult = parsePipelineYaml(body.yaml);
      if (!parseResult.success) {
        const errorMessages = parseResult.errors.map((e) => e.message).join(', ');
        throw new ValidationError(`Invalid pipeline YAML: ${errorMessages}`);
      }
    }

    const updated = await updatePipeline(existing.id, {
      name: body.name,
      description: body.description,
      isActive: body.isActive,
      definitionYaml: body.yaml,
    });

    return c.json({ pipeline: updated });
  }
);

// DELETE /api/v1/repos/:owner/:repo/pipelines/:slug - Delete pipeline
cicdRoutes.delete(
  '/repos/:owner/:repo/pipelines/:slug',
  requireAuth,
  async (c) => {
    const { owner, repo, slug } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo, true);

    const existing = await getPipelineBySlug(repositoryId, slug);
    if (!existing) {
      throw new NotFoundError('Pipeline not found');
    }

    await deletePipeline(existing.id);

    return c.json({ success: true });
  }
);

// ============================================================================
// Pipeline Runs
// ============================================================================

// POST /api/v1/repos/:owner/:repo/pipelines/:slug/runs - Trigger run
const triggerRunSchema = z.object({
  ref: z.string().optional(),
  sha: z.string().optional(),
  inputs: z.record(z.string()).optional(),
});

cicdRoutes.post(
  '/repos/:owner/:repo/pipelines/:slug/runs',
  requireAuth,
  zValidator('json', triggerRunSchema),
  async (c) => {
    const { owner, repo, slug } = c.req.param();
    const { repositoryId, repository } = await getRepoWithAccess(c, owner, repo, true);
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const pipeline = await getPipelineBySlug(repositoryId, slug);
    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    const run = await triggerPipeline({
      pipelineId: pipeline.id,
      trigger: 'api',
      triggeredBy: userId,
      ref: body.ref || repository.defaultBranch || 'main',
      sha: body.sha || '',
      inputs: body.inputs,
    });

    // Enqueue for execution
    await enqueuePipelineRun(run.id);

    return c.json(
      {
        run: {
          id: run.id,
          number: run.number,
          status: run.status,
          trigger: run.trigger,
          triggerRef: run.triggerRef,
          queuedAt: run.queuedAt,
        },
      },
      201
    );
  }
);

// GET /api/v1/repos/:owner/:repo/pipelines/:slug/runs - List runs
const listRunsSchema = z.object({
  status: z.enum(runStatuses).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

cicdRoutes.get(
  '/repos/:owner/:repo/pipelines/:slug/runs',
  requireAuth,
  zValidator('query', listRunsSchema),
  async (c) => {
    const { owner, repo, slug } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo);
    const query = c.req.valid('query');

    const pipeline = await getPipelineBySlug(repositoryId, slug);
    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    const runs = await listPipelineRuns(pipeline.id, {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });

    return c.json({
      runs: runs.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        trigger: r.trigger,
        triggerRef: r.triggerRef,
        triggerSha: r.triggerSha,
        durationMs: r.durationMs,
        queuedAt: r.queuedAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      })),
    });
  }
);

// GET /api/v1/repos/:owner/:repo/pipelines/:slug/runs/:num - Get run detail
cicdRoutes.get(
  '/repos/:owner/:repo/pipelines/:slug/runs/:num',
  requireAuth,
  async (c) => {
    const { owner, repo, slug, num } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo);

    const pipeline = await getPipelineBySlug(repositoryId, slug);
    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    const run = await getPipelineRunByNumber(pipeline.id, parseInt(num));
    if (!run) {
      throw new NotFoundError('Run not found');
    }

    const jobs = await getRunJobs(run.id);

    // Generate AI summary if completed
    let summary: string | null = null;
    if (run.status !== 'pending' && run.status !== 'running') {
      summary = await summarizeRun(run.id);
    }

    return c.json({
      run: {
        ...run,
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          jobKey: j.jobKey,
          stageIndex: j.stageIndex,
          status: j.status,
          exitCode: j.exitCode,
          durationMs: j.durationMs,
          startedAt: j.startedAt,
          completedAt: j.completedAt,
          runnerName: j.runnerName,
        })),
        summary,
      },
    });
  }
);

// POST /api/v1/repos/:owner/:repo/pipelines/:slug/runs/:num/cancel - Cancel run
cicdRoutes.post(
  '/repos/:owner/:repo/pipelines/:slug/runs/:num/cancel',
  requireAuth,
  async (c) => {
    const { owner, repo, slug, num } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo, true);

    const pipeline = await getPipelineBySlug(repositoryId, slug);
    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    const run = await getPipelineRunByNumber(pipeline.id, parseInt(num));
    if (!run) {
      throw new NotFoundError('Run not found');
    }

    if (run.status !== 'pending' && run.status !== 'running') {
      throw new ValidationError('Run is not in a cancellable state');
    }

    const cancelled = await cancelPipelineRun(run.id);

    return c.json({ run: cancelled });
  }
);

// POST /api/v1/repos/:owner/:repo/pipelines/:slug/runs/:num/rerun - Rerun failed jobs
cicdRoutes.post(
  '/repos/:owner/:repo/pipelines/:slug/runs/:num/rerun',
  requireAuth,
  async (c) => {
    const { owner, repo, slug, num } = c.req.param();
    const { repositoryId, repository } = await getRepoWithAccess(c, owner, repo, true);
    const userId = c.get('userId')!;

    const pipeline = await getPipelineBySlug(repositoryId, slug);
    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    const existingRun = await getPipelineRunByNumber(pipeline.id, parseInt(num));
    if (!existingRun) {
      throw new NotFoundError('Run not found');
    }

    // Create a new run with same configuration
    const newRun = await triggerPipeline({
      pipelineId: pipeline.id,
      trigger: 'api',
      triggeredBy: userId,
      ref: existingRun.triggerRef || repository.defaultBranch || 'main',
      sha: existingRun.triggerSha || '',
      inputs: (existingRun.workflowInputs as Record<string, string>) || undefined,
    });

    await enqueuePipelineRun(newRun.id);

    return c.json({ run: newRun }, 201);
  }
);

// ============================================================================
// AI-Powered Features
// ============================================================================

// POST /api/v1/repos/:owner/:repo/pipelines/:slug/runs/:num/jobs/:jobId/analyze
cicdRoutes.post(
  '/repos/:owner/:repo/pipelines/:slug/runs/:num/jobs/:jobId/analyze',
  requireAuth,
  async (c) => {
    const { owner, repo, slug, num, jobId } = c.req.param();
    await getRepoWithAccess(c, owner, repo);

    const job = await getJobById(jobId);
    if (!job) {
      throw new NotFoundError('Job not found');
    }

    if (job.status !== 'failure') {
      throw new ValidationError('Job is not in a failed state');
    }

    const analysis = await analyzeFailure(jobId);
    if (!analysis) {
      throw new ValidationError('Could not analyze failure. AI service may be unavailable.');
    }

    return c.json({ analysis });
  }
);

// POST /api/v1/repos/:owner/:repo/pipelines/:slug/runs/:num/jobs/:jobId/suggest-fixes
cicdRoutes.post(
  '/repos/:owner/:repo/pipelines/:slug/runs/:num/jobs/:jobId/suggest-fixes',
  requireAuth,
  async (c) => {
    const { owner, repo, slug, num, jobId } = c.req.param();
    await getRepoWithAccess(c, owner, repo);

    const job = await getJobById(jobId);
    if (!job) {
      throw new NotFoundError('Job not found');
    }

    const fixes = await suggestFixes(jobId);

    return c.json({ fixes });
  }
);

// GET /api/v1/repos/:owner/:repo/pipelines/:slug/optimizations - Get optimization suggestions
cicdRoutes.get(
  '/repos/:owner/:repo/pipelines/:slug/optimizations',
  requireAuth,
  async (c) => {
    const { owner, repo, slug } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo);

    const pipeline = await getPipelineBySlug(repositoryId, slug);
    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    const optimizations = await suggestPipelineOptimizations(pipeline.id);

    return c.json({
      optimizations: optimizations || [],
      cached: pipeline.aiSuggestedOptimizations,
    });
  }
);

// GET /api/v1/repos/:owner/:repo/analysis - Analyze repository
cicdRoutes.get(
  '/repos/:owner/:repo/analysis',
  requireAuth,
  async (c) => {
    const { owner, repo } = c.req.param();
    const { repositoryId } = await getRepoWithAccess(c, owner, repo);

    const analysis = await analyzeRepository(repositoryId);
    if (!analysis) {
      throw new ValidationError('Could not analyze repository. AI service may be unavailable.');
    }

    return c.json({ analysis });
  }
);

// ============================================================================
// MCP Tools API
// ============================================================================

// GET /api/v1/mcp/tools - List available MCP tools
cicdRoutes.get('/mcp/tools', requireAuth, async (c) => {
  const tools = getAvailableTools();
  return c.json({ tools });
});

// POST /api/v1/mcp/tools/:tool - Execute MCP tool
const executeToolSchema = z.object({
  args: z.record(z.any()),
});

cicdRoutes.post(
  '/mcp/tools/:tool',
  requireAuth,
  zValidator('json', executeToolSchema),
  async (c) => {
    const { tool } = c.req.param();
    const userId = c.get('userId');
    const { args } = c.req.valid('json');

    const result = await executeCICDTool(tool, args, { userId });

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ data: result.data });
  }
);

// POST /api/v1/mcp/command - Process natural language command
const commandSchema = z.object({
  command: z.string().min(1).max(500),
  context: z
    .object({
      repositoryId: z.string().optional(),
      pipelineId: z.string().optional(),
      runId: z.string().optional(),
    })
    .optional(),
});

cicdRoutes.post(
  '/mcp/command',
  requireAuth,
  zValidator('json', commandSchema),
  async (c) => {
    const userId = c.get('userId');
    const { command, context } = c.req.valid('json');

    const result = await processNaturalLanguageCommand(command, {
      userId,
      ...context,
    });

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ data: result.data });
  }
);

// ============================================================================
// Queue Stats (Admin)
// ============================================================================

cicdRoutes.get('/ci/stats', requireAuth, async (c) => {
  const stats = await getQueueStats();
  return c.json({ stats });
});

export default cicdRoutes;
