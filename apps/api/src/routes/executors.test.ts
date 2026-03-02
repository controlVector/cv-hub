/**
 * Executor Routes Tests
 * Unit tests for resolveOrganizationId logic and PATCH rename endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveOrganizationId } from './executors';

// Mock the organization service
vi.mock('../services/organization.service', () => ({
  getUserOrgRole: vi.fn(),
  getUserOrganizations: vi.fn(),
}));

import { getUserOrgRole, getUserOrganizations } from '../services/organization.service';

const mockGetUserOrgRole = vi.mocked(getUserOrgRole);
const mockGetUserOrganizations = vi.mocked(getUserOrganizations);

const USER_ID = '00000000-0000-0000-0000-000000000001';
const ORG_A_ID = '00000000-0000-0000-0000-00000000000a';
const ORG_B_ID = '00000000-0000-0000-0000-00000000000b';

function fakeOrg(id: string, name: string, slug: string) {
  return {
    id,
    name,
    slug,
    description: null,
    avatarUrl: null,
    websiteUrl: null,
    isPublic: true,
    tierId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    memberCount: 1,
    appCount: 0,
  } as any;
}

describe('resolveOrganizationId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses explicit org_id when user is a member', async () => {
    mockGetUserOrgRole.mockResolvedValue('member');

    const result = await resolveOrganizationId(USER_ID, ORG_A_ID);
    expect(result).toEqual({ orgId: ORG_A_ID });
    expect(mockGetUserOrgRole).toHaveBeenCalledWith(ORG_A_ID, USER_ID);
  });

  it('rejects explicit org_id when user is NOT a member', async () => {
    mockGetUserOrgRole.mockResolvedValue(null);

    const result = await resolveOrganizationId(USER_ID, ORG_A_ID);
    expect(result).toHaveProperty('error');
    expect(result.error!.message).toMatch(/not a member/);
  });

  it('uses PAT org scope when no explicit org_id', async () => {
    const result = await resolveOrganizationId(USER_ID, undefined, ORG_A_ID);
    expect(result).toEqual({ orgId: ORG_A_ID });
    // Should NOT call getUserOrganizations since PAT org is available
    expect(mockGetUserOrganizations).not.toHaveBeenCalled();
  });

  it('auto-resolves when user has exactly 1 org', async () => {
    mockGetUserOrganizations.mockResolvedValue([fakeOrg(ORG_A_ID, 'Org A', 'org-a')]);

    const result = await resolveOrganizationId(USER_ID);
    expect(result).toEqual({ orgId: ORG_A_ID });
  });

  it('returns undefined when user has 0 orgs', async () => {
    mockGetUserOrganizations.mockResolvedValue([]);

    const result = await resolveOrganizationId(USER_ID);
    expect(result).toEqual({ orgId: undefined });
  });

  it('returns error with org list when user has 2+ orgs', async () => {
    mockGetUserOrganizations.mockResolvedValue([
      fakeOrg(ORG_A_ID, 'Org A', 'org-a'),
      fakeOrg(ORG_B_ID, 'Org B', 'org-b'),
    ]);

    const result = await resolveOrganizationId(USER_ID);
    expect(result).toHaveProperty('error');
    expect(result.error!.message).toMatch(/Multiple organizations/);
    expect(result.error!.organizations).toHaveLength(2);
    expect(result.error!.organizations![0]).toEqual({ id: ORG_A_ID, name: 'Org A', slug: 'org-a' });
  });

  it('explicit org_id takes priority over PAT org', async () => {
    mockGetUserOrgRole.mockResolvedValue('owner');

    const result = await resolveOrganizationId(USER_ID, ORG_A_ID, ORG_B_ID);
    expect(result).toEqual({ orgId: ORG_A_ID });
    // Should use explicit, not PAT
    expect(mockGetUserOrgRole).toHaveBeenCalledWith(ORG_A_ID, USER_ID);
  });

  it('backward compat: explicit organization_id still accepted', async () => {
    // Same as first test — explicit org_id is the "backward compat" path
    mockGetUserOrgRole.mockResolvedValue('admin');

    const result = await resolveOrganizationId(USER_ID, ORG_B_ID);
    expect(result).toEqual({ orgId: ORG_B_ID });
  });
});
