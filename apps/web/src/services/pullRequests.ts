/**
 * Pull Request Service
 * API client for PR operations
 */

import { api } from '../lib/api';

export interface PullRequestAuthor {
  id: string;
  username: string;
  displayName: string | null;
}

export interface PullRequestRepository {
  id: string;
  slug: string;
  name: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: 'draft' | 'open' | 'closed' | 'merged';
  sourceBranch: string;
  targetBranch: string;
  sourceSha: string | null;
  targetSha: string | null;
  isDraft: boolean;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  author: PullRequestAuthor;
  repository: PullRequestRepository;
  reviewCount: number;
  commentCount: number;
}

export interface ListPRsResponse {
  pullRequests: PullRequest[];
  total: number;
}

/**
 * Get PRs for a repository
 */
export async function getRepositoryPullRequests(
  owner: string,
  repo: string,
  options: { state?: string; limit?: number; offset?: number } = {}
): Promise<ListPRsResponse> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());

  const response = await api.get(`/v1/repos/${owner}/${repo}/pulls?${params.toString()}`);
  return response.data;
}

/**
 * Get PRs authored by current user
 */
export async function getUserPullRequests(
  options: { state?: string; limit?: number; offset?: number } = {}
): Promise<{ pullRequests: PullRequest[] }> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());

  const response = await api.get(`/v1/user/pulls?${params.toString()}`);
  return response.data;
}

/**
 * Get PRs where user has review requests
 */
export async function getUserReviewRequests(): Promise<{ pullRequests: PullRequest[] }> {
  const response = await api.get('/v1/user/pulls/review-requests');
  return response.data;
}

/**
 * Get a specific PR
 */
export async function getPullRequest(
  owner: string,
  repo: string,
  number: number
): Promise<{ pullRequest: PullRequest }> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/pulls/${number}`);
  return response.data;
}

/**
 * Create a new PR
 */
export async function createPullRequest(
  owner: string,
  repo: string,
  data: {
    title: string;
    body?: string;
    sourceBranch: string;
    targetBranch: string;
    isDraft?: boolean;
    labels?: string[];
  }
): Promise<{ pullRequest: PullRequest }> {
  const response = await api.post(`/v1/repos/${owner}/${repo}/pulls`, data);
  return response.data;
}

/**
 * Update a PR
 */
export async function updatePullRequest(
  owner: string,
  repo: string,
  number: number,
  data: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    isDraft?: boolean;
    labels?: string[];
  }
): Promise<{ pullRequest: PullRequest }> {
  const response = await api.patch(`/v1/repos/${owner}/${repo}/pulls/${number}`, data);
  return response.data;
}

/**
 * Merge a PR
 */
export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge'
): Promise<{ pullRequest: PullRequest; merged: boolean }> {
  const response = await api.put(`/v1/repos/${owner}/${repo}/pulls/${number}/merge`, { mergeMethod });
  return response.data;
}

/**
 * Submit a review
 */
export async function submitReview(
  owner: string,
  repo: string,
  number: number,
  data: {
    state: 'approved' | 'changes_requested' | 'commented';
    body?: string;
  }
): Promise<any> {
  const response = await api.post(`/v1/repos/${owner}/${repo}/pulls/${number}/reviews`, data);
  return response.data;
}
