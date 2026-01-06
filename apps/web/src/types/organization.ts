// Organization types matching the backend

export interface Organization {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  isPublic: boolean;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationWithStats extends Organization {
  memberCount: number;
  appCount: number;
}

export type OrgRole = 'owner' | 'admin' | 'member';

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  invitedBy?: string | null;
  invitedAt?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
}

export interface CreateOrganizationInput {
  slug: string;
  name: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  isPublic?: boolean;
}

export interface UpdateOrganizationInput {
  name?: string;
  description?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  isPublic?: boolean;
}

export interface OrganizationsResponse {
  organizations: OrganizationWithStats[];
  pagination: {
    limit: number;
    offset: number;
  };
}

export interface OrganizationResponse {
  organization: OrganizationWithStats;
}

export interface MembersResponse {
  members: OrganizationMember[];
}
