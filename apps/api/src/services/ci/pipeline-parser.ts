import { parse as parseYaml } from 'yaml';
import { createHash } from 'crypto';
import type {
  PipelineDefinition,
  PipelineStage,
  PipelineJobDef,
  JobStep,
  WorkflowInput,
} from '../../db/schema/ci-cd';

// ============================================================================
// Types
// ============================================================================

export interface ParseResult {
  success: true;
  definition: PipelineDefinition;
  hash: string;
}

export interface ParseError {
  success: false;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export type ParsePipelineResult = ParseResult | ParseError;

// ============================================================================
// Built-in Actions
// ============================================================================

const BUILTIN_ACTIONS: Record<string, { description: string; inputs: string[] }> = {
  'checkout@v1': {
    description: 'Checkout repository code',
    inputs: ['ref', 'fetch-depth', 'submodules'],
  },
  'upload-artifact@v1': {
    description: 'Upload build artifacts',
    inputs: ['name', 'path', 'retention-days', 'if-no-files-found'],
  },
  'download-artifact@v1': {
    description: 'Download build artifacts',
    inputs: ['name', 'path'],
  },
  'cache@v1': {
    description: 'Cache dependencies',
    inputs: ['key', 'path', 'restore-keys'],
  },
  'setup-node@v1': {
    description: 'Setup Node.js environment',
    inputs: ['node-version', 'registry-url', 'cache'],
  },
  'setup-python@v1': {
    description: 'Setup Python environment',
    inputs: ['python-version', 'cache'],
  },
  'setup-go@v1': {
    description: 'Setup Go environment',
    inputs: ['go-version', 'cache'],
  },
  'setup-rust@v1': {
    description: 'Setup Rust environment',
    inputs: ['toolchain', 'components'],
  },
};

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse a YAML pipeline definition
 */
export function parsePipelineYaml(yaml: string): ParsePipelineResult {
  const errors: ValidationError[] = [];

  // Parse YAML
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    return {
      success: false,
      errors: [
        {
          path: '',
          message: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'error',
        },
      ],
    };
  }

  if (!raw || typeof raw !== 'object') {
    return {
      success: false,
      errors: [
        {
          path: '',
          message: 'Pipeline definition must be an object',
          severity: 'error',
        },
      ],
    };
  }

  const config = raw as Record<string, unknown>;

  // Validate required fields
  if (!config.name || typeof config.name !== 'string') {
    errors.push({
      path: 'name',
      message: 'Pipeline name is required',
      severity: 'error',
    });
  }

  if (!config.stages || !Array.isArray(config.stages)) {
    errors.push({
      path: 'stages',
      message: 'Pipeline must have at least one stage',
      severity: 'error',
    });
  }

  // Early return if critical errors
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Parse stages
  const stages = parseStages(config.stages as unknown[], errors);

  // Parse triggers
  const on = parseTriggers(config.on as Record<string, unknown> | undefined, errors);

  // Parse global env
  const env = parseEnv(config.env as Record<string, unknown> | undefined, errors);

  // Check for any errors
  if (errors.some((e) => e.severity === 'error')) {
    return { success: false, errors };
  }

  const definition: PipelineDefinition = {
    version: String(config.version || '1.0'),
    name: config.name as string,
    env,
    stages,
    on,
  };

  // Calculate hash
  const hash = createHash('sha256').update(yaml).digest('hex');

  return {
    success: true,
    definition,
    hash,
  };
}

/**
 * Parse pipeline stages
 */
function parseStages(
  rawStages: unknown[],
  errors: ValidationError[]
): PipelineStage[] {
  const stages: PipelineStage[] = [];

  for (let i = 0; i < rawStages.length; i++) {
    const rawStage = rawStages[i];
    const path = `stages[${i}]`;

    if (!rawStage || typeof rawStage !== 'object') {
      errors.push({
        path,
        message: 'Stage must be an object',
        severity: 'error',
      });
      continue;
    }

    const stage = rawStage as Record<string, unknown>;

    if (!stage.name || typeof stage.name !== 'string') {
      errors.push({
        path: `${path}.name`,
        message: 'Stage name is required',
        severity: 'error',
      });
      continue;
    }

    if (!stage.jobs || !Array.isArray(stage.jobs)) {
      errors.push({
        path: `${path}.jobs`,
        message: 'Stage must have at least one job',
        severity: 'error',
      });
      continue;
    }

    const jobs = parseJobs(stage.jobs as unknown[], `${path}.jobs`, errors);

    stages.push({
      name: stage.name,
      jobs,
    });
  }

  return stages;
}

