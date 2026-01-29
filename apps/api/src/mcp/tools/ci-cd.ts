/**
 * MCP Tools for CI/CD
 * Exposes CI/CD functionality to AI agents via Model Context Protocol
 */

import { db } from '../../db';
import { pipelines, pipelineRuns, pipelineJobs } from '../../db/schema/ci-cd';
import { repositories } from '../../db/schema/repositories';
import { eq, and, desc } from 'drizzle-orm';
import {
  createPipeline,
  getPipelineBySlug,
  listPipelines,
  triggerPipeline,
  getPipelineRunByNumber,
  cancelPipelineRun,
  getRunJobs,
} from '../../services/ci/pipeline.service';
import type { PipelineJob } from '../../db/schema/ci-cd';
import {
  analyzeFailure,
  suggestFixes,
  analyzePerformance,
  summarizeRun,
} from '../../services/ci/ai-analysis.service';
import {
  generatePipelineFromPrompt,
  analyzeRepository,
  suggestPipelineOptimizations,
  selectAffectedTests,
  parseNaturalLanguageCommand,
} from '../../services/ci/ai-generator.service';
import { parsePipelineYaml } from '../../services/ci/pipeline-parser';
import { logger } from '../../utils/logger';

/**
 * MCP Tool Definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      default?: any;
    }>;
    required?: string[];
  };
}

/**
 * MCP Tool Handler Result
 */
export interface MCPToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * CI/CD MCP Tool Definitions
 */
export const cicdTools: MCPTool[] = [
  {
    name: 'create_pipeline',
    description: 'Generate a CI/CD pipeline from a natural language description. Uses AI to analyze the repository and create an appropriate pipeline configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        repository: {
          type: 'string',
          description: 'Repository identifier in the format "owner/repo"',
        },
        prompt: {
          type: 'string',
          description: 'Natural language description of what the pipeline should do. Examples: "Build and test my Node.js app", "Deploy to staging on PR merge", "Run linting and type checking"',
        },
      },
      required: ['repository', 'prompt'],
    },
  },
  {
    name: 'trigger_run',
    description: 'Start a pipeline run. Triggers execution of the specified pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        repository: {
          type: 'string',
          description: 'Repository identifier in the format "owner/repo"',
        },
        pipeline_slug: {
          type: 'string',
          description: 'The slug/identifier of the pipeline to run',
        },
        ref: {
          type: 'string',
          description: 'Git ref to run against (branch or tag). Defaults to default branch.',
        },
        inputs: {
          type: 'string',
          description: 'JSON string of workflow inputs for workflow_dispatch triggers',
        },
      },
      required: ['repository', 'pipeline_slug'],
    },
  },
  {
    name: 'get_run_status',
    description: 'Get the status of a pipeline run. Returns detailed information including job statuses and any AI failure analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        repository: {
          type: 'string',
          description: 'Repository identifier in the format "owner/repo"',
        },
        pipeline_slug: {
          type: 'string',
          description: 'The slug/identifier of the pipeline',
        },
        run_number: {
          type: 'number',
          description: 'The run number to check',
        },
      },
      required: ['repository', 'pipeline_slug', 'run_number'],
    },
  },
  {
    name: 'analyze_failure',
    description: 'Analyze why a pipeline job failed. Uses AI to identify the root cause and categorize the failure.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'The ID of the failed job to analyze',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'suggest_fixes',
    description: 'Get AI-powered suggestions for fixing a failed job. Returns concrete code changes and commands to resolve the issue.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'The ID of the failed job to get fix suggestions for',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'list_pipelines',
    description: 'List all pipelines for a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repository: {
          type: 'string',
          description: 'Repository identifier in the format "owner/repo"',
        },
      },
      required: ['repository'],
    },
  },
  {
    name: 'cancel_run',
    description: 'Cancel a running pipeline execution.',
    inputSchema: {
      type: 'object',
      properties: {
        repository: {
          type: 'string',
          description: 'Repository identifier in the format "owner/repo"',
        },
        pipeline_slug: {
          type: 'string',
          description: 'The slug/identifier of the pipeline',
        },
        run_number: {
          type: 'number',
          description: 'The run number to cancel',
        },
      },
      required: ['repository', 'pipeline_slug', 'run_number'],
    },
  },
  {
    name: 'suggest_optimizations',
    description: 'Get AI-powered suggestions to optimize a pipeline for better performance.',
    inputSchema: {
      type: 'object',
      properties: {
        repository: {
          type: 'string',
          description: 'Repository identifier in the format "owner/repo"',
        },
        pipeline_slug: {
          type: 'string',
          description: 'The slug/identifier of the pipeline to optimize',
        },
      },
      required: ['repository', 'pipeline_slug'],
    },
  },
  {
    name: 'select_tests',
    description: 'Intelligently select which tests to run based on changed files. Uses AI to analyze code dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        repository: {
          type: 'string',
          description: 'Repository identifier in the format "owner/repo"',
        },
        changed_files: {
          type: 'string',
          description: 'JSON array of changed file paths',
        },
      },
      required: ['repository', 'changed_files'],
    },
  },
  {
    name: 'analyze_repository',
    description: 'Analyze a repository to understand its structure, languages, frameworks, and build requirements.',
    inputSchema: {
      type: 'object',
      properties: {
        repository: {
          type: 'string',
          description: 'Repository identifier in the format "owner/repo"',
        },
      },
      required: ['repository'],
    },
  },
];

