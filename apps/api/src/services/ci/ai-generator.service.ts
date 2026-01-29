/**
 * AI Generator Service for CI/CD
 * Generates pipelines from natural language and analyzes repositories
 */

import { env } from '../../config/env';
import { db } from '../../db';
import { repositories } from '../../db/schema/repositories';
import { aiPipelineGenerations, pipelines } from '../../db/schema/ci-cd';
import type { PipelineDefinition, RepoAnalysis as SchemaRepoAnalysis, AISuggestion, AlternativePipeline } from '../../db/schema/ci-cd';
import { eq } from 'drizzle-orm';
import { logger } from '../../utils/logger';
import * as gitBackend from '../git/git-backend.service';
import { serializePipelineToYaml } from './pipeline-parser';

// Model for generation tasks
const GENERATOR_MODEL = 'anthropic/claude-3.5-sonnet';

/**
 * Check if AI generator is available
 */
export function isAIGeneratorAvailable(): boolean {
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
  const { model = GENERATOR_MODEL, maxTokens = 4000, temperature = 0.5 } = options;

  if (!env.OPENROUTER_API_KEY) {
    throw new Error('AI generator not configured. Set OPENROUTER_API_KEY.');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.APP_URL,
      'X-Title': 'CV-Hub Pipeline Generator',
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
 * Parse JSON from LLM response
 */
function parseJSONResponse<T>(text: string): T | null {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    logger.warn('ci', 'Failed to parse LLM JSON response', { text: text.slice(0, 200) });
    return null;
  }
}

/**
 * Repository analysis result
 */
export interface RepoAnalysis {
  languages: { name: string; percentage: number }[];
  frameworks: string[];
  buildTools: string[];
  testFrameworks: string[];
  packageManagers: string[];
  hasDocker: boolean;
  hasTests: boolean;
  hasLinting: boolean;
  structure: {
    hasMonorepo: boolean;
    mainDirectories: string[];
    entryPoints: string[];
  };
  recommendations: string[];
}

/**
 * Analyze a repository to understand its structure
 */
export async function analyzeRepository(repositoryId: string): Promise<RepoAnalysis | null> {
  if (!isAIGeneratorAvailable()) {
    return null;
  }

  // Get repository info
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repo) return null;

  const ownerSlug = repo.organization?.slug || repo.owner?.username || '';

  try {
    // Get file tree
    const tree = await gitBackend.getTreeRecursive(ownerSlug, repo.slug, repo.defaultBranch || 'main');

    // Get key configuration files
    const configFiles: Record<string, string> = {};
    const keyFiles = [
      'package.json',
      'pnpm-workspace.yaml',
      'yarn.lock',
      'pnpm-lock.yaml',
      'package-lock.json',
      'Cargo.toml',
      'go.mod',
      'requirements.txt',
      'pyproject.toml',
      'Pipfile',
      'build.gradle',
      'pom.xml',
      'Makefile',
      'Dockerfile',
      'docker-compose.yml',
      '.eslintrc.json',
      '.prettierrc',
      'tsconfig.json',
      'jest.config.js',
      'vitest.config.ts',
      '.github/workflows',
    ];

    for (const file of tree) {
      if (file.type === 'blob' && keyFiles.some((kf) => file.path.endsWith(kf) || file.path.includes(kf))) {
        try {
          const blob = await gitBackend.getBlob(ownerSlug, repo.slug, repo.defaultBranch || 'main', file.path);
          if (!blob.isBinary && blob.content) {
            configFiles[file.path] = blob.content.slice(0, 2000); // Limit size
          }
        } catch {
          // File might not be readable
        }
      }
    }

    const systemPrompt = `You are a repository analysis expert. Analyze repository structure and configuration.

Respond with JSON:
{
  "languages": [{"name": "TypeScript", "percentage": 70}],
  "frameworks": ["React", "Express"],
  "buildTools": ["esbuild", "tsc"],
  "testFrameworks": ["vitest", "playwright"],
  "packageManagers": ["pnpm"],
  "hasDocker": true,
  "hasTests": true,
  "hasLinting": true,
  "structure": {
    "hasMonorepo": true,
    "mainDirectories": ["apps/web", "apps/api", "packages/shared"],
    "entryPoints": ["apps/web/src/main.tsx", "apps/api/src/index.ts"]
  },
  "recommendations": ["Add caching for node_modules", "Run tests in parallel"]
}`;

    const fileList = tree
      .filter((f) => f.type === 'blob')
      .slice(0, 200)
      .map((f) => f.path)
      .join('\n');

    const userPrompt = `Analyze this repository:

File tree (first 200 files):
${fileList}

Configuration files found:
${Object.entries(configFiles)
  .map(([path, content]) => `--- ${path} ---\n${content}`)
  .join('\n\n')}

Identify languages, frameworks, build tools, and provide recommendations for CI/CD.`;

    const response = await callLLM(systemPrompt, userPrompt, {
      maxTokens: 2000,
      temperature: 0.2,
    });

    const analysis = parseJSONResponse<RepoAnalysis>(response);

    if (analysis) {
      logger.info('ci', 'Repository analysis completed', {
        repositoryId,
        languages: analysis.languages.map((l) => l.name),
        frameworks: analysis.frameworks,
      });
    }

    return analysis;
  } catch (error: any) {
    logger.error('ci', 'Repository analysis error', { repositoryId, error: error.message });
    return null;
  }
}

