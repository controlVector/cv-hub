import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import {
  listOrganizations,
  getOrganizationById,
  getOrganizationBySlug,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  listOrganizationMembers,
  getUserOrgRole,
  isOrgAdmin,
  isOrgOwner,
  addOrganizationMember,
  updateMemberRole,
  removeOrganizationMember,
  acceptInvitation,
  getUserOrganizations,
  getOrganizationApps,
  transferAppToOrganization,
} from '../services/organization.service';
import { listApps } from '../services/app-store.service';
import { logAuditEvent, type AuditAction } from '../services/audit.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const orgRoutes = new Hono<AppEnv>();

// Organization roles for validation
const orgRoles = ['owner', 'admin', 'member'] as const;

// Helper to get request metadata
function getRequestMeta(c: any) {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : undefined,
    userAgent: c.req.header('user-agent'),
  };
}

// Middleware to check org admin access
async function requireOrgAdmin(c: any, orgId: string) {
  const userId = c.get('userId');
  if (!userId) throw new ForbiddenError('Authentication required');

  const isAdmin = await isOrgAdmin(orgId, userId);
  if (!isAdmin) throw new ForbiddenError('Admin access required');
}

// Middleware to check org owner access
async function requireOrgOwner(c: any, orgId: string) {
  const userId = c.get('userId');
  if (!userId) throw new ForbiddenError('Authentication required');

  const isOwner = await isOrgOwner(orgId, userId);
  if (!isOwner) throw new ForbiddenError('Owner access required');
}

// ============================================================================
// Public APIs
// ============================================================================

// GET /api/v1/orgs - List public organizations
const listOrgsSchema = z.object({
  search: z.string().max(100).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

orgRoutes.get('/', zValidator('query', listOrgsSchema), async (c) => {
  const query = c.req.valid('query');

  const orgs = await listOrganizations({
    search: query.search,
    publicOnly: true,
    limit: query.limit,
    offset: query.offset,
  });

  return c.json({
    organizations: orgs,
    pagination: {
      limit: query.limit || 50,
      offset: query.offset || 0,
    },
  });
});

// GET /api/v1/orgs/:slug - Get organization by slug (storefront)
orgRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  // Check if org is public, or user is a member
  const userId = c.get('userId');
  if (!org.isPublic && userId) {
    const role = await getUserOrgRole(org.id, userId);
    if (!role) {
      throw new NotFoundError('Organization');
    }
  } else if (!org.isPublic) {
    throw new NotFoundError('Organization');
  }

  return c.json({ organization: org });
});

// GET /api/v1/orgs/:slug/apps - Get organization's apps (storefront)
orgRoutes.get('/:slug/apps', async (c) => {
  const slug = c.req.param('slug');

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  // Check access
  const userId = c.get('userId');
  if (!org.isPublic && userId) {
    const role = await getUserOrgRole(org.id, userId);
    if (!role) {
      throw new NotFoundError('Organization');
    }
  } else if (!org.isPublic) {
    throw new NotFoundError('Organization');
  }

  const apps = await getOrganizationApps(org.id);

  return c.json({ apps });
});

// ============================================================================
// Authenticated User APIs
// ============================================================================

// GET /api/v1/orgs/my/list - Get user's organizations
orgRoutes.get('/my/list', requireAuth, async (c) => {
  const userId = c.get('userId')!;

  const orgs = await getUserOrganizations(userId);

  return c.json({ organizations: orgs });
});

// POST /api/v1/orgs - Create organization
const createOrgSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  logoUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  isPublic: z.boolean().optional(),
});

orgRoutes.post('/', requireAuth, zValidator('json', createOrgSchema), async (c) => {
  const userId = c.get('userId')!;
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);

  const org = await createOrganization(input, userId);

  await logAuditEvent({
    userId,
    action: 'organization.created' as AuditAction,
    resource: 'organization',
    resourceId: org.id,
    details: { slug: org.slug, name: org.name },
    status: 'success',
    ...meta,
  });

  return c.json({ organization: org }, 201);
});

// ============================================================================
// Organization Admin APIs
// ============================================================================

// PUT /api/v1/orgs/:slug - Update organization (admin only)
const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  websiteUrl: z.string().url().nullable().optional(),
  isPublic: z.boolean().optional(),
});

orgRoutes.put('/:slug', requireAuth, zValidator('json', updateOrgSchema), async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId');
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  await requireOrgAdmin(c, org.id);

  const updated = await updateOrganization(org.id, input);

  await logAuditEvent({
    userId,
    action: 'organization.updated' as AuditAction,
    resource: 'organization',
    resourceId: org.id,
    status: 'success',
    ...meta,
  });

  return c.json({ organization: updated });
});

