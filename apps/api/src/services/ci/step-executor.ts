/**
 * Step Executor - Real execution engine for CI/CD pipeline steps
 *
 * Replaces the stubbed executeStep() in job-dispatch.service.ts with
 * actual process execution and built-in action implementations.
 *
 * Cloud-independent: uses child_process.spawn for shell, Buildah for containers.
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, rmSync, cpSync, statSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import type { JobStep, WorkspaceConfig } from './job-dispatch.service';
import { getDeployProvider } from './providers';

// Constants
const WORKSPACE_BASE = '/tmp/cv-hub-workspace';
const CACHE_BASE = '/tmp/cv-hub-cache';
const ARTIFACT_BASE = '/tmp/cv-hub-artifacts';
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const NULL_SHA = '0000000000000000000000000000000000000000';

// System environment variables injected into every step
function getSystemEnv(workspace: WorkspaceConfig, runId: string): Record<string, string> {
  return {
    CI: 'true',
    CV_HUB: 'true',
    CV_HUB_SHA: workspace.sha,
    CV_HUB_REF: workspace.ref,
    CV_HUB_RUN_ID: runId,
    CV_HUB_OWNER: workspace.ownerSlug,
    CV_HUB_REPO: workspace.repoSlug,
  };
}

/**
 * Get the workspace directory path for a job
 */
export function getWorkspacePath(runId: string, jobKey: string): string {
  return join(WORKSPACE_BASE, runId, jobKey);
}

/**
 * Ensure workspace directory exists
 */
export function ensureWorkspace(runId: string, jobKey: string): string {
  const workspacePath = getWorkspacePath(runId, jobKey);
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

/**
 * Clean up workspace after job completes
 */
export function cleanupWorkspace(runId: string, jobKey: string): void {
  const workspacePath = getWorkspacePath(runId, jobKey);
  try {
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
      logger.debug('ci', 'Workspace cleaned up', { workspacePath });
    }
  } catch (err) {
    logger.warn('ci', 'Failed to clean up workspace', { workspacePath, error: String(err) });
  }
}

export interface StepExecutionResult {
  output?: string;
  outputs?: Record<string, string>;
}

/**
 * Execute a single pipeline step
 *
 * Handles both shell commands (`run:`) and built-in actions (`uses:`).
 * Shell commands execute via child_process.spawn with /bin/sh -c.
 * Built-in actions dispatch to specific handler functions.
 */
export async function executeStep(
  step: JobStep,
  workspace: WorkspaceConfig,
  environment: Record<string, string>,
  context: { runId: string; jobKey: string }
): Promise<StepExecutionResult> {
  const workspacePath = ensureWorkspace(context.runId, context.jobKey);

  if (step.uses) {
    return executeAction(step, workspace, environment, workspacePath, context);
  }

  if (step.run) {
    return executeShellCommand(step, workspace, environment, workspacePath, context);
  }

  return { output: 'No-op step' };
}

/**
 * Execute a shell command via child_process.spawn
 */
