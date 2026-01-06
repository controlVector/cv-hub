import { api } from '../lib/api';
import type {
  OrganizationsResponse,
  OrganizationResponse,
  OrganizationWithStats,
  CreateOrganizationInput,
  UpdateOrganizationInput,
  MembersResponse,
  OrganizationMember,
  OrgRole,
} from '../types/organization';

// List public organizations
export async function listOrganizations(params?: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<OrganizationsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());

  const response = await api.get(`/v1/orgs?${searchParams.toString()}`);
  return response.data;
}

// Get organization by slug
export async function getOrganization(slug: string): Promise<OrganizationWithStats> {
  const response = await api.get<OrganizationResponse>(`/v1/orgs/${slug}`);
  return response.data.organization;
}

// Get organization's apps
export async function getOrganizationApps(slug: string) {
  const response = await api.get(`/v1/orgs/${slug}/apps`);
  return response.data.apps;
}

// Get user's organizations
export async function getMyOrganizations(): Promise<OrganizationWithStats[]> {
  const response = await api.get<{ organizations: OrganizationWithStats[] }>('/v1/orgs/my/list');
  return response.data.organizations;
}

// Create organization
export async function createOrganization(input: CreateOrganizationInput): Promise<OrganizationWithStats> {
  const response = await api.post<OrganizationResponse>('/v1/orgs', input);
  return response.data.organization;
}

// Update organization
export async function updateOrganization(
  slug: string,
  input: UpdateOrganizationInput
): Promise<OrganizationWithStats> {
  const response = await api.put<OrganizationResponse>(`/v1/orgs/${slug}`, input);
  return response.data.organization;
}

// Delete organization
export async function deleteOrganization(slug: string): Promise<void> {
  await api.delete(`/v1/orgs/${slug}`);
}

// List organization members
export async function listMembers(slug: string): Promise<OrganizationMember[]> {
  const response = await api.get<MembersResponse>(`/v1/orgs/${slug}/members`);
  return response.data.members;
}

// Add member to organization
export async function addMember(
  slug: string,
  userId: string,
  role: OrgRole = 'member'
): Promise<OrganizationMember> {
  const response = await api.post<{ member: OrganizationMember }>(`/v1/orgs/${slug}/members`, {
    userId,
    role,
  });
  return response.data.member;
}

// Update member role
export async function updateMemberRole(
  slug: string,
  memberId: string,
  role: OrgRole
): Promise<OrganizationMember> {
  const response = await api.put<{ member: OrganizationMember }>(
    `/v1/orgs/${slug}/members/${memberId}`,
    { role }
  );
  return response.data.member;
}

// Remove member
export async function removeMember(slug: string, memberId: string): Promise<void> {
  await api.delete(`/v1/orgs/${slug}/members/${memberId}`);
}

// Transfer app to organization
export async function transferApp(slug: string, appId: string): Promise<void> {
  await api.post(`/v1/orgs/${slug}/apps/${appId}/transfer`);
}