// DELETE /api/v1/orgs/:slug - Delete organization (owner only)
orgRoutes.delete('/:slug', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId');
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  await requireOrgOwner(c, org.id);

  await deleteOrganization(org.id);

  await logAuditEvent({
    userId,
    action: 'organization.deleted' as AuditAction,
    resource: 'organization',
    resourceId: org.id,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// ============================================================================
// Member Management APIs (admin only)
// ============================================================================

// GET /api/v1/orgs/:slug/members - List organization members
orgRoutes.get('/:slug/members', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId')!;

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  // Must be a member to see other members
  const role = await getUserOrgRole(org.id, userId);
  if (!role) {
    throw new ForbiddenError('Member access required');
  }

  const members = await listOrganizationMembers(org.id);

  return c.json({ members });
});

// POST /api/v1/orgs/:slug/members - Add/invite member (admin only)
const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(orgRoles).optional(),
});

orgRoutes.post('/:slug/members', requireAuth, zValidator('json', addMemberSchema), async (c) => {
  const slug = c.req.param('slug');
  const currentUserId = c.get('userId');
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  await requireOrgAdmin(c, org.id);

  // Cannot add as owner (ownership transfer is different)
  if (input.role === 'owner') {
    throw new ForbiddenError('Cannot add member as owner');
  }

  const member = await addOrganizationMember(
    org.id,
    input.userId,
    input.role || 'member',
    currentUserId
  );

  await logAuditEvent({
    userId: currentUserId,
    action: 'organization.member_added' as AuditAction,
    resource: 'organization_member',
    resourceId: member.id,
    details: { organizationId: org.id, targetUserId: input.userId, role: input.role || 'member' },
    status: 'success',
    ...meta,
  });

  return c.json({ member }, 201);
});

// PUT /api/v1/orgs/:slug/members/:userId - Update member role (admin only)
const updateMemberSchema = z.object({
  role: z.enum(orgRoles),
});

orgRoutes.put('/:slug/members/:memberId', requireAuth, zValidator('json', updateMemberSchema), async (c) => {
  const slug = c.req.param('slug');
  const memberId = c.req.param('memberId');
  const currentUserId = c.get('userId');
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  // Changing to/from owner requires owner permission
  if (input.role === 'owner') {
    await requireOrgOwner(c, org.id);
  } else {
    await requireOrgAdmin(c, org.id);
  }

  // Check if target is an owner (cannot demote owner unless you're the owner)
  const targetRole = await getUserOrgRole(org.id, memberId);
  if (targetRole === 'owner') {
    await requireOrgOwner(c, org.id);
  }

  const member = await updateMemberRole(org.id, memberId, input.role);
  if (!member) {
    throw new NotFoundError('Member');
  }

  await logAuditEvent({
    userId: currentUserId,
    action: 'organization.member_updated' as AuditAction,
    resource: 'organization_member',
    resourceId: member.id,
    details: { organizationId: org.id, targetUserId: memberId, newRole: input.role },
    status: 'success',
    ...meta,
  });

  return c.json({ member });
});

// DELETE /api/v1/orgs/:slug/members/:userId - Remove member (admin only)
orgRoutes.delete('/:slug/members/:memberId', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const memberId = c.req.param('memberId');
  const currentUserId = c.get('userId');
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  await requireOrgAdmin(c, org.id);

  // Cannot remove owner
  const targetRole = await getUserOrgRole(org.id, memberId);
  if (targetRole === 'owner') {
    throw new ForbiddenError('Cannot remove organization owner');
  }

  const removed = await removeOrganizationMember(org.id, memberId);
  if (!removed) {
    throw new NotFoundError('Member');
  }

  await logAuditEvent({
    userId: currentUserId,
    action: 'organization.member_removed' as AuditAction,
    resource: 'organization_member',
    resourceId: memberId,
    details: { organizationId: org.id, targetUserId: memberId },
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// POST /api/v1/orgs/:slug/accept - Accept invitation
orgRoutes.post('/:slug/accept', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId')!;
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  const member = await acceptInvitation(org.id, userId);
  if (!member) {
    throw new NotFoundError('Invitation');
  }

  await logAuditEvent({
    userId,
    action: 'organization.invitation_accepted' as AuditAction,
    resource: 'organization_member',
    resourceId: member.id,
    details: { organizationId: org.id },
    status: 'success',
    ...meta,
  });

  return c.json({ member });
});

// ============================================================================
// App Management APIs (admin only)
// ============================================================================

// POST /api/v1/orgs/:slug/apps/:appId/transfer - Transfer app to org (admin only)
orgRoutes.post('/:slug/apps/:appId/transfer', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const appId = c.req.param('appId');
  const currentUserId = c.get('userId');
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    throw new NotFoundError('Organization');
  }

  await requireOrgAdmin(c, org.id);

  const transferred = await transferAppToOrganization(appId, org.id);
  if (!transferred) {
    throw new NotFoundError('App');
  }

  await logAuditEvent({
    userId: currentUserId,
    action: 'app.transferred' as AuditAction,
    resource: 'app',
    resourceId: appId,
    details: { organizationId: org.id, organizationSlug: slug },
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

export { orgRoutes as organizationRoutes };