async function executeShellCommand(
  step: JobStep,
  workspace: WorkspaceConfig,
  environment: Record<string, string>,
  workspacePath: string,
  context: { runId: string; jobKey: string }
): Promise<StepExecutionResult> {
  const command = step.run!;
  const cwd = step.workingDirectory
    ? resolve(workspacePath, step.workingDirectory)
    : workspacePath;
  const timeoutMs = (step.timeout || 600) * 1000; // step.timeout in seconds

  // Build environment: system vars + job env + step env
  const mergedEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...getSystemEnv(workspace, context.runId),
    ...environment,
    ...step.env,
    HOME: process.env.HOME || '/home/cvhub',
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  };

  logger.info('ci', 'Executing shell command', {
    step: step.name,
    cwd,
    commandPreview: command.slice(0, 200),
  });

  return new Promise<StepExecutionResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child: ChildProcess = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        killed = true;
        // Kill the entire process group (negative PID targets group)
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      }, timeoutMs);
    }

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += chunk.slice(0, MAX_OUTPUT_SIZE - stdout.length);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += chunk.slice(0, MAX_OUTPUT_SIZE - stderr.length);
      }
    });

    child.on('close', (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const combinedOutput = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '');
      const exitCode = code ?? (signal ? 128 : 1);

      if (killed) {
        reject(
          Object.assign(
            new Error(`Step "${step.name}" timed out after ${timeoutMs / 1000}s`),
            { exitCode: 124, output: combinedOutput }
          )
        );
        return;
      }

      if (exitCode !== 0) {
        reject(
          Object.assign(
            new Error(`Step "${step.name}" failed with exit code ${exitCode}`),
            { exitCode, output: combinedOutput }
          )
        );
        return;
      }

      // Parse output variables (::set-output name=key::value pattern)
      const outputs: Record<string, string> = {};
      const outputPattern = /::set-output name=([^:]+)::(.+)/g;
      let match;
      while ((match = outputPattern.exec(stdout)) !== null) {
        outputs[match[1]] = match[2];
      }

      resolve({ output: combinedOutput, outputs: Object.keys(outputs).length > 0 ? outputs : undefined });
    });

    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(new Error(`Failed to spawn process for step "${step.name}": ${err.message}`));
    });

    // Prevent detached child from keeping Node alive if we exit early
    child.unref();
  });
}

/**
 * Execute a built-in action
 */
async function executeAction(
  step: JobStep,
  workspace: WorkspaceConfig,
  environment: Record<string, string>,
  workspacePath: string,
  context: { runId: string; jobKey: string }
): Promise<StepExecutionResult> {
  const [action] = step.uses!.split('@');
  const params = step.with || {};

  switch (action) {
    case 'checkout':
      return actionCheckout(workspace, workspacePath, params);

    case 'setup-node':
      return actionSetupNode(workspacePath, params);

    case 'cache':
      return actionCache(workspacePath, params, context);

    case 'upload-artifact':
      return actionUploadArtifact(workspacePath, params, context);

    case 'download-artifact':
      return actionDownloadArtifact(workspacePath, params, context);

    case 'container-build':
      return actionContainerBuild(workspacePath, params, workspace, context);

    case 'container-push':
      return actionContainerPush(params, workspace, context);

    case 'registry-login':
      return actionRegistryLogin();

    case 'deploy-service':
      return actionDeployService(params, environment);

    case 'deploy-static':
      return actionDeployStatic(workspacePath, params, environment);

    case 'invalidate-cdn':
      return actionInvalidateCDN(params);

    case 'ai-risk-assess':
      return actionAIRiskAssess(workspacePath, workspace);

    case 'ai-health-check':
      return actionAIHealthCheck(params, environment, context);

    default:
      throw new Error(`Unknown action: ${step.uses}`);
  }
}

// =============================================================================
// Built-in Action Implementations
// =============================================================================

/**
 * checkout@v1 - Clone repository from local bare repo to workspace
 */
async function actionCheckout(
  workspace: WorkspaceConfig,
  workspacePath: string,
  params: Record<string, any>
): Promise<StepExecutionResult> {
  const repoPath = join(
    env.GIT_STORAGE_PATH,
    workspace.ownerSlug,
    `${workspace.repoSlug}.git`
  );

  if (!existsSync(repoPath)) {
    throw new Error(`Repository not found at ${repoPath}`);
  }

  const ref = params.ref || workspace.sha || workspace.ref;
  const depth = params['fetch-depth'] ?? 1;
  const depthArgs = depth > 0 ? `--depth=${depth}` : '';

  const cloneCmd = `git clone ${depthArgs} --single-branch file://${repoPath} . && git checkout ${ref}`;

  const result = await runShellInDir(cloneCmd, workspacePath);

  logger.info('ci', 'Checkout completed', {
    repo: `${workspace.ownerSlug}/${workspace.repoSlug}`,
    ref,
  });

  return {
    output: `Checked out ${workspace.ownerSlug}/${workspace.repoSlug}@${ref}\n${result}`,
  };
}

/**
 * setup-node@v1 - Verify Node.js and enable corepack for pnpm
 */
