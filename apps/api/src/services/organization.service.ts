import { eq, and, desc, sql, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import {
  organizations,
  organizationMembers,
  apps,
  type Organization,
  type NewOrganization,
  type OrganizationMember,
  type NewOrganizationMember,
  type OrgRole,
} from '../db/schema';
import { logger } from '../utils/logger';

// ============================================================================
// Organization Service
// ============================================================================

export interface OrganizationWithStats extends Organization {
  memberCount: number;
  appCount: number;
}

export interface OrganizationListFilters {
  search?: string;
  publicOnly?: boolean;
  limit?: number;
  offset?: number;
}

// List organizations
export async function listOrganizations(filters: OrganizationListFilters = {}): Promise<OrganizationWithStats[]> {
  const { search, publicOnly = true, limit = 50, offset = 0 } = filters;

  const conditions = [];
  if (publicOnly) conditions.push(eq(organizations.isPublic, true));
  if (search) {
    conditions.push(
      or(
        ilike(organizations.name, `%${search}%`),
        ilike(organizations.slug, `%${search}%`),
        ilike(organizations.description, `%${search}%`)
      )!
    );
  }

  const orgList = await db.query.organizations.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(organizations.isVerified), desc(organizations.createdAt)],
    limit,
    offset,
  });

  // Get stats for each org
  const orgsWithStats: OrganizationWithStats[] = [];
  for (const org of orgList) {
    const [memberStats] = await db
      .select({ count: sql<number>`count(*)` })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, org.id));

    const [appStats] = await db
      .select({ count: sql<number>`count(*)` })
      .from(apps)
      .where(and(eq(apps.organizationId, org.id), eq(apps.isActive, true)));

    orgsWithStats.push({
      ...org,
      memberCount: Number(memberStats?.count || 0),
      appCount: Number(appStats?.count || 0),
    });
  }

  return orgsWithStats;
}

// Get organization by ID
export async function getOrganizationById(orgId: string): Promise<OrganizationWithStats | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) return null;

  const [memberStats] = await db
    .select({ count: sql<number>`count(*)` })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, org.id));

  const [appStats] = await db
    .select({ count: sql<number>`count(*)` })
    .from(apps)
    .where(and(eq(apps.organizationId, org.id), eq(apps.isActive, true)));

  return {
    ...org,
    memberCount: Number(memberStats?.count || 0),
    appCount: Number(appStats?.count || 0),
  };
}

// Get organization by slug
export async function getOrganizationBySlug(slug: string): Promise<OrganizationWithStats | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, slug),
  });

  if (!org) return null;

  const [memberStats] = await db
    .select({ count: sql<number>`count(*)` })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, org.id));

  const [appStats] = await db
    .select({ count: sql<number>`count(*)` })
    .from(apps)
    .where(and(eq(apps.organizationId, org.id), eq(apps.isActive, true)));

  return {
    ...org,
    memberCount: Number(memberStats?.count || 0),
    appCount: Number(appStats?.count || 0),
  };
}

// Create organization
export async function createOrganization(
  input: NewOrganization,
  creatorUserId: string
): Promise<Organization> {
  // Create the organization
  const [org] = await db.insert(organizations).values(input).returning();

  // Add creator as owner
  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId: creatorUserId,
    role: 'owner',
    acceptedAt: new Date(),
  });

  logger.info('general', 'Organization created', { orgId: org.id, slug: org.slug, creatorId: creatorUserId });
  return org;
}

// Update organization
export async function updateOrganization(
  orgId: string,
  updates: Partial<NewOrganization>
): Promise<Organization | null> {
  const [org] = await db
    .update(organizations)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .returning();

  if (org) {
    logger.info('general', 'Organization updated', { orgId });
  }
  return org ?? null;
}

// Delete organization
export async function deleteOrganization(orgId: string): Promise<boolean> {
  const result = await db
    .delete(organizations)
    .where(eq(organizations.id, orgId))
    .returning({ id: organizations.id });

  if (result.length > 0) {
    logger.info('general', 'Organization deleted', { orgId });
    return true;
  }
  return false;
}

