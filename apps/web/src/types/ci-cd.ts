/**
 * CI/CD Types
 * TypeScript interfaces for CI/CD frontend
 */

// Status enums
export type PipelineRunStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out';
export type JobStatus = 'pending' | 'queued' | 'running' | 'success' | 'failure' | 'cancelled' | 'skipped';
export type TriggerType = 'push' | 'pull_request' | 'schedule' | 'manual' | 'api' | 'tag' | 'release';

// Pipeline
export interface Pipeline {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastRunAt: string | null;
  lastRunStatus: PipelineRunStatus | null;
  createdAt: string;
  updatedAt: string;
}

// Pipeline Run
export interface PipelineRun {
  id: string;
  number: number;
  status: PipelineRunStatus;
  trigger: TriggerType;
  ref: string;
  sha: string;
  message: string | null;
  triggeredBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

// Run Detail (with jobs and AI analysis)
export interface RunDetail extends PipelineRun {
  jobs: PipelineJob[];
  aiFailureAnalysis: AIFailureAnalysis | null;
  aiSuggestedFixes: AISuggestedFix[] | null;
}

// Pipeline Job
export interface PipelineJob {
  id: string;
  name: string;
  jobKey: string;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  logs: string | null;
}

// AI Failure Analysis
export interface AIFailureAnalysis {
  summary: string;
  rootCause: string;
  category: 'build' | 'test' | 'dependency' | 'config' | 'infrastructure' | 'unknown';
  confidence: number;
  relatedLogs: string[];
}

// AI Suggested Fix
export interface AISuggestedFix {
  title: string;
  description: string;
  confidence: number;
  codeChanges?: { file: string; diff: string }[];
  commands?: string[];
}

// Repository Analysis (for AI pipeline generation)
export interface RepoAnalysis {
  languages: { name: string; percentage: number }[];
  frameworks: string[];
  packageManagers: string[];
  hasTests: boolean;
  testFrameworks: string[];
  buildTools: string[];
  suggestedPipelines: { name: string; description: string }[];
}

// Generated Pipeline (AI output)
export interface GeneratedPipeline {
  yaml: string;
  confidence: number;
  reasoning: string;
  alternatives: { name: string; description: string }[];
}

// API Response Types
export interface PipelinesListResponse {
  pipelines: Pipeline[];
}

export interface PipelineRunsResponse {
  runs: PipelineRun[];
  total: number;
}

export interface JobLogsResponse {
  logs: string;
}

// Create Pipeline Input
export interface CreatePipelineInput {
  name: string;
  yaml: string;
}

// Trigger Run Input
export interface TriggerRunInput {
  ref?: string;
  inputs?: Record<string, string>;
}
