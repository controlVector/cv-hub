/**
 * AI Deployment Intelligence Service
 *
 * Pre-deploy risk assessment, post-deploy health checks, and auto-rollback
 * using the same OpenRouter/LLM pattern as ai-analysis.service.ts.
 */

import { spawn } from 'child_process';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import type { WorkspaceConfig } from './job-dispatch.service';
import { getDeployProvider } from './providers';

// Use the same model as ai-analysis.service.ts
const ANALYSIS_MODEL = 'anthropic/claude-3.5-sonnet';

// =============================================================================
// LLM Helper (mirrors ai-analysis.service.ts callLLM)
// =============================================================================

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
      'X-Title': 'CV-Hub CI/CD Deploy Intelligence',
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
    logger.error('ci', 'OpenRouter error in deploy service', { status: response.status, error: errorText });
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

function parseJSONResponse<T>(text: string): T | null {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    logger.warn('ci', 'Failed to parse LLM JSON response in deploy service', { text: text.slice(0, 500) });
    return null;
  }
}

// =============================================================================
// Risk Assessment
// =============================================================================

export interface RiskAssessmentResult {
  riskLevel: 'low' | 'medium' | 'high';
  reasoning: string;
  recommendations: string[];
}

/**
 * Assess deployment risk by analyzing changed files
 */
export async function assessDeploymentRisk(
  workspacePath: string,
  workspace: WorkspaceConfig
): Promise<RiskAssessmentResult> {
  // Default result when AI is unavailable
  const defaultResult: RiskAssessmentResult = {
    riskLevel: 'low',
    reasoning: 'AI analysis unavailable - defaulting to low risk',
    recommendations: ['Manual review recommended'],
  };

  if (!env.OPENROUTER_API_KEY) {
    return defaultResult;
  }

  let diffStat = '';
  let diffContent = '';

  try {
    diffStat = await runGitCommand(workspacePath, 'git diff --stat HEAD~1..HEAD');
    diffContent = await runGitCommand(workspacePath, 'git diff HEAD~1..HEAD --no-color');
    // Truncate large diffs
    if (diffContent.length > 8000) {
      diffContent = diffContent.slice(0, 8000) + '\n... (truncated)';
    }
  } catch {
    // Might be the first commit - no diff available
    diffStat = 'Unable to generate diff (possibly initial commit)';
    diffContent = '';
  }

  // Categorize changed files
  const categories = categorizeChanges(diffStat);

  const systemPrompt = `You are a deployment risk assessment expert for a CI/CD platform.
Analyze the changes being deployed and assess the risk level.

You must respond with JSON in this exact format:
{
  "riskLevel": "low|medium|high",
  "reasoning": "One paragraph explaining the risk assessment",
  "recommendations": ["recommendation 1", "recommendation 2"]
}

Risk level guidelines:
- LOW: Tests-only, documentation, non-critical UI changes, adding new features with tests
- MEDIUM: API route changes, dependency updates, configuration changes
- HIGH: Database schema migrations, infrastructure changes, environment variable changes combined with service config, changes affecting authentication/authorization`;

  const userPrompt = `Assess deployment risk for these changes:

Repository: ${workspace.ownerSlug}/${workspace.repoSlug}
Branch: ${workspace.ref}
Commit: ${workspace.sha}

File Change Summary:
${diffStat}

Change Categories Detected:
${categories.join(', ') || 'none'}

Diff (partial):
${diffContent || 'No diff available'}

Please analyze the risk level and provide your assessment as JSON.`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      temperature: 0.2,
    });

    const result = parseJSONResponse<RiskAssessmentResult>(response);

    if (result) {
      logger.info('ci', 'Risk assessment completed', {
        riskLevel: result.riskLevel,
        repo: `${workspace.ownerSlug}/${workspace.repoSlug}`,
      });

      if (result.riskLevel === 'high') {
        logger.warn('ci', 'HIGH RISK deployment detected', {
          repo: `${workspace.ownerSlug}/${workspace.repoSlug}`,
          reasoning: result.reasoning,
        });
      }

      return result;
    }

    return defaultResult;
  } catch (error: any) {
    logger.error('ci', 'Risk assessment failed', { error: error.message });
    return defaultResult;
  }
}

// =============================================================================
// Health Check
// =============================================================================

export interface HealthCheckResult {
  healthy: boolean;
  analysis: string;
  rollbackRecommended: boolean;
}

/**
 * Post-deploy health check with retries and AI analysis on failure
 */
export async function checkDeploymentHealth(
  url: string,
  options: { timeout?: number; retries?: number; intervalMs?: number } = {}
): Promise<HealthCheckResult> {
  const { timeout = 300, retries = 5, intervalMs = 30000 } = options;
  const maxRetries = retries;
  const provider = getDeployProvider();
  const results: Array<{ status: number; latencyMs: number; attempt: number }> = [];

  logger.info('ci', 'Starting health check', { url, retries: maxRetries, intervalMs });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await provider.checkHealth(url);
      results.push({ ...result, attempt });

      if (result.status >= 200 && result.status < 300) {
        logger.info('ci', 'Health check passed', {
          url,
          attempt,
          status: result.status,
          latencyMs: result.latencyMs,
        });

        return {
          healthy: true,
          analysis: `Service healthy after ${attempt} attempt(s). Status: ${result.status}, Latency: ${result.latencyMs}ms`,
          rollbackRecommended: false,
        };
      }

      logger.warn('ci', 'Health check attempt failed', {
        url,
        attempt,
        status: result.status,
      });
    } catch (err) {
      logger.warn('ci', 'Health check error', {
        url,
        attempt,
        error: String(err),
      });
      results.push({ status: 0, latencyMs: 0, attempt });
    }

    // Wait before retry (unless last attempt)
    if (attempt < maxRetries) {
      await sleep(intervalMs);
    }
  }

  // All retries failed - use AI to analyze
  const analysis = await analyzeHealthFailure(url, results);

  return analysis;
}