// ============================================================================
// Organization Member Service
// ============================================================================

export interface MemberWithUser extends OrganizationMember {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

// List organization members
export async function listOrganizationMembers(orgId: string): Promise<MemberWithUser[]> {
  const members = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.organizationId, orgId),
    with: {
      user: {
        columns: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: [desc(organizationMembers.createdAt)],
  });

  return members as MemberWithUser[];
}

// Get user's role in organization
export async function getUserOrgRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const member = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, orgId),
      eq(organizationMembers.userId, userId)
    ),
  });

  return member?.role ?? null;
}

// Check if user is org admin (owner or admin)
export async function isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
  const role = await getUserOrgRole(orgId, userId);
  return role === 'owner' || role === 'admin';
}

// Check if user is org owner
export async function isOrgOwner(orgId: string, userId: string): Promise<boolean> {
  const role = await getUserOrgRole(orgId, userId);
  return role === 'owner';
}

// Add member to organization
export async function addOrganizationMember(
  orgId: string,
  userId: string,
  role: OrgRole = 'member',
  invitedBy?: string
): Promise<OrganizationMember> {
  const [member] = await db
    .insert(organizationMembers)
    .values({
      organizationId: orgId,
      userId,
      role,
      invitedBy,
      invitedAt: invitedBy ? new Date() : undefined,
      acceptedAt: !invitedBy ? new Date() : undefined,
    })
    .returning();

  logger.info('general', 'Organization member added', { orgId, userId, role });
  return member;
}

// Update member role
export async function updateMemberRole(
  orgId: string,
  userId: string,
  newRole: OrgRole
): Promise<OrganizationMember | null> {
  const [member] = await db
    .update(organizationMembers)
    .set({ role: newRole, updatedAt: new Date() })
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, userId)
      )
    )
    .returning();

  if (member) {
    logger.info('general', 'Organization member role updated', { orgId, userId, newRole });
  }
  return member ?? null;
}

// Remove member from organization
export async function removeOrganizationMember(orgId: string, userId: string): Promise<boolean> {
  const result = await db
    .delete(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, userId)
      )
    )
    .returning({ id: organizationMembers.id });

  if (result.length > 0) {
    logger.info('general', 'Organization member removed', { orgId, userId });
    return true;
  }
  return false;
}

// Accept invitation
export async function acceptInvitation(orgId: string, userId: string): Promise<OrganizationMember | null> {
  const [member] = await db
    .update(organizationMembers)
    .set({ acceptedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, userId)
      )
    )
    .returning();

  if (member) {
    logger.info('general', 'Organization invitation accepted', { orgId, userId });
  }
  return member ?? null;
}

// Get user's organizations
export async function getUserOrganizations(userId: string): Promise<OrganizationWithStats[]> {
  const memberships = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.userId, userId),
  });

  const orgsWithStats: OrganizationWithStats[] = [];
  for (const membership of memberships) {
    const org = await getOrganizationById(membership.organizationId);
    if (org) {
      orgsWithStats.push(org);
    }
  }

  return orgsWithStats;
}

// ============================================================================
// Organization Apps Service
// ============================================================================

// Get apps for an organization
export async function getOrganizationApps(orgId: string) {
  // Use the app-store service's listApps to get apps with latest release info
  const { listApps } = await import('./app-store.service');
  return listApps({ organizationId: orgId });
}

// Transfer app to organization
export async function transferAppToOrganization(
  appId: string,
  orgId: string | null
): Promise<boolean> {
  const [result] = await db
    .update(apps)
    .set({ organizationId: orgId, updatedAt: new Date() })
    .where(eq(apps.id, appId))
    .returning({ id: apps.id });

  if (result) {
    logger.info('general', 'App transferred to organization', { appId, orgId });
    return true;
  }
  return false;
}
