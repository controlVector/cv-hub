/**
 * CI/CD Service
 * API client for CI/CD operations
 */

import { api } from '../lib/api';
import type {
  Pipeline,
  PipelineRun,
  RunDetail,
  PipelinesListResponse,
  PipelineRunsResponse,
  RepoAnalysis,
  GeneratedPipeline,
  CreatePipelineInput,
  TriggerRunInput,
  JobLogsResponse,
} from '../types/ci-cd';

/**
 * List pipelines for a repository
 */
export async function listPipelines(owner: string, repo: string): Promise<Pipeline[]> {
  const response = await api.get<PipelinesListResponse>(`/v1/repos/${owner}/${repo}/pipelines`);
  return response.data.pipelines;
}

/**
 * Get a specific pipeline
 */
export async function getPipeline(owner: string, repo: string, slug: string): Promise<Pipeline> {
  const response = await api.get<Pipeline>(`/v1/repos/${owner}/${repo}/pipelines/${slug}`);
  return response.data;
}

/**
 * Create a new pipeline
 */
export async function createPipeline(
  owner: string,
  repo: string,
  data: CreatePipelineInput
): Promise<Pipeline> {
  const response = await api.post<Pipeline>(`/v1/repos/${owner}/${repo}/pipelines`, data);
  return response.data;
}

/**
 * Update a pipeline's YAML
 */
export async function updatePipeline(
  owner: string,
  repo: string,
  slug: string,
  yaml: string
): Promise<Pipeline> {
  const response = await api.put<Pipeline>(`/v1/repos/${owner}/${repo}/pipelines/${slug}`, { yaml });
  return response.data;
}

/**
 * Delete a pipeline
 */
export async function deletePipeline(owner: string, repo: string, slug: string): Promise<void> {
  await api.delete(`/v1/repos/${owner}/${repo}/pipelines/${slug}`);
}

/**
 * List runs for a pipeline
 */
export async function listRuns(
  owner: string,
  repo: string,
  slug: string,
  options?: { limit?: number; offset?: number }
): Promise<PipelineRunsResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await api.get<PipelineRunsResponse>(
    `/v1/repos/${owner}/${repo}/pipelines/${slug}/runs${query}`
  );
  return response.data;
}

/**
 * Get a specific run with full details
 */
export async function getRun(
  owner: string,
  repo: string,
  slug: string,
  runNumber: number
): Promise<RunDetail> {
  const response = await api.get<RunDetail>(
    `/v1/repos/${owner}/${repo}/pipelines/${slug}/runs/${runNumber}`
  );
  return response.data;
}

/**
 * Trigger a new pipeline run
 */
export async function triggerRun(
  owner: string,
  repo: string,
  slug: string,
  input?: TriggerRunInput
): Promise<PipelineRun> {
  const response = await api.post<PipelineRun>(
    `/v1/repos/${owner}/${repo}/pipelines/${slug}/runs`,
    input || {}
  );
  return response.data;
}

/**
 * Cancel a running pipeline
 */
export async function cancelRun(
  owner: string,
  repo: string,
  slug: string,
  runNumber: number
): Promise<void> {
  await api.post(`/v1/repos/${owner}/${repo}/pipelines/${slug}/runs/${runNumber}/cancel`);
}

/**
 * Rerun failed jobs in a pipeline run
 */
export async function rerunFailedJobs(
  owner: string,
  repo: string,
  slug: string,
  runNumber: number
): Promise<PipelineRun> {
  const response = await api.post<PipelineRun>(
    `/v1/repos/${owner}/${repo}/pipelines/${slug}/runs/${runNumber}/rerun`
  );
  return response.data;
}

/**
 * Get logs for a specific job
 */
export async function getJobLogs(
  owner: string,
  repo: string,
  slug: string,
  runNumber: number,
  jobId: string
): Promise<string> {
  const response = await api.get<JobLogsResponse>(
    `/v1/repos/${owner}/${repo}/pipelines/${slug}/runs/${runNumber}/jobs/${jobId}/logs`
  );
  return response.data.logs;
}

/**
 * Analyze repository for AI pipeline generation
 */
export async function analyzeRepository(owner: string, repo: string): Promise<RepoAnalysis> {
  const response = await api.post<RepoAnalysis>(`/v1/repos/${owner}/${repo}/pipelines/analyze`);
  return response.data;
}

/**
 * Generate a pipeline from natural language prompt
 */
export async function generatePipeline(
  owner: string,
  repo: string,
  prompt: string
): Promise<GeneratedPipeline> {
  const response = await api.post<GeneratedPipeline>(
    `/v1/repos/${owner}/${repo}/pipelines/generate`,
    { prompt }
  );
  return response.data;
}

// React Query hooks helpers
export const cicdQueryKeys = {
  all: ['cicd'] as const,
  pipelines: (owner: string, repo: string) => [...cicdQueryKeys.all, 'pipelines', owner, repo] as const,
  pipeline: (owner: string, repo: string, slug: string) =>
    [...cicdQueryKeys.pipelines(owner, repo), slug] as const,
  runs: (owner: string, repo: string, slug: string) =>
    [...cicdQueryKeys.pipeline(owner, repo, slug), 'runs'] as const,
  run: (owner: string, repo: string, slug: string, runNumber: number) =>
    [...cicdQueryKeys.runs(owner, repo, slug), runNumber] as const,
  repoAnalysis: (owner: string, repo: string) =>
    [...cicdQueryKeys.all, 'analysis', owner, repo] as const,
};