/**
 * Generated pipeline result
 */
export interface GeneratedPipeline {
  definition: PipelineDefinition;
  yaml: string;
  confidence: number;
  reasoning: string;
  alternatives: {
    name: string;
    description: string;
    definition: PipelineDefinition;
  }[];
}

/**
 * Generate a pipeline from natural language prompt
 */
export async function generatePipelineFromPrompt(
  repositoryId: string,
  userId: string,
  prompt: string
): Promise<GeneratedPipeline | null> {
  if (!isAIGeneratorAvailable()) {
    return null;
  }

  // First analyze the repository
  const repoAnalysis = await analyzeRepository(repositoryId);

  const systemPrompt = `You are a CI/CD pipeline generator. Create pipeline definitions based on user requirements.

Your output must be a valid pipeline definition in this JSON format:
{
  "definition": {
    "version": "1.0",
    "name": "Pipeline Name",
    "on": {
      "push": { "branches": ["main"] },
      "pull_request": { "branches": ["main"] }
    },
    "stages": [
      {
        "name": "Build",
        "jobs": [
          {
            "name": "build-app",
            "key": "build",
            "runsOn": "ubuntu-latest",
            "container": { "image": "node:20-alpine" },
            "steps": [
              { "name": "Checkout", "uses": "checkout@v1" },
              { "name": "Install", "run": "npm ci" },
              { "name": "Build", "run": "npm run build" }
            ]
          }
        ]
      }
    ]
  },
  "confidence": 85,
  "reasoning": "Explanation of choices made",
  "alternatives": []
}

Built-in actions: checkout@v1, upload-artifact@v1, download-artifact@v1, cache@v1, setup-node@v1, setup-python@v1

Guidelines:
- Use appropriate container images for the language/framework
- Include caching when beneficial
- Add appropriate triggers based on the request
- Provide reasoning for your choices`;

  const userPrompt = `Generate a pipeline based on this request:
"${prompt}"

${
  repoAnalysis
    ? `Repository Analysis:
Languages: ${repoAnalysis.languages.map((l) => `${l.name} (${l.percentage}%)`).join(', ')}
Frameworks: ${repoAnalysis.frameworks.join(', ') || 'None detected'}
Build Tools: ${repoAnalysis.buildTools.join(', ') || 'None detected'}
Test Frameworks: ${repoAnalysis.testFrameworks.join(', ') || 'None detected'}
Package Manager: ${repoAnalysis.packageManagers.join(', ') || 'Unknown'}
Has Docker: ${repoAnalysis.hasDocker}
Has Tests: ${repoAnalysis.hasTests}
Monorepo: ${repoAnalysis.structure.hasMonorepo}
Main Directories: ${repoAnalysis.structure.mainDirectories.join(', ')}
Recommendations: ${repoAnalysis.recommendations.join('; ')}`
    : 'No repository analysis available'
}

Generate a pipeline that addresses the user's request.`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      maxTokens: 4000,
      temperature: 0.5,
    });

    const result = parseJSONResponse<{
      definition: PipelineDefinition;
      confidence: number;
      reasoning: string;
      alternatives: { name: string; description: string; definition: PipelineDefinition }[];
    }>(response);

    if (!result?.definition) {
      logger.warn('ci', 'Failed to generate pipeline', { prompt });
      return null;
    }

    // Generate YAML from definition
    const yaml = serializePipelineToYaml(result.definition);

    // Convert to schema type for storage
    const schemaRepoAnalysis: SchemaRepoAnalysis | null = repoAnalysis
      ? {
          languages: repoAnalysis.languages,
          frameworks: repoAnalysis.frameworks,
          packageManagers: repoAnalysis.packageManagers,
          hasTests: repoAnalysis.hasTests,
          testFrameworks: repoAnalysis.testFrameworks,
          buildTools: repoAnalysis.buildTools,
          deploymentTargets: [], // Not captured in our analysis
        }
      : null;

    // Convert alternatives to schema format (needs yaml field)
    const schemaAlternatives: AlternativePipeline[] = (result.alternatives || []).map((alt) => ({
      name: alt.name,
      description: alt.description,
      yaml: serializePipelineToYaml(alt.definition),
    }));

    // Store the generation
    await db.insert(aiPipelineGenerations).values({
      repositoryId,
      userId,
      prompt,
      repoAnalysis: schemaRepoAnalysis,
      generatedYaml: yaml,
      generatedDefinition: result.definition,
      model: GENERATOR_MODEL,
      confidence: result.confidence,
      reasoning: result.reasoning,
      alternatives: schemaAlternatives,
    });

    logger.info('ci', 'Pipeline generated', {
      repositoryId,
      confidence: result.confidence,
      stageCount: result.definition.stages.length,
    });

    return {
      definition: result.definition,
      yaml,
      confidence: result.confidence,
      reasoning: result.reasoning,
      alternatives: result.alternatives || [],
    };
  } catch (error: any) {
    logger.error('ci', 'Pipeline generation error', { repositoryId, error: error.message });
    return null;
  }
}