/**
 * Parse pipeline jobs
 */
function parseJobs(
  rawJobs: unknown[],
  basePath: string,
  errors: ValidationError[]
): PipelineJobDef[] {
  const jobs: PipelineJobDef[] = [];
  const jobKeys = new Set<string>();

  for (let i = 0; i < rawJobs.length; i++) {
    const rawJob = rawJobs[i];
    const path = `${basePath}[${i}]`;

    if (!rawJob || typeof rawJob !== 'object') {
      errors.push({
        path,
        message: 'Job must be an object',
        severity: 'error',
      });
      continue;
    }

    const job = rawJob as Record<string, unknown>;

    if (!job.name || typeof job.name !== 'string') {
      errors.push({
        path: `${path}.name`,
        message: 'Job name is required',
        severity: 'error',
      });
      continue;
    }

    // Generate key from name if not provided
    const key = (job.key as string) || slugify(job.name);

    if (jobKeys.has(key)) {
      errors.push({
        path: `${path}.key`,
        message: `Duplicate job key: ${key}`,
        severity: 'error',
      });
    }
    jobKeys.add(key);

    if (!job.steps || !Array.isArray(job.steps)) {
      errors.push({
        path: `${path}.steps`,
        message: 'Job must have at least one step',
        severity: 'error',
      });
      continue;
    }

    const steps = parseSteps(job.steps as unknown[], `${path}.steps`, errors);

    // Parse needs (dependencies)
    const needs = parseNeeds(job.needs, `${path}.needs`, errors);

    // Parse services
    const services = parseServices(
      job.services as Record<string, unknown> | undefined,
      `${path}.services`,
      errors
    );

    const jobDef: PipelineJobDef = {
      name: job.name,
      key,
      steps,
      needs,
    };

    // Optional fields
    if (job['runs-on']) {
      jobDef.runsOn = job['runs-on'] as string | string[];
    }
    if (job.container) {
      const container = job.container as Record<string, unknown>;
      jobDef.container = {
        image: container.image as string,
        env: container.env as Record<string, string> | undefined,
      };
    }
    if (job.if) {
      jobDef.if = job.if as string;
    }
    if (job.env) {
      jobDef.env = job.env as Record<string, string>;
    }
    if (job.outputs) {
      jobDef.outputs = job.outputs as Record<string, string>;
    }
    if (job.timeout) {
      jobDef.timeout = job.timeout as number;
    }
    if (job.retries) {
      jobDef.retries = job.retries as number;
    }
    if (services && Object.keys(services).length > 0) {
      jobDef.services = services;
    }

    jobs.push(jobDef);
  }

  return jobs;
}

/**
 * Parse job steps
 */
function parseSteps(
  rawSteps: unknown[],
  basePath: string,
  errors: ValidationError[]
): JobStep[] {
  const steps: JobStep[] = [];

  for (let i = 0; i < rawSteps.length; i++) {
    const rawStep = rawSteps[i];
    const path = `${basePath}[${i}]`;

    if (!rawStep || typeof rawStep !== 'object') {
      errors.push({
        path,
        message: 'Step must be an object',
        severity: 'error',
      });
      continue;
    }

    const step = rawStep as Record<string, unknown>;

    // Must have either 'run' or 'uses'
    if (!step.run && !step.uses) {
      errors.push({
        path,
        message: 'Step must have either "run" or "uses"',
        severity: 'error',
      });
      continue;
    }

    // Validate 'uses' references built-in actions
    if (step.uses && typeof step.uses === 'string') {
      if (!isValidAction(step.uses)) {
        errors.push({
          path: `${path}.uses`,
          message: `Unknown action: ${step.uses}. Available actions: ${Object.keys(BUILTIN_ACTIONS).join(', ')}`,
          severity: 'warning',
        });
      }
    }

    const jobStep: JobStep = {};

    if (step.name) jobStep.name = step.name as string;
    if (step.run) jobStep.run = step.run as string;
    if (step.uses) jobStep.uses = step.uses as string;
    if (step.with) jobStep.with = step.with as Record<string, unknown>;
    if (step.env) jobStep.env = step.env as Record<string, string>;
    if (step.if) jobStep.if = step.if as string;
    if (step['working-directory']) {
      jobStep.workingDirectory = step['working-directory'] as string;
    }
    if (step.shell) jobStep.shell = step.shell as string;
    if (step.timeout) jobStep.timeout = step.timeout as number;
    if (step['continue-on-error']) {
      jobStep.continueOnError = step['continue-on-error'] as boolean;
    }

    steps.push(jobStep);
  }

  return steps;
}

