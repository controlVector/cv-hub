import { eq, and, desc, sql, ilike, or, gt, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import {
  organizations,
  organizationMembers,
  orgInvites,
  apps,
  type Organization,
  type NewOrganization,
  type OrganizationMember,
  type NewOrganizationMember,
  type OrgInvite,
  type OrgRole,
} from '../db/schema';
import { logger } from '../utils/logger';
import { ForbiddenError, ConflictError, NotFoundError } from '../utils/errors';

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

  // Seed initial free credits
  try {
    const { addCredits, INITIAL_FREE_CREDITS } = await import('./credit.service');
    await addCredits(org.id, INITIAL_FREE_CREDITS, 'bonus', `Welcome: ${INITIAL_FREE_CREDITS} free credits`);
  } catch (err) {
    logger.warn('general', 'Failed to seed initial credits', { orgId: org.id });
  }

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

// Update member role (with last-owner protection)
export async function updateMemberRole(
  orgId: string,
  userId: string,
  newRole: OrgRole
): Promise<OrganizationMember | null> {
  // Check if this would demote the last owner
  const currentRole = await getUserOrgRole(orgId, userId);
  if (currentRole === 'owner' && newRole !== 'owner') {
    const [ownerCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, 'owner')));
    if (Number(ownerCount?.count || 0) <= 1) {
      throw new ForbiddenError('Cannot demote the last owner');
    }
  }

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

// Remove member from organization (with last-owner protection)
export async function removeOrganizationMember(orgId: string, userId: string): Promise<boolean> {
  // Check if this would remove the last owner
  const currentRole = await getUserOrgRole(orgId, userId);
  if (currentRole === 'owner') {
    const [ownerCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, 'owner')));
    if (Number(ownerCount?.count || 0) <= 1) {
      throw new ForbiddenError('Cannot remove the last owner');
    }
  }

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
// Organization Invite Service (token-based email invites)
// ============================================================================

const INVITE_EXPIRY_DAYS = 7;

// Create an invite
export async function createInvite(
  orgId: string,
  email: string,
  role: OrgRole = 'member',
  invitedByUserId: string
): Promise<OrgInvite> {
  if (role === 'owner') {
    throw new ForbiddenError('Cannot invite as owner');
  }

  // Check for existing pending invite
  const existing = await db.query.orgInvites.findFirst({
    where: and(
      eq(orgInvites.organizationId, orgId),
      eq(orgInvites.email, email.toLowerCase()),
      isNull(orgInvites.acceptedAt),
    ),
  });
  if (existing) {
    throw new ConflictError('A pending invite already exists for this email');
  }

  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  const [invite] = await db
    .insert(orgInvites)
    .values({
      organizationId: orgId,
      email: email.toLowerCase(),
      role,
      token,
      invitedBy: invitedByUserId,
      expiresAt,
    })
    .returning();

  logger.info('general', 'Org invite created', { orgId, email: email.toLowerCase(), role });
  return invite;
}

// List pending invites for an org
export async function listPendingInvites(orgId: string): Promise<OrgInvite[]> {
  return db.query.orgInvites.findMany({
    where: and(
      eq(orgInvites.organizationId, orgId),
      isNull(orgInvites.acceptedAt),
      gt(orgInvites.expiresAt, new Date()),
    ),
    orderBy: [desc(orgInvites.createdAt)],
  });
}

// Cancel (delete) an invite
export async function cancelInvite(orgId: string, inviteId: string): Promise<boolean> {
  const result = await db
    .delete(orgInvites)
    .where(and(eq(orgInvites.id, inviteId), eq(orgInvites.organizationId, orgId)))
    .returning({ id: orgInvites.id });
  return result.length > 0;
}

// Get invite by token
export async function getInviteByToken(token: string): Promise<OrgInvite | null> {
  const invite = await db.query.orgInvites.findFirst({
    where: eq(orgInvites.token, token),
  });
  return invite ?? null;
}

// Accept an invite by token
export async function acceptInviteByToken(
  token: string,
  userId: string,
  userEmail: string
): Promise<OrganizationMember> {
  const invite = await getInviteByToken(token);
  if (!invite) {
    throw new NotFoundError('Invite');
  }
  if (invite.acceptedAt) {
    throw new ConflictError('Invite has already been accepted');
  }
  if (invite.expiresAt < new Date()) {
    throw new ForbiddenError('Invite has expired');
  }
  if (invite.email !== userEmail.toLowerCase()) {
    throw new ForbiddenError('Email does not match invite');
  }

  // Mark invite as accepted
  await db
    .update(orgInvites)
    .set({ acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(orgInvites.id, invite.id));

  // Create membership (use onConflictDoNothing in case membership already exists)
  const [member] = await db
    .insert(organizationMembers)
    .values({
      organizationId: invite.organizationId,
      userId,
      role: invite.role,
      invitedBy: invite.invitedBy,
      invitedAt: invite.createdAt,
      acceptedAt: new Date(),
    })
    .onConflictDoNothing({ target: [organizationMembers.organizationId, organizationMembers.userId] })
    .returning();

  if (!member) {
    // Already a member — return existing
    const existing = await db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.organizationId, invite.organizationId),
        eq(organizationMembers.userId, userId),
      ),
    });
    if (!existing) throw new ConflictError('Failed to create membership');
    return existing;
  }

  logger.info('general', 'Org invite accepted', { orgId: invite.organizationId, userId, token: invite.id });
  return member;
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