/**
 * Parse repository identifier into owner and slug
 */
function parseRepoIdentifier(repo: string): { owner: string; slug: string } | null {
  const parts = repo.split('/');
  if (parts.length !== 2) return null;
  return { owner: parts[0], slug: parts[1] };
}

/**
 * Get repository ID from owner/slug
 */
async function getRepositoryId(owner: string, slug: string): Promise<string | null> {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.slug, slug),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repo) return null;

  const repoOwner = repo.organization?.slug || repo.owner?.username;
  if (repoOwner !== owner) return null;

  return repo.id;
}

/**
 * Execute a CI/CD MCP tool
 */
export async function executeCICDTool(
  toolName: string,
  args: Record<string, any>,
  context: { userId?: string }
): Promise<MCPToolResult> {
  logger.info('ci', 'Executing MCP tool', { toolName, args });

  try {
    switch (toolName) {
      case 'create_pipeline': {
        const repoId = parseRepoIdentifier(args.repository);
        if (!repoId) {
          return { success: false, error: 'Invalid repository format. Use "owner/repo".' };
        }

        const repositoryId = await getRepositoryId(repoId.owner, repoId.slug);
        if (!repositoryId) {
          return { success: false, error: 'Repository not found.' };
        }

        if (!context.userId) {
          return { success: false, error: 'Authentication required.' };
        }

        const generated = await generatePipelineFromPrompt(
          repositoryId,
          context.userId,
          args.prompt
        );

        if (!generated) {
          return { success: false, error: 'Failed to generate pipeline. AI service may be unavailable.' };
        }

        return {
          success: true,
          data: {
            yaml: generated.yaml,
            confidence: generated.confidence,
            reasoning: generated.reasoning,
            alternatives: generated.alternatives.map((a) => ({
              name: a.name,
              description: a.description,
            })),
          },
        };
      }

      case 'trigger_run': {
        const repoId = parseRepoIdentifier(args.repository);
        if (!repoId) {
          return { success: false, error: 'Invalid repository format.' };
        }

        const repositoryId = await getRepositoryId(repoId.owner, repoId.slug);
        if (!repositoryId) {
          return { success: false, error: 'Repository not found.' };
        }

        const pipeline = await getPipelineBySlug(repositoryId, args.pipeline_slug);
        if (!pipeline) {
          return { success: false, error: 'Pipeline not found.' };
        }

        const inputs = args.inputs ? JSON.parse(args.inputs) : undefined;
        const run = await triggerPipeline({
          pipelineId: pipeline.id,
          trigger: 'api',
          triggeredBy: context.userId,
          ref: args.ref || 'main',
          sha: '', // Will be resolved by the service
          inputs,
        });

        return {
          success: true,
          data: {
            runId: run.id,
            runNumber: run.number,
            status: run.status,
            message: `Pipeline run #${run.number} started.`,
          },
        };
      }

      case 'get_run_status': {
        const repoId = parseRepoIdentifier(args.repository);
        if (!repoId) {
          return { success: false, error: 'Invalid repository format.' };
        }

        const repositoryId = await getRepositoryId(repoId.owner, repoId.slug);
        if (!repositoryId) {
          return { success: false, error: 'Repository not found.' };
        }

        const pipeline = await getPipelineBySlug(repositoryId, args.pipeline_slug);
        if (!pipeline) {
          return { success: false, error: 'Pipeline not found.' };
        }

        const run = await getPipelineRunByNumber(pipeline.id, args.run_number);
        if (!run) {
          return { success: false, error: 'Run not found.' };
        }

        // Get jobs for this run
        const jobs = await getRunJobs(run.id);

        // Generate summary if completed
        let summary: string | null = null;
        if (run.status !== 'pending' && run.status !== 'running') {
          summary = await summarizeRun(run.id);
        }

        return {
          success: true,
          data: {
            runNumber: run.number,
            status: run.status,
            trigger: run.trigger,
            duration: run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : null,
            jobs: jobs.map((j: PipelineJob) => ({
              name: j.name,
              status: j.status,
              duration: j.durationMs ? `${Math.round(j.durationMs / 1000)}s` : null,
            })),
            aiAnalysis: run.aiFailureAnalysis,
            aiSuggestedFixes: run.aiSuggestedFixes,
            summary,
          },
        };
      }

      case 'analyze_failure': {
        const analysis = await analyzeFailure(args.job_id);
        if (!analysis) {
          return { success: false, error: 'Could not analyze failure. Job may not be failed or AI service unavailable.' };
        }

        return {
          success: true,
          data: analysis,
        };
      }

      case 'suggest_fixes': {
        const fixes = await suggestFixes(args.job_id);
        if (fixes.length === 0) {
          return { success: false, error: 'Could not generate fix suggestions.' };
        }

        return {
          success: true,
          data: { fixes },
        };
      }

      case 'list_pipelines': {
        const repoId = parseRepoIdentifier(args.repository);
        if (!repoId) {
          return { success: false, error: 'Invalid repository format.' };
        }

        const repositoryId = await getRepositoryId(repoId.owner, repoId.slug);
        if (!repositoryId) {
          return { success: false, error: 'Repository not found.' };
        }

        const pipelineList = await listPipelines(repositoryId);

        return {
          success: true,
          data: {
            pipelines: pipelineList.map((p) => ({
              name: p.name,
              slug: p.slug,
              isActive: p.isActive,
              totalRuns: p.totalRuns,
              successRate: p.totalRuns
                ? `${Math.round(((p.successfulRuns || 0) / p.totalRuns) * 100)}%`
                : 'N/A',
              lastRun: p.lastRunAt?.toISOString(),
            })),
          },
        };
      }

      case 'cancel_run': {
        const repoId = parseRepoIdentifier(args.repository);
        if (!repoId) {
          return { success: false, error: 'Invalid repository format.' };
        }

        const repositoryId = await getRepositoryId(repoId.owner, repoId.slug);
        if (!repositoryId) {
          return { success: false, error: 'Repository not found.' };
        }

        const pipeline = await getPipelineBySlug(repositoryId, args.pipeline_slug);
        if (!pipeline) {
          return { success: false, error: 'Pipeline not found.' };
        }

        const run = await getPipelineRunByNumber(pipeline.id, args.run_number);
        if (!run) {
          return { success: false, error: 'Run not found.' };
        }

        await cancelPipelineRun(run.id);

        return {
          success: true,
          data: { message: `Run #${args.run_number} cancelled.` },
        };
      }

      case 'suggest_optimizations': {
        const repoId = parseRepoIdentifier(args.repository);
        if (!repoId) {
          return { success: false, error: 'Invalid repository format.' };
        }

        const repositoryId = await getRepositoryId(repoId.owner, repoId.slug);
        if (!repositoryId) {
          return { success: false, error: 'Repository not found.' };
        }

        const pipeline = await getPipelineBySlug(repositoryId, args.pipeline_slug);
        if (!pipeline) {
          return { success: false, error: 'Pipeline not found.' };
        }

        const optimizations = await suggestPipelineOptimizations(pipeline.id);
        if (!optimizations) {
          return { success: false, error: 'Could not generate optimizations.' };
        }

        return {
          success: true,
          data: { optimizations },
        };
      }

      case 'select_tests': {
        const repoId = parseRepoIdentifier(args.repository);
        if (!repoId) {
          return { success: false, error: 'Invalid repository format.' };
        }

        const repositoryId = await getRepositoryId(repoId.owner, repoId.slug);
        if (!repositoryId) {
          return { success: false, error: 'Repository not found.' };
        }

        const changedFiles = JSON.parse(args.changed_files);
        const selection = await selectAffectedTests(repositoryId, changedFiles);
        if (!selection) {
          return { success: false, error: 'Could not select tests.' };
        }

        return {
          success: true,
          data: selection,
        };
      }

      case 'analyze_repository': {
        const repoId = parseRepoIdentifier(args.repository);
        if (!repoId) {
          return { success: false, error: 'Invalid repository format.' };
        }

        const repositoryId = await getRepositoryId(repoId.owner, repoId.slug);
        if (!repositoryId) {
          return { success: false, error: 'Repository not found.' };
        }

        const analysis = await analyzeRepository(repositoryId);
        if (!analysis) {
          return { success: false, error: 'Could not analyze repository.' };
        }

        return {
          success: true,
          data: analysis,
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    logger.error('ci', 'MCP tool execution error', { toolName, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Process a natural language command and execute the appropriate tool
 */
export async function processNaturalLanguageCommand(
  command: string,
  context: { userId?: string; repositoryId?: string; pipelineId?: string; runId?: string }
): Promise<MCPToolResult> {
  const parsed = await parseNaturalLanguageCommand(command, context);

  if (!parsed) {
    return {
      success: false,
      error: 'Could not understand the command. Try being more specific.',
    };
  }

  return executeCICDTool(parsed.tool, parsed.args, { userId: context.userId });
}

/**
 * Get all available CI/CD tools (for MCP server listing)
 */
export function getAvailableTools(): MCPTool[] {
  return cicdTools;
}