/**
 * Suggest optimizations for an existing pipeline
 */
export async function suggestPipelineOptimizations(
  pipelineId: string
): Promise<{ title: string; description: string; impact: string }[] | null> {
  if (!isAIGeneratorAvailable()) {
    return null;
  }

  const pipeline = await db.query.pipelines.findFirst({
    where: eq(pipelines.id, pipelineId),
  });

  if (!pipeline) return null;

  const systemPrompt = `You are a CI/CD optimization expert. Suggest improvements for pipelines.

Respond with a JSON array:
[
  {
    "title": "Optimization title",
    "description": "What to change and why",
    "impact": "Expected improvement"
  }
]

Focus on:
- Parallelization opportunities
- Caching strategies
- Step consolidation
- Resource optimization
- Best practices`;

  const userPrompt = `Optimize this pipeline:

${JSON.stringify(pipeline.definition, null, 2)}

Stats:
- Total Runs: ${pipeline.totalRuns}
- Success Rate: ${Math.round(((pipeline.successfulRuns || 0) / Math.max(pipeline.totalRuns || 1, 1)) * 100)}%
- Avg Duration: ${pipeline.avgDurationMs ? Math.round(pipeline.avgDurationMs / 1000) + 's' : 'N/A'}`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      maxTokens: 2000,
      temperature: 0.4,
    });

    const optimizations = parseJSONResponse<{ title: string; description: string; impact: string }[]>(response);

    if (optimizations && optimizations.length > 0) {
      // Convert to AISuggestion format for storage
      const suggestions: AISuggestion[] = optimizations.map((opt, idx) => ({
        type: 'optimization',
        title: opt.title,
        description: `${opt.description} (Impact: ${opt.impact})`,
        priority: idx + 1,
      }));

      // Store optimizations
      await db
        .update(pipelines)
        .set({
          aiSuggestedOptimizations: suggestions,
          updatedAt: new Date(),
        })
        .where(eq(pipelines.id, pipelineId));

      logger.info('ci', 'Pipeline optimizations generated', {
        pipelineId,
        count: optimizations.length,
      });
    }

    return optimizations;
  } catch (error: any) {
    logger.error('ci', 'Optimization suggestion error', { pipelineId, error: error.message });
    return null;
  }
}