/**
 * Parse job dependencies (needs)
 */
function parseNeeds(
  rawNeeds: unknown,
  path: string,
  errors: ValidationError[]
): string[] {
  if (!rawNeeds) return [];

  if (typeof rawNeeds === 'string') {
    return [rawNeeds];
  }

  if (Array.isArray(rawNeeds)) {
    const needs: string[] = [];
    for (const need of rawNeeds) {
      if (typeof need === 'string') {
        needs.push(need);
      } else {
        errors.push({
          path,
          message: 'Job dependency must be a string',
          severity: 'error',
        });
      }
    }
    return needs;
  }

  errors.push({
    path,
    message: 'needs must be a string or array of strings',
    severity: 'error',
  });
  return [];
}

/**
 * Parse service containers
 */
function parseServices(
  rawServices: Record<string, unknown> | undefined,
  path: string,
  errors: ValidationError[]
): Record<string, { image: string; env?: Record<string, string>; ports?: number[] }> | undefined {
  if (!rawServices) return undefined;

  const services: Record<
    string,
    { image: string; env?: Record<string, string>; ports?: number[] }
  > = {};

  for (const [name, rawService] of Object.entries(rawServices)) {
    if (!rawService || typeof rawService !== 'object') {
      errors.push({
        path: `${path}.${name}`,
        message: 'Service must be an object',
        severity: 'error',
      });
      continue;
    }

    const service = rawService as Record<string, unknown>;

    if (!service.image || typeof service.image !== 'string') {
      errors.push({
        path: `${path}.${name}.image`,
        message: 'Service image is required',
        severity: 'error',
      });
      continue;
    }

    services[name] = {
      image: service.image,
      env: service.env as Record<string, string> | undefined,
      ports: service.ports as number[] | undefined,
    };
  }

  return services;
}

/**
 * Parse trigger configuration
 */
function parseTriggers(
  rawOn: Record<string, unknown> | undefined,
  errors: ValidationError[]
): PipelineDefinition['on'] {
  if (!rawOn) return undefined;

  const on: PipelineDefinition['on'] = {};

  if (rawOn.push) {
    const push = rawOn.push as Record<string, unknown>;
    on.push = {
      branches: push.branches as string[] | undefined,
      tags: push.tags as string[] | undefined,
      paths: push.paths as string[] | undefined,
    };
  }

  if (rawOn.pull_request) {
    const pr = rawOn.pull_request as Record<string, unknown>;
    on.pull_request = {
      branches: pr.branches as string[] | undefined,
      paths: pr.paths as string[] | undefined,
    };
  }

  if (rawOn.schedule) {
    const schedules = rawOn.schedule as Array<{ cron: string }>;
    on.schedule = schedules.map((s) => ({ cron: s.cron }));
  }

  if (rawOn.workflow_dispatch) {
    const wd = rawOn.workflow_dispatch as Record<string, unknown>;
    on.workflow_dispatch = {
      inputs: wd.inputs as Record<string, WorkflowInput> | undefined,
    };
  }

  return on;
}

/**
 * Parse environment variables
 */
