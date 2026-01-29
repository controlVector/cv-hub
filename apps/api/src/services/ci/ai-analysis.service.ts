/**
 * AI Analysis Service for CI/CD
 * Provides AI-powered failure analysis and fix suggestions
 */

import { env } from '../../config/env';
import { db } from '../../db';
import { pipelineJobs, pipelineRuns, pipelines } from '../../db/schema/ci-cd';
import type {
  PipelineJob,
  PipelineRun,
  Pipeline,
  AIFailureAnalysis,
  AISuggestedFix,
  StepResult,
} from '../../db/schema/ci-cd';
import { eq } from 'drizzle-orm';
import { logger } from '../../utils/logger';

// Models for different tasks
const ANALYSIS_MODEL = 'anthropic/claude-3.5-sonnet';
const QUICK_MODEL = 'anthropic/claude-3-haiku';

/**
 * Check if AI analysis is available
 */
export function isAIAnalysisAvailable(): boolean {
  return !!env.OPENROUTER_API_KEY;
}

/**
 * Call OpenRouter API
 */
async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options: { model?: string; maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const { model = ANALYSIS_MODEL, maxTokens = 2000, temperature = 0.3 } = options;

  if (!env.OPENROUTER_API_KEY) {
    throw new Error('AI analysis not configured. Set OPENROUTER_API_KEY.');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.APP_URL,
      'X-Title': 'CV-Hub CI/CD Analysis',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('ci', 'OpenRouter error', { status: response.status, error: errorText });
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
function parseJSONResponse<T>(text: string): T | null {
  // Try to extract JSON from markdown code block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    logger.warn('ci', 'Failed to parse LLM JSON response', { text });
    return null;
  }
}

/**
 * Analyze a failed job and determine root cause
 */
export async function analyzeFailure(
  jobId: string
): Promise<AIFailureAnalysis | null> {
  if (!isAIAnalysisAvailable()) {
    logger.warn('ci', 'AI analysis not available - skipping failure analysis');
    return null;
  }

  // Get job with run and pipeline info
  const job = await db.query.pipelineJobs.findFirst({
    where: eq(pipelineJobs.id, jobId),
    with: {
      run: {
        with: {
          pipeline: true,
        },
      },
    },
  });

  if (!job || job.status !== 'failure') {
    return null;
  }

  const stepResults = (job.stepResults as StepResult[]) || [];
  const failedStep = stepResults.find((s) => s.status === 'failure');

  // Build context for analysis
  const systemPrompt = `You are a CI/CD failure analysis expert. Analyze build/test failures and identify root causes.
You must respond with a JSON object in this exact format:
{
  "summary": "Brief one-line summary of the failure",
  "rootCause": "Detailed explanation of what caused the failure",
  "category": "build|test|dependency|config|infrastructure|unknown",
  "confidence": 85,
  "relatedLogs": ["relevant log line 1", "relevant log line 2"]
}

Categories explained:
- build: Compilation errors, syntax errors, build tool failures
- test: Test assertion failures, test timeouts
- dependency: Missing packages, version conflicts, npm/pip errors
- config: Misconfiguration, missing environment variables, invalid YAML
- infrastructure: Network issues, Docker errors, runner problems
- unknown: Cannot determine the cause`;

  const userPrompt = `Analyze this CI/CD job failure:

Job: ${job.name} (${job.jobKey})
Status: ${job.status}
Exit Code: ${job.exitCode}
Container Image: ${job.containerImage}

Steps Configuration:
${JSON.stringify(job.steps, null, 2)}

Step Results:
${JSON.stringify(stepResults, null, 2)}

${failedStep ? `Failed Step: ${failedStep.name}
Error: ${failedStep.error || 'No error message'}
Output: ${failedStep.output || 'No output'}` : ''}

Please analyze the failure and provide your response as JSON.`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      model: ANALYSIS_MODEL,
      temperature: 0.2,
    });

    const analysis = parseJSONResponse<AIFailureAnalysis>(response);

    if (analysis) {
      // Store analysis in database
      await db
        .update(pipelineRuns)
        .set({
          aiFailureAnalysis: analysis,
          updatedAt: new Date(),
        })
        .where(eq(pipelineRuns.id, job.runId));

      logger.info('ci', 'Failure analysis completed', {
        jobId,
        category: analysis.category,
        confidence: analysis.confidence,
      });
    }

    return analysis;
  } catch (error: any) {
    logger.error('ci', 'Failure analysis error', { jobId, error: error.message });
    return null;
  }
}