async function actionSetupNode(
  workspacePath: string,
  params: Record<string, any>
): Promise<StepExecutionResult> {
  const nodeVersion = params['node-version'] || '20';
  const outputs: string[] = [];

  // Check current Node.js version
  const currentVersion = await runShellInDir('node --version', workspacePath);
  outputs.push(`Node.js version: ${currentVersion.trim()}`);

  // Enable corepack for pnpm/yarn
  try {
    const corepackResult = await runShellInDir('corepack enable', workspacePath);
    outputs.push(`Corepack enabled: ${corepackResult.trim()}`);
  } catch {
    outputs.push('Corepack not available, pnpm should be installed globally');
  }

  // Check pnpm availability
  try {
    const pnpmVersion = await runShellInDir('pnpm --version', workspacePath);
    outputs.push(`pnpm version: ${pnpmVersion.trim()}`);
  } catch {
    outputs.push('pnpm not found - install via corepack or npm');
  }

  return {
    output: outputs.join('\n'),
    outputs: { 'node-version': currentVersion.trim() },
  };
}

/**
 * cache@v1 - Directory-based cache with hash validation
 */
async function actionCache(
  workspacePath: string,
  params: Record<string, any>,
  context: { runId: string; jobKey: string }
): Promise<StepExecutionResult> {
  const key = params.key;
  const paths = Array.isArray(params.path) ? params.path : [params.path];

  if (!key || !paths.length) {
    throw new Error('cache@v1 requires "key" and "path" parameters');
  }

  // Resolve variable references in cache key (e.g., hashFiles patterns)
  const cacheKey = resolveCacheKey(key, workspacePath);
  const cachePath = join(CACHE_BASE, cacheKey);

  if (existsSync(cachePath)) {
    // Restore cache
    for (const p of paths) {
      const targetPath = resolve(workspacePath, p);
      const sourcePath = join(cachePath, p);
      if (existsSync(sourcePath)) {
        mkdirSync(targetPath, { recursive: true });
        cpSync(sourcePath, targetPath, { recursive: true });
      }
    }

    logger.info('ci', 'Cache restored', { key: cacheKey });
    return {
      output: `Cache restored for key: ${cacheKey}`,
      outputs: { 'cache-hit': 'true' },
    };
  }

  // Cache miss - save after job completes
  // For now, save immediately (the path may be populated later)
  mkdirSync(cachePath, { recursive: true });
  for (const p of paths) {
    const sourcePath = resolve(workspacePath, p);
    if (existsSync(sourcePath)) {
      const destPath = join(cachePath, p);
      mkdirSync(destPath, { recursive: true });
      cpSync(sourcePath, destPath, { recursive: true });
    }
  }

  return {
    output: `Cache miss for key: ${cacheKey}. Will be saved after step.`,
    outputs: { 'cache-hit': 'false' },
  };
}

/**
 * upload-artifact@v1 - Copy files to artifact storage
 */
async function actionUploadArtifact(
  workspacePath: string,
  params: Record<string, any>,
  context: { runId: string; jobKey: string }
): Promise<StepExecutionResult> {
  const name = params.name;
  const path = params.path;

  if (!name || !path) {
    throw new Error('upload-artifact@v1 requires "name" and "path" parameters');
  }

  const sourcePath = resolve(workspacePath, path);
  const artifactPath = join(ARTIFACT_BASE, context.runId, name);

  if (!existsSync(sourcePath)) {
    const behavior = params['if-no-files-found'] || 'warn';
    if (behavior === 'error') {
      throw new Error(`Artifact source path not found: ${sourcePath}`);
    }
    return { output: `Warning: No files found at ${path}` };
  }

  mkdirSync(artifactPath, { recursive: true });
  cpSync(sourcePath, artifactPath, { recursive: true });

  const fileCount = countFiles(artifactPath);

  logger.info('ci', 'Artifact uploaded', { name, fileCount, runId: context.runId });

  return {
    output: `Artifact "${name}" uploaded (${fileCount} files)`,
    outputs: { 'artifact-path': artifactPath },
  };
}

/**
 * download-artifact@v1 - Copy files from artifact storage
 */