function parseEnv(
  rawEnv: Record<string, unknown> | undefined,
  errors: ValidationError[]
): Record<string, string> | undefined {
  if (!rawEnv) return undefined;

  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      errors.push({
        path: `env.${key}`,
        message: 'Environment variable must be a string, number, or boolean',
        severity: 'warning',
      });
      continue;
    }
    env[key] = String(value);
  }

  return env;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an action is valid
 */
function isValidAction(action: string): boolean {
  return action in BUILTIN_ACTIONS;
}

/**
 * Get available actions
 */
export function getAvailableActions(): typeof BUILTIN_ACTIONS {
  return BUILTIN_ACTIONS;
}

/**
 * Convert string to slug
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Validate a pipeline definition object
 */
export function validatePipelineDefinition(
  definition: PipelineDefinition
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate stages
  if (!definition.stages || definition.stages.length === 0) {
    errors.push({
      path: 'stages',
      message: 'Pipeline must have at least one stage',
      severity: 'error',
    });
  }

  // Validate job dependencies
  const allJobKeys = new Set<string>();
  for (const stage of definition.stages) {
    for (const job of stage.jobs) {
      allJobKeys.add(job.key);
    }
  }

  for (const stage of definition.stages) {
    for (const job of stage.jobs) {
      if (job.needs) {
        for (const dep of job.needs) {
          if (!allJobKeys.has(dep)) {
            errors.push({
              path: `stages.${stage.name}.jobs.${job.key}.needs`,
              message: `Unknown job dependency: ${dep}`,
              severity: 'error',
            });
          }
        }
      }
    }
  }

  // Check for circular dependencies
  const circularDeps = findCircularDependencies(definition.stages);
  for (const cycle of circularDeps) {
    errors.push({
      path: 'stages',
      message: `Circular dependency detected: ${cycle.join(' -> ')}`,
      severity: 'error',
    });
  }

  return errors;
}

/**
 * Find circular dependencies in job graph
 */