/**
 * AI analysis of health check failure
 */
async function analyzeHealthFailure(
  url: string,
  results: Array<{ status: number; latencyMs: number; attempt: number }>
): Promise<HealthCheckResult> {
  if (!env.OPENROUTER_API_KEY) {
    return {
      healthy: false,
      analysis: `Health check failed after ${results.length} attempts. AI analysis unavailable.`,
      rollbackRecommended: true,
    };
  }

  const systemPrompt = `You are a deployment health check analyst.
A service deployment health check has failed. Analyze the results and determine whether to rollback.

Respond with JSON:
{
  "analysis": "Detailed analysis of the failure pattern",
  "rollbackRecommended": true/false
}`;

  const userPrompt = `Health check failed for: ${url}

Attempt Results:
${results.map(r => `  Attempt ${r.attempt}: status=${r.status}, latency=${r.latencyMs}ms`).join('\n')}

Should we rollback this deployment?`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      temperature: 0.1,
      maxTokens: 500,
    });

    const parsed = parseJSONResponse<{ analysis: string; rollbackRecommended: boolean }>(response);

    if (parsed) {
      return {
        healthy: false,
        analysis: parsed.analysis,
        rollbackRecommended: parsed.rollbackRecommended,
      };
    }
  } catch (error: any) {
    logger.error('ci', 'Health failure analysis error', { error: error.message });
  }

  return {
    healthy: false,
    analysis: `Health check failed after ${results.length} attempts. Status codes: ${results.map(r => r.status).join(', ')}`,
    rollbackRecommended: true,
  };
}

// =============================================================================
// Auto-Rollback
// =============================================================================

export interface RollbackResult {
  status: string;
  summary: string;
}

/**
 * Execute rollback to previous version
 */
export async function executeRollback(
  environment: Record<string, string>
): Promise<RollbackResult> {
  const provider = getDeployProvider();
  const service = environment.CV_HUB_ENV_SERVICE || environment.service || '';
  const previousVersion = environment.PREVIOUS_TASK_DEF || '';

  if (!service) {
    return {
      status: 'skipped',
      summary: 'No service name configured for rollback',
    };
  }

  if (!previousVersion) {
    return {
      status: 'skipped',
      summary: 'No previous version available for rollback',
    };
  }

  logger.info('ci', 'Executing rollback', { service, previousVersion });

  try {
    const result = await provider.rollbackService({ service, previousVersion });

    const summary = await generateRollbackSummary(service, previousVersion, result.status);

    return {
      status: result.status,
      summary,
    };
  } catch (error: any) {
    logger.error('ci', 'Rollback failed', { service, error: error.message });
    return {
      status: 'failed',
      summary: `Rollback failed for ${service}: ${error.message}`,
    };
  }
}

/**
 * Generate AI-powered rollback incident summary
 */
async function generateRollbackSummary(
  service: string,
  previousVersion: string,
  status: string
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    return `Service "${service}" rolled back to ${previousVersion}. Status: ${status}`;
  }

  const systemPrompt = `Generate a brief incident summary (2-3 sentences) for a deployment rollback event. Be factual and concise.`;

  const userPrompt = `Service: ${service}
Previous Version: ${previousVersion}
Rollback Status: ${status}
Timestamp: ${new Date().toISOString()}`;

  try {
    const response = await callLLM(systemPrompt, userPrompt, {
      maxTokens: 200,
      temperature: 0.3,
    });
    return response.trim();
  } catch {
    return `Service "${service}" rolled back to ${previousVersion}. Status: ${status}`;
  }
}

// =============================================================================
// Helpers
// =============================================================================

function categorizeChanges(diffStat: string): string[] {
  const categories: string[] = [];
  const lines = diffStat.toLowerCase();

  if (lines.includes('migration') || lines.includes('schema') || lines.includes('drizzle')) {
    categories.push('schema-migration');
  }
  if (lines.includes('.env') || lines.includes('config')) {
    categories.push('configuration');
  }
  if (lines.includes('package.json') || lines.includes('pnpm-lock') || lines.includes('package-lock')) {
    categories.push('dependencies');
  }
  if (lines.includes('route') || lines.includes('api/')) {
    categories.push('api-routes');
  }
  if (lines.includes('dockerfile') || lines.includes('docker-compose') || lines.includes('terraform') || lines.includes('.yml')) {
    categories.push('infrastructure');
  }
  if (lines.includes('.test.') || lines.includes('.spec.') || lines.includes('__tests__')) {
    categories.push('tests');
  }
  if (lines.includes('auth') || lines.includes('login') || lines.includes('session')) {
    categories.push('authentication');
  }

  return categories;
}

function runGitCommand(cwd: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Git command failed: ${command}\n${output}`));
        return;
      }
      resolve(output);
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to run git command: ${err.message}`));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