/**
 * Select affected tests based on changed files
 */
export async function selectAffectedTests(
  repositoryId: string,
  changedFiles: string[]
): Promise<{
  testFiles: string[];
  testCommands: string[];
  reasoning: string;
} | null> {
  if (!isAIGeneratorAvailable()) {
    return null;
  }

  // Get repository info
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repo) return null;

  const ownerSlug = repo.organization?.slug || repo.owner?.username || '';

  // Get test files in the repo
  const tree = await gitBackend.getTreeRecursive(ownerSlug, repo.slug, repo.defaultBranch || 'main');

  const testFiles = tree
    .filter(
      (f) =>
        f.type === 'blob' &&
        (f.path.includes('.test.') ||
          f.path.includes('.spec.') ||
          f.path.includes('__tests__') ||
          f.path.endsWith('_test.go') ||
          f.path.endsWith('_test.py'))
    )
    .map((f) => f.path);

  const systemPrompt = `You are a test selection expert. Based on changed files, identify which tests should run.

Respond with JSON:
{
  "testFiles": ["path/to/test1.spec.ts", "path/to/test2.test.ts"],
  "testCommands": ["npm test -- --grep 'component'"],
  "reasoning": "Why these tests were selected"
}

Selection criteria:
- Tests in the same directory as changed files
- Tests that import changed modules
- Integration tests for affected features
- If unsure, include more tests rather than fewer`;

  const userPrompt = `Changed files:
${changedFiles.join('\n')}

Available test files:
${testFiles.join('\n')}

Select which tests should run.`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      maxTokens: 1500,
      temperature: 0.2,
    });

    const result = parseJSONResponse<{
      testFiles: string[];
      testCommands: string[];
      reasoning: string;
    }>(response);

    if (result) {
      logger.info('ci', 'Test selection completed', {
        repositoryId,
        changedFiles: changedFiles.length,
        selectedTests: result.testFiles.length,
      });
    }

    return result;
  } catch (error: any) {
    logger.error('ci', 'Test selection error', { repositoryId, error: error.message });
    return null;
  }
}

/**
 * Parse a natural language command into tool call
 */
export async function parseNaturalLanguageCommand(
  command: string,
  context: { repositoryId?: string; pipelineId?: string; runId?: string }
): Promise<{ tool: string; args: Record<string, any> } | null> {
  if (!isAIGeneratorAvailable()) {
    return null;
  }

  const systemPrompt = `You are a CI/CD assistant. Parse natural language into tool calls.

Available tools:
- trigger_run: { pipelineSlug: string } - Start a pipeline
- get_run_status: { runNumber: number } - Check run status
- analyze_failure: { jobId: string } - Analyze why a job failed
- suggest_fixes: { jobId: string } - Get fix suggestions
- create_pipeline: { prompt: string } - Generate a new pipeline
- list_pipelines: {} - List all pipelines
- cancel_run: { runNumber: number } - Cancel a running pipeline

Respond with JSON:
{
  "tool": "tool_name",
  "args": { "arg1": "value1" }
}

Or null if the command doesn't match any tool.`;

  const userPrompt = `Command: "${command}"
Context: ${JSON.stringify(context)}

Parse this into a tool call.`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      model: 'anthropic/claude-3-haiku',
      maxTokens: 200,
      temperature: 0,
    });

    return parseJSONResponse<{ tool: string; args: Record<string, any> }>(response);
  } catch {
    return null;
  }
}