/**
 * Suggest fixes for a failed job
 */
export async function suggestFixes(
  jobId: string,
  analysis?: AIFailureAnalysis
): Promise<AISuggestedFix[]> {
  if (!isAIAnalysisAvailable()) {
    return [];
  }

  // Get analysis if not provided
  if (!analysis) {
    const job = await db.query.pipelineJobs.findFirst({
      where: eq(pipelineJobs.id, jobId),
      with: {
        run: true,
      },
    });

    if (!job) return [];

    analysis = job.run.aiFailureAnalysis as AIFailureAnalysis | null || undefined;

    // Run analysis first if needed
    if (!analysis) {
      analysis = (await analyzeFailure(jobId)) || undefined;
    }
  }

  if (!analysis) {
    return [];
  }

  const systemPrompt = `You are a CI/CD expert who suggests fixes for build failures.
Based on the failure analysis, suggest concrete fixes the developer can apply.

Respond with a JSON array of fixes in this format:
[
  {
    "title": "Fix title",
    "description": "What to do and why",
    "confidence": 90,
    "codeChanges": [
      { "file": "path/to/file", "diff": "--- old\\n+++ new\\n@@ ..."}
    ],
    "commands": ["npm install package-name"]
  }
]

- codeChanges and commands are optional
- Confidence should be 0-100
- Order by confidence (highest first)
- Maximum 5 suggestions`;

  const userPrompt = `Based on this failure analysis, suggest fixes:

Summary: ${analysis.summary}
Root Cause: ${analysis.rootCause}
Category: ${analysis.category}
Related Logs: ${analysis.relatedLogs?.join('\n') || 'None'}

Please suggest specific, actionable fixes.`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      model: ANALYSIS_MODEL,
      maxTokens: 3000,
      temperature: 0.4,
    });

    const fixes = parseJSONResponse<AISuggestedFix[]>(response);

    if (fixes && fixes.length > 0) {
      // Store fixes in database
      const job = await db.query.pipelineJobs.findFirst({
        where: eq(pipelineJobs.id, jobId),
      });

      if (job) {
        await db
          .update(pipelineRuns)
          .set({
            aiSuggestedFixes: fixes,
            updatedAt: new Date(),
          })
          .where(eq(pipelineRuns.id, job.runId));
      }

      logger.info('ci', 'Fix suggestions generated', {
        jobId,
        fixCount: fixes.length,
      });

      return fixes;
    }

    return [];
  } catch (error: any) {
    logger.error('ci', 'Fix suggestion error', { jobId, error: error.message });
    return [];
  }
}

/**
 * Analyze pipeline performance and suggest optimizations
 */