async function actionDownloadArtifact(
  workspacePath: string,
  params: Record<string, any>,
  context: { runId: string; jobKey: string }
): Promise<StepExecutionResult> {
  const name = params.name;
  const destDir = params.path || '.';

  if (!name) {
    throw new Error('download-artifact@v1 requires "name" parameter');
  }

  const artifactPath = join(ARTIFACT_BASE, context.runId, name);
  const targetPath = resolve(workspacePath, destDir);

  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact "${name}" not found for run ${context.runId}`);
  }

  mkdirSync(targetPath, { recursive: true });
  cpSync(artifactPath, targetPath, { recursive: true });

  return { output: `Artifact "${name}" downloaded to ${destDir}` };
}

/**
 * container-build@v1 - Build OCI image using Buildah (daemonless)
 */
async function actionContainerBuild(
  workspacePath: string,
  params: Record<string, any>,
  workspace: WorkspaceConfig,
  context: { runId: string; jobKey: string }
): Promise<StepExecutionResult> {
  const contextDir = params.context || '.';
  const dockerfile = params.file || './Dockerfile';
  const tag = params.tag || workspace.sha;
  const imageName = params.image || `${workspace.ownerSlug}/${workspace.repoSlug}`;
  const fullTag = `${imageName}:${tag}`;
  const buildArgs = params['build-args'] || {};

  let buildCmd = `buildah build -f ${dockerfile}`;

  // Add build args
  for (const [key, value] of Object.entries(buildArgs)) {
    buildCmd += ` --build-arg ${key}=${value}`;
  }

  buildCmd += ` -t ${fullTag} ${contextDir}`;

  logger.info('ci', 'Building container image', { tag: fullTag, dockerfile });

  const result = await runShellInDir(buildCmd, workspacePath);

  return {
    output: `Built image: ${fullTag}\n${result}`,
    outputs: { 'image-tag': fullTag },
  };
}

/**
 * container-push@v1 - Push OCI image using Buildah
 */
async function actionContainerPush(
  params: Record<string, any>,
  workspace: WorkspaceConfig,
  context: { runId: string; jobKey: string }
): Promise<StepExecutionResult> {
  const tag = params.tag || workspace.sha;
  const registry = params.registry || '';
  const imageName = params.image || `${workspace.ownerSlug}/${workspace.repoSlug}`;
  const fullTag = registry ? `${registry}/${imageName}:${tag}` : `${imageName}:${tag}`;

  const pushCmd = `buildah push ${fullTag}`;

  logger.info('ci', 'Pushing container image', { tag: fullTag });

  const result = await runShellInDir(pushCmd, WORKSPACE_BASE);

  return {
    output: `Pushed image: ${fullTag}\n${result}`,
  };
}

/**
 * registry-login@v1 - Login to container registry via deploy provider
 */
async function actionRegistryLogin(): Promise<StepExecutionResult> {
  const provider = getDeployProvider();
  const result = await provider.registryLogin();

  return {
    output: `Logged in to registry: ${result.registry}`,
    outputs: { registry: result.registry },
  };
}

/**
 * deploy-service@v1 - Deploy container service via provider
 */
async function actionDeployService(
  params: Record<string, any>,
  environment: Record<string, string>
): Promise<StepExecutionResult> {
  const provider = getDeployProvider();
  const service = resolveEnvVars(params.service, environment);
  const image = resolveEnvVars(params.image, environment);
  const waitForStability = params['wait-for-stability'] !== false;

  logger.info('ci', 'Deploying service', { service, image });

  const result = await provider.deployService({
    service,
    image,
    waitForStability,
  });

  return {
    output: `Service deployed: ${service} (status: ${result.status})`,
    outputs: {
      'deploy-status': result.status,
      ...(result.previousVersion ? { 'previous-version': result.previousVersion } : {}),
    },
  };
}

/**
 * deploy-static@v1 - Deploy static assets via provider
 */
async function actionDeployStatic(
  workspacePath: string,
  params: Record<string, any>,
  environment: Record<string, string>
): Promise<StepExecutionResult> {
  const provider = getDeployProvider();
  const source = resolve(workspacePath, resolveEnvVars(params.source, environment));
  const destination = resolveEnvVars(params.destination, environment);

  logger.info('ci', 'Deploying static assets', { source, destination });

  const result = await provider.deployStaticAssets({
    source,
    destination,
  });

  return {
    output: `Static assets deployed: ${result.filesUploaded} files to ${destination}`,
    outputs: { 'files-uploaded': String(result.filesUploaded) },
  };
}

/**
 * invalidate-cdn@v1 - Invalidate CDN cache via provider
 */
async function actionInvalidateCDN(
  params: Record<string, any>
): Promise<StepExecutionResult> {
  const provider = getDeployProvider();
  const paths = Array.isArray(params.paths) ? params.paths : [params.paths || '/*'];

  logger.info('ci', 'Invalidating CDN', { paths });

  const result = await provider.invalidateCDN({ paths });

  return {
    output: `CDN invalidated (${result.invalidationId})`,
    outputs: { 'invalidation-id': result.invalidationId },
  };
}

/**
 * ai-risk-assess@v1 - AI analysis of deployment risk
 */
async function actionAIRiskAssess(
  workspacePath: string,
  workspace: WorkspaceConfig
): Promise<StepExecutionResult> {
  // Lazy import to avoid circular dependencies
  const { assessDeploymentRisk } = await import('./ai-deploy.service');

  const result = await assessDeploymentRisk(workspacePath, workspace);

  return {
    output: `Risk Assessment: ${result.riskLevel}\nReasoning: ${result.reasoning}\nRecommendations:\n${result.recommendations.join('\n- ')}`,
    outputs: { 'risk-level': result.riskLevel },
  };
}

/**
 * ai-health-check@v1 - Health endpoint polling + AI analysis
 */
async function actionAIHealthCheck(
  params: Record<string, any>,
  environment: Record<string, string>,
  context: { runId: string; jobKey: string }
): Promise<StepExecutionResult> {
  const { checkDeploymentHealth, executeRollback } = await import('./ai-deploy.service');

  const url = resolveEnvVars(params.url, environment);
  const timeout = params.timeout || 300;
  const rollbackOnFailure = params['rollback-on-failure'] !== false;

  const result = await checkDeploymentHealth(url, { timeout });

  if (!result.healthy && rollbackOnFailure && result.rollbackRecommended) {
    logger.warn('ci', 'Health check failed - initiating rollback', { url });

    const rollbackResult = await executeRollback(environment);
    return {
      output: `Health check FAILED for ${url}\nAnalysis: ${result.analysis}\nRollback executed: ${rollbackResult.summary}`,
      outputs: { healthy: 'false', 'rollback-executed': 'true' },
    };
  }

  if (!result.healthy) {
    throw new Error(`Health check failed for ${url}: ${result.analysis}`);
  }

  return {
    output: `Health check passed for ${url}\nAnalysis: ${result.analysis}`,
    outputs: { healthy: 'true' },
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Run a shell command in a specific directory and return output
 */
function runShellInDir(command: string, cwd: string): Promise<string> {
  if (!existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true });
  }

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
        reject(new Error(`Command failed (exit ${code}): ${command}\n${output}`));
        return;
      }
      resolve(output);
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to run command: ${err.message}`));
    });
  });
}

/**
 * Resolve $VAR references in a string using the environment
 */
function resolveEnvVars(value: string, environment: Record<string, string>): string {
  if (!value) return value;
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => {
    return environment[name] || process.env[name] || '';
  });
}

/**
 * Resolve cache key, supporting hashFiles() pattern
 */
function resolveCacheKey(key: string, workspacePath: string): string {
  return key.replace(/hashFiles\(['"]([^'"]+)['"]\)/g, (_, pattern) => {
    const filePath = resolve(workspacePath, pattern);
    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      return createHash('sha256')
        .update(`${filePath}:${stat.size}:${stat.mtimeMs}`)
        .digest('hex')
        .slice(0, 16);
    }
    return 'miss';
  });
}

/**
 * Count files recursively in a directory
 */
function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      count++;
    } else if (entry.isDirectory()) {
      count += countFiles(join(dir, entry.name));
    }
  }
  return count;
}
