/**
 * Issue Service
 * API client for issue operations
 */

import { api } from '../lib/api';

export interface IssueAuthor {
  id: string;
  username: string;
  displayName: string | null;
}

export interface IssueRepository {
  id: string;
  slug: string;
  name: string;
}

export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  labels: string[];
  assigneeIds: string[];
  milestone: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: IssueAuthor;
  repository: IssueRepository;
  commentCount: number;
}

export interface ListIssuesResponse {
  issues: Issue[];
  total: number;
}

export interface IssueComment {
  id: string;
  body: string;
  authorId: string;
  author?: { username: string; displayName: string | null };
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get issues for a repository
 */
export async function getRepositoryIssues(
  owner: string,
  repo: string,
  options: {
    state?: 'open' | 'closed' | 'all';
    priority?: string;
    labels?: string;
    milestone?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<ListIssuesResponse> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.priority) params.set('priority', options.priority);
  if (options.labels) params.set('labels', options.labels);
  if (options.milestone) params.set('milestone', options.milestone);
  if (options.search) params.set('search', options.search);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());

  const response = await api.get(`/v1/repos/${owner}/${repo}/issues?${params.toString()}`);
  return response.data;
}

/**
 * Get issues authored by current user
 */
export async function getUserIssues(
  options: { state?: string; limit?: number; offset?: number } = {}
): Promise<{ issues: Issue[] }> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());

  const response = await api.get(`/v1/user/issues?${params.toString()}`);
  return response.data;
}

/**
 * Get issues assigned to current user
 */
export async function getUserAssignedIssues(
  options: { state?: string; limit?: number; offset?: number } = {}
): Promise<{ issues: Issue[] }> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());

  const response = await api.get(`/v1/user/issues/assigned?${params.toString()}`);
  return response.data;
}

/**
 * Get a specific issue
 */
export async function getIssue(
  owner: string,
  repo: string,
  number: number
): Promise<{ issue: Issue }> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/issues/${number}`);
  return response.data;
}

/**
 * Create a new issue
 */
export async function createIssue(
  owner: string,
  repo: string,
  data: {
    title: string;
    body?: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    labels?: string[];
    assigneeIds?: string[];
    milestone?: string;
  }
): Promise<{ issue: Issue }> {
  const response = await api.post(`/v1/repos/${owner}/${repo}/issues`, data);
  return response.data;
}

/**
 * Update an issue
 */
export async function updateIssue(
  owner: string,
  repo: string,
  number: number,
  data: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    priority?: 'low' | 'medium' | 'high' | 'critical';
    labels?: string[];
    assigneeIds?: string[];
    milestone?: string | null;
  }
): Promise<{ issue: Issue }> {
  const response = await api.patch(`/v1/repos/${owner}/${repo}/issues/${number}`, data);
  return response.data;
}

/**
 * Close an issue
 */
export async function closeIssue(
  owner: string,
  repo: string,
  number: number
): Promise<{ issue: Issue }> {
  const response = await api.post(`/v1/repos/${owner}/${repo}/issues/${number}/close`);
  return response.data;
}

/**
 * Reopen an issue
 */
export async function reopenIssue(
  owner: string,
  repo: string,
  number: number
): Promise<{ issue: Issue }> {
  const response = await api.post(`/v1/repos/${owner}/${repo}/issues/${number}/reopen`);
  return response.data;
}

/**
 * Get comments for an issue
 */
export async function getIssueComments(
  owner: string,
  repo: string,
  number: number
): Promise<{ comments: IssueComment[] }> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/issues/${number}/comments`);
  return response.data;
}

/**
 * Add a comment to an issue
 */
export async function addIssueComment(
  owner: string,
  repo: string,
  number: number,
  body: string
): Promise<{ comment: IssueComment }> {
  const response = await api.post(`/v1/repos/${owner}/${repo}/issues/${number}/comments`, { body });
  return response.data;
}

/**
 * Get labels for a repository
 */
export async function getRepositoryLabels(
  owner: string,
  repo: string
): Promise<{ labels: string[] }> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/labels`);
  return response.data;
}

/**
 * Get milestones for a repository
 */
export async function getRepositoryMilestones(
  owner: string,
  repo: string
): Promise<{ milestones: string[] }> {
  const response = await api.get(`/v1/repos/${owner}/${repo}/milestones`);
  return response.data;
}