export async function analyzePerformance(
  pipelineId: string,
  runCount = 10
): Promise<{
  insights: string[];
  optimizations: { title: string; description: string; impact: string }[];
} | null> {
  if (!isAIAnalysisAvailable()) {
    return null;
  }

  // Get recent runs with jobs
  const pipeline = await db.query.pipelines.findFirst({
    where: eq(pipelines.id, pipelineId),
  });

  if (!pipeline) return null;

  const recentRuns = await db.query.pipelineRuns.findMany({
    where: eq(pipelineRuns.pipelineId, pipelineId),
    orderBy: (pipelineRuns, { desc }) => [desc(pipelineRuns.createdAt)],
    limit: runCount,
    with: {
      jobs: true,
    },
  });

  if (recentRuns.length < 3) {
    return null; // Need enough data for analysis
  }

  const systemPrompt = `You are a CI/CD performance optimization expert.
Analyze pipeline run history and suggest improvements.

Respond with JSON:
{
  "insights": ["Insight 1", "Insight 2"],
  "optimizations": [
    {
      "title": "Optimization title",
      "description": "What to change",
      "impact": "Expected improvement (e.g., '30% faster')"
    }
  ]
}`;

  const runStats = recentRuns.map((run) => ({
    status: run.status,
    duration: run.durationMs,
    jobCount: run.jobs.length,
    jobs: run.jobs.map((j) => ({
      name: j.name,
      status: j.status,
      duration: j.durationMs,
    })),
  }));

  const userPrompt = `Analyze this pipeline's performance:

Pipeline: ${pipeline.name}
Total Runs: ${pipeline.totalRuns}
Success Rate: ${pipeline.successfulRuns}/${pipeline.totalRuns} (${Math.round(((pipeline.successfulRuns || 0) / Math.max(pipeline.totalRuns || 1, 1)) * 100)}%)
Average Duration: ${pipeline.avgDurationMs ? Math.round(pipeline.avgDurationMs / 1000) + 's' : 'N/A'}

Recent Runs:
${JSON.stringify(runStats, null, 2)}

Pipeline Definition:
${JSON.stringify(pipeline.definition, null, 2)}

Identify patterns, bottlenecks, and optimization opportunities.`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      model: ANALYSIS_MODEL,
      maxTokens: 2000,
      temperature: 0.3,
    });

    const result = parseJSONResponse<{
      insights: string[];
      optimizations: { title: string; description: string; impact: string }[];
    }>(response);

    if (result) {
      // Convert to AISuggestion format for storage
      const suggestions = result.optimizations.map((opt, idx) => ({
        type: 'performance',
        title: opt.title,
        description: `${opt.description} (Impact: ${opt.impact})`,
        priority: idx + 1,
      }));

      // Store insights
      await db
        .update(pipelines)
        .set({
          aiSuggestedOptimizations: suggestions,
          updatedAt: new Date(),
        })
        .where(eq(pipelines.id, pipelineId));

      logger.info('ci', 'Performance analysis completed', {
        pipelineId,
        insightCount: result.insights.length,
        optimizationCount: result.optimizations.length,
      });
    }

    return result;
  } catch (error: any) {
    logger.error('ci', 'Performance analysis error', {
      pipelineId,
      error: error.message,
    });
    return null;
  }
}

/**
 * Quick categorization of a failure (uses faster model)
 */
export async function quickCategorize(
  errorMessage: string,
  output?: string
): Promise<AIFailureAnalysis['category']> {
  if (!isAIAnalysisAvailable()) {
    return 'unknown';
  }

  const systemPrompt = `Categorize this CI/CD error into one of: build, test, dependency, config, infrastructure, unknown
Respond with just the category word.`;

  const userPrompt = `Error: ${errorMessage}
${output ? `Output: ${output.slice(0, 500)}` : ''}`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      model: QUICK_MODEL,
      maxTokens: 20,
      temperature: 0,
    });

    const category = response.trim().toLowerCase() as AIFailureAnalysis['category'];
    const validCategories = ['build', 'test', 'dependency', 'config', 'infrastructure', 'unknown'];

    return validCategories.includes(category) ? category : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Generate a human-readable summary of a run
 */
export async function summarizeRun(runId: string): Promise<string | null> {
  if (!isAIAnalysisAvailable()) {
    return null;
  }

  const run = await db.query.pipelineRuns.findFirst({
    where: eq(pipelineRuns.id, runId),
    with: {
      pipeline: true,
      jobs: true,
    },
  });

  if (!run) return null;

  const systemPrompt = `Generate a brief, human-readable summary of this CI/CD pipeline run.
Keep it to 2-3 sentences. Be specific about what passed/failed.`;

  const userPrompt = `Pipeline: ${run.pipeline.name}
Status: ${run.status}
Duration: ${run.durationMs ? Math.round(run.durationMs / 1000) + 's' : 'N/A'}
Trigger: ${run.trigger}

Jobs:
${run.jobs.map((j) => `- ${j.name}: ${j.status}`).join('\n')}`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      model: QUICK_MODEL,
      maxTokens: 150,
      temperature: 0.3,
    });

    return response.trim();
  } catch {
    return null;
  }
}