function findCircularDependencies(stages: PipelineStage[]): string[][] {
  const cycles: string[][] = [];
  const jobMap = new Map<string, PipelineJobDef>();

  for (const stage of stages) {
    for (const job of stage.jobs) {
      jobMap.set(job.key, job);
    }
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(jobKey: string, path: string[]): boolean {
    if (recursionStack.has(jobKey)) {
      const cycleStart = path.indexOf(jobKey);
      cycles.push([...path.slice(cycleStart), jobKey]);
      return true;
    }

    if (visited.has(jobKey)) {
      return false;
    }

    visited.add(jobKey);
    recursionStack.add(jobKey);
    path.push(jobKey);

    const job = jobMap.get(jobKey);
    if (job?.needs) {
      for (const dep of job.needs) {
        dfs(dep, path);
      }
    }

    path.pop();
    recursionStack.delete(jobKey);
    return false;
  }

  for (const key of jobMap.keys()) {
    if (!visited.has(key)) {
      dfs(key, []);
    }
  }

  return cycles;
}

/**
 * Serialize pipeline definition to YAML
 */
export function serializePipelineToYaml(definition: PipelineDefinition): string {
  const lines: string[] = [];

  lines.push(`version: "${definition.version}"`);
  lines.push(`name: ${definition.name}`);
  lines.push('');

  // Triggers
  if (definition.on) {
    lines.push('on:');
    if (definition.on.push) {
      lines.push('  push:');
      if (definition.on.push.branches?.length) {
        lines.push(`    branches: [${definition.on.push.branches.join(', ')}]`);
      }
      if (definition.on.push.tags?.length) {
        lines.push(`    tags: [${definition.on.push.tags.join(', ')}]`);
      }
    }
    if (definition.on.pull_request) {
      lines.push('  pull_request:');
      if (definition.on.pull_request.branches?.length) {
        lines.push(`    branches: [${definition.on.pull_request.branches.join(', ')}]`);
      }
    }
    if (definition.on.schedule?.length) {
      lines.push('  schedule:');
      for (const s of definition.on.schedule) {
        lines.push(`    - cron: "${s.cron}"`);
      }
    }
    if (definition.on.workflow_dispatch) {
      lines.push('  workflow_dispatch:');
      if (definition.on.workflow_dispatch.inputs) {
        lines.push('    inputs:');
        for (const [name, input] of Object.entries(
          definition.on.workflow_dispatch.inputs
        )) {
          lines.push(`      ${name}:`);
          const inp = input as Record<string, unknown>;
          if (inp.description) lines.push(`        description: "${inp.description}"`);
          if (inp.type) lines.push(`        type: ${inp.type}`);
          if (inp.default !== undefined) lines.push(`        default: "${inp.default}"`);
        }
      }
    }
    lines.push('');
  }

  // Global env
  if (definition.env && Object.keys(definition.env).length > 0) {
    lines.push('env:');
    for (const [key, value] of Object.entries(definition.env)) {
      lines.push(`  ${key}: "${value}"`);
    }
    lines.push('');
  }

  // Stages
  lines.push('stages:');
  for (const stage of definition.stages) {
    lines.push(`  - name: ${stage.name}`);
    lines.push('    jobs:');
    for (const job of stage.jobs) {
      lines.push(`      - name: ${job.name}`);
      lines.push(`        key: ${job.key}`);

      if (job.runsOn) {
        const runsOn = Array.isArray(job.runsOn) ? job.runsOn.join(', ') : job.runsOn;
        lines.push(`        runs-on: ${runsOn}`);
      }

      if (job.container) {
        lines.push('        container:');
        lines.push(`          image: ${job.container.image}`);
      }

      if (job.needs?.length) {
        lines.push(`        needs: [${job.needs.join(', ')}]`);
      }

      if (job.env && Object.keys(job.env).length > 0) {
        lines.push('        env:');
        for (const [key, value] of Object.entries(job.env)) {
          lines.push(`          ${key}: "${value}"`);
        }
      }

      lines.push('        steps:');
      for (const step of job.steps) {
        if (step.name) {
          lines.push(`          - name: ${step.name}`);
        } else {
          lines.push('          -');
        }

        if (step.uses) {
          const prefix = step.name ? '            ' : '          ';
          lines.push(`${prefix}uses: ${step.uses}`);
          if (step.with && Object.keys(step.with).length > 0) {
            lines.push(`${prefix}with:`);
            for (const [key, value] of Object.entries(step.with)) {
              lines.push(`${prefix}  ${key}: ${value}`);
            }
          }
        }

        if (step.run) {
          const prefix = step.name ? '            ' : '          ';
          if (step.run.includes('\n')) {
            lines.push(`${prefix}run: |`);
            for (const line of step.run.split('\n')) {
              lines.push(`${prefix}  ${line}`);
            }
          } else {
            lines.push(`${prefix}run: ${step.run}`);
          }
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Get execution order for jobs (topological sort)
 */
export function getJobExecutionOrder(stages: PipelineStage[]): string[][] {
  const jobMap = new Map<string, PipelineJobDef>();
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  // Build graph
  for (const stage of stages) {
    for (const job of stage.jobs) {
      jobMap.set(job.key, job);
      inDegree.set(job.key, 0);
      graph.set(job.key, []);
    }
  }

  // Add edges and calculate in-degrees
  for (const stage of stages) {
    for (const job of stage.jobs) {
      if (job.needs) {
        for (const dep of job.needs) {
          graph.get(dep)?.push(job.key);
          inDegree.set(job.key, (inDegree.get(job.key) || 0) + 1);
        }
      }
    }
  }

  // Topological sort with levels
  const levels: string[][] = [];
  const remaining = new Set(jobMap.keys());

  while (remaining.size > 0) {
    // Find all jobs with no remaining dependencies
    const level: string[] = [];
    for (const key of remaining) {
      if ((inDegree.get(key) || 0) === 0) {
        level.push(key);
      }
    }

    if (level.length === 0) {
      // Circular dependency - shouldn't happen if validation passed
      break;
    }

    levels.push(level);

    // Remove processed jobs and update in-degrees
    for (const key of level) {
      remaining.delete(key);
      for (const dependent of graph.get(key) || []) {
        inDegree.set(dependent, (inDegree.get(dependent) || 0) - 1);
      }
    }
  }

  return levels;
}
