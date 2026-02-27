/**
 * Centralized React Query hooks for the CV-Hub API.
 *
 * Wraps service functions with consistent query keys and default options.
 * Pages can import these instead of writing inline useQuery calls.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

// Services
import {
  listRepositories,
  type RepositoryListResponse,
} from '../services/repository';
import {
  getMyOrganizations,
  getOrganization,
  listMembers,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
} from '../services/organization';
import {
  getRepositoryIssues,
  getUserIssues,
  createIssue,
  type ListIssuesResponse,
} from '../services/issues';
import {
  getRepositoryPullRequests,
  getUserPullRequests,
  type ListPRsResponse,
} from '../services/pullRequests';
import { fetchOrgSubscription } from '../services/pricing';
import type { OrganizationWithStats, OrganizationMember } from '../types/organization';
import type { SubscriptionResponse } from '../types/pricing';

// ── Query key factories ──────────────────────────────────────────────

export const queryKeys = {
  dashboard: ['dashboard-stats'] as const,
  repos: (filters?: { search?: string; visibility?: string }) =>
    ['repositories', filters?.search, filters?.visibility] as const,
  repo: (owner: string, repo: string) => ['repository', owner, repo] as const,
  myOrgs: ['my-organizations'] as const,
  org: (slug: string) => ['organization', slug] as const,
  orgMembers: (slug: string) => ['org-members', slug] as const,
  orgSubscription: (orgId: string) => ['org-subscription', orgId] as const,
  repoIssues: (owner: string, repo: string, state?: string) =>
    ['repo-issues', owner, repo, state] as const,
  userIssues: (state?: string) => ['user-issues', state] as const,
  repoPRs: (owner: string, repo: string, state?: string) =>
    ['repo-prs', owner, repo, state] as const,
  userPRs: (state?: string) => ['user-prs', state] as const,
} as const;

// ── Dashboard ────────────────────────────────────────────────────────

export interface DashboardStats {
  stats: {
    repositories: number;
    pullRequests: number;
    openIssues: number;
  };
  recentRepositories: {
    id: string;
    name: string;
    slug: string;
    fullName: string;
    description: string | null;
    visibility: string;
    starCount: number;
    openIssueCount: number;
    openPrCount: number;
    graphSyncStatus: string;
    updatedAt: string;
  }[];
  billing: {
    orgId: string;
    orgSlug: string;
    orgName: string;
    tierName: string;
    tierDisplayName: string;
    isFreeTier: boolean;
    usage: { repos: number; members: number };
    limits: {
      repositories: number | null;
      teamMembers: number | null;
      storageGb: number | null;
      environments: number | null;
      buildMinutes: number | null;
    };
  } | null;
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: queryKeys.dashboard,
    queryFn: async () => {
      const response = await api.get('/v1/dashboard/stats');
      return response.data;
    },
    staleTime: 30_000,
  });
}

// ── Repositories ─────────────────────────────────────────────────────

export function useRepositories(filters?: {
  search?: string;
  visibility?: string;
  limit?: number;
}) {
  return useQuery<RepositoryListResponse>({
    queryKey: queryKeys.repos(filters),
    queryFn: () => listRepositories(filters),
  });
}

// ── Organizations ────────────────────────────────────────────────────

export function useMyOrganizations() {
  return useQuery<OrganizationWithStats[]>({
    queryKey: queryKeys.myOrgs,
    queryFn: getMyOrganizations,
  });
}

export function useOrganization(slug: string) {
  return useQuery<OrganizationWithStats>({
    queryKey: queryKeys.org(slug),
    queryFn: () => getOrganization(slug),
    enabled: !!slug,
  });
}

export function useOrgMembers(slug: string) {
  return useQuery<OrganizationMember[]>({
    queryKey: queryKeys.orgMembers(slug),
    queryFn: () => listMembers(slug),
    enabled: !!slug,
  });
}

export function useOrgSubscription(orgId: string) {
  return useQuery<SubscriptionResponse>({
    queryKey: queryKeys.orgSubscription(orgId),
    queryFn: () => fetchOrgSubscription(orgId),
    enabled: !!orgId,
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) => createOrganization(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myOrgs });
    },
  });
}

export function useUpdateOrganization(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOrganizationInput) => updateOrganization(slug, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.org(slug) });
      queryClient.invalidateQueries({ queryKey: queryKeys.myOrgs });
    },
  });
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteOrganization(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myOrgs });
    },
  });
}

// ── Issues ───────────────────────────────────────────────────────────

export function useRepoIssues(
  owner: string,
  repo: string,
  options?: { state?: 'open' | 'closed' | 'all'; limit?: number },
) {
  return useQuery<ListIssuesResponse>({
    queryKey: queryKeys.repoIssues(owner, repo, options?.state),
    queryFn: () => getRepositoryIssues(owner, repo, options),
    enabled: !!owner && !!repo,
  });
}

export function useUserIssues(state?: string) {
  return useQuery({
    queryKey: queryKeys.userIssues(state),
    queryFn: () => getUserIssues({ state }),
  });
}

export function useCreateIssue(owner: string, repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof createIssue>[2]) => createIssue(owner, repo, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.repoIssues(owner, repo) });
    },
  });
}

// ── Pull Requests ────────────────────────────────────────────────────

export function useRepoPRs(
  owner: string,
  repo: string,
  options?: { state?: string; limit?: number },
) {
  return useQuery<ListPRsResponse>({
    queryKey: queryKeys.repoPRs(owner, repo, options?.state),
    queryFn: () => getRepositoryPullRequests(owner, repo, options),
    enabled: !!owner && !!repo,
  });
}

export function useUserPRs(state?: string) {
  return useQuery({
    queryKey: queryKeys.userPRs(state),
    queryFn: () => getUserPullRequests({ state }),
  });
}
