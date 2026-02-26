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
  createInvite,
  listPendingInvites,
  cancelInvite,
  acceptInviteByToken,
  getInviteByToken,
} from '../services/organization.service';
import { listApps } from '../services/app-store.service';
import { logAuditEvent, type AuditAction } from '../services/audit.service';
import { NotFoundError, ForbiddenError, TierLimitError } from '../utils/errors';
import { checkOrgMemberLimit } from '../services/tier-limits.service';
import { encryptApiKey } from '../services/embedding.service';
import { getOrgCreditBalance } from '../services/credit.service';
import { db } from '../db';
import { organizationEmbeddingConfig } from '../db/schema';
import { eq } from 'drizzle-orm';
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

// POST /api/v1/orgs/invites/accept/:token - Accept invite by token
orgRoutes.post('/invites/accept/:token', requireAuth, async (c) => {
  const token = c.req.param('token');
  const userId = c.get('userId')!;
  const meta = getRequestMeta(c);

  // Get user email for verification
  const { getUserById } = await import('../services/user.service');
  const user = await getUserById(userId);
  if (!user) throw new NotFoundError('User');

  const member = await acceptInviteByToken(token, userId, user.email);

  await logAuditEvent({
    userId,
    action: 'organization.invitation_accepted' as AuditAction,
    resource: 'organization_member',
    resourceId: member.id,
    details: { organizationId: member.organizationId },
    status: 'success',
    ...meta,
  });

  return c.json({ member });
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

  // Enforce tier limits
  const memberCheck = await checkOrgMemberLimit(org.id);
  if (!memberCheck.allowed) {
    throw new TierLimitError('members', memberCheck.current, memberCheck.limit, memberCheck.tierName);
  }

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
// Invite Management APIs (admin only)
// ============================================================================

// POST /api/v1/orgs/:slug/invites - Create email invite
const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).optional(),
});

orgRoutes.post('/:slug/invites', requireAuth, zValidator('json', createInviteSchema), async (c) => {
  const slug = c.req.param('slug');
  const currentUserId = c.get('userId')!;
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) throw new NotFoundError('Organization');

  await requireOrgAdmin(c, org.id);

  // Enforce tier limits
  const memberCheck = await checkOrgMemberLimit(org.id);
  if (!memberCheck.allowed) {
    throw new TierLimitError('members', memberCheck.current, memberCheck.limit, memberCheck.tierName);
  }

  const invite = await createInvite(org.id, input.email, input.role || 'member', currentUserId);

  await logAuditEvent({
    userId: currentUserId,
    action: 'organization.invite_created' as AuditAction,
    resource: 'org_invite',
    resourceId: invite.id,
    details: { organizationId: org.id, email: input.email, role: input.role || 'member' },
    status: 'success',
    ...meta,
  });

  return c.json({ invite }, 201);
});

// GET /api/v1/orgs/:slug/invites - List pending invites
orgRoutes.get('/:slug/invites', requireAuth, async (c) => {
  const slug = c.req.param('slug');

  const org = await getOrganizationBySlug(slug);
  if (!org) throw new NotFoundError('Organization');

  await requireOrgAdmin(c, org.id);

  const invites = await listPendingInvites(org.id);

  return c.json({ invites });
});

// DELETE /api/v1/orgs/:slug/invites/:inviteId - Cancel invite
orgRoutes.delete('/:slug/invites/:inviteId', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const inviteId = c.req.param('inviteId');
  const currentUserId = c.get('userId');
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) throw new NotFoundError('Organization');

  await requireOrgAdmin(c, org.id);

  const cancelled = await cancelInvite(org.id, inviteId);
  if (!cancelled) throw new NotFoundError('Invite');

  await logAuditEvent({
    userId: currentUserId,
    action: 'organization.invite_cancelled' as AuditAction,
    resource: 'org_invite',
    resourceId: inviteId,
    details: { organizationId: org.id },
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
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

// ============================================================================
// Embedding Config APIs (admin only)
// ============================================================================

// GET /api/v1/orgs/:slug/embedding-config
orgRoutes.get('/:slug/embedding-config', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId')!;

  const org = await getOrganizationBySlug(slug);
  if (!org) throw new NotFoundError('Organization');

  // Must be a member to view
  const role = await getUserOrgRole(org.id, userId);
  if (!role) throw new ForbiddenError('Member access required');

  const config = await db.query.organizationEmbeddingConfig.findFirst({
    where: eq(organizationEmbeddingConfig.organizationId, org.id),
  });

  const credits = await getOrgCreditBalance(org.id);

  return c.json({
    provider: config?.apiKeyProvider || null,
    model: config?.embeddingModel || null,
    hasKey: !!config?.apiKeyEncrypted,
    enabled: config?.enabled ?? true,
    semanticSearchEnabled: config?.semanticSearchEnabled ?? true,
    aiAssistantEnabled: config?.aiAssistantEnabled ?? true,
    credits,
  });
});

// PUT /api/v1/orgs/:slug/embedding-config
const updateEmbeddingConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  provider: z.enum(['openrouter', 'openai', 'anthropic']).optional(),
  model: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
  semanticSearchEnabled: z.boolean().optional(),
  aiAssistantEnabled: z.boolean().optional(),
});

orgRoutes.put(
  '/:slug/embedding-config',
  requireAuth,
  zValidator('json', updateEmbeddingConfigSchema),
  async (c) => {
    const slug = c.req.param('slug');
    const input = c.req.valid('json');
    const meta = getRequestMeta(c);

    const org = await getOrganizationBySlug(slug);
    if (!org) throw new NotFoundError('Organization');

    await requireOrgAdmin(c, org.id);

    const existing = await db.query.organizationEmbeddingConfig.findFirst({
      where: eq(organizationEmbeddingConfig.organizationId, org.id),
    });

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };
    if (input.apiKey) updateData.apiKeyEncrypted = encryptApiKey(input.apiKey);
    if (input.provider !== undefined) updateData.apiKeyProvider = input.provider;
    if (input.model !== undefined) updateData.embeddingModel = input.model;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;
    if (input.semanticSearchEnabled !== undefined) updateData.semanticSearchEnabled = input.semanticSearchEnabled;
    if (input.aiAssistantEnabled !== undefined) updateData.aiAssistantEnabled = input.aiAssistantEnabled;

    if (existing) {
      await db
        .update(organizationEmbeddingConfig)
        .set(updateData)
        .where(eq(organizationEmbeddingConfig.id, existing.id));
    } else {
      await db.insert(organizationEmbeddingConfig).values({
        organizationId: org.id,
        ...updateData,
      });
    }

    await logAuditEvent({
      userId: c.get('userId'),
      action: 'organization.updated' as AuditAction,
      resource: 'organization',
      resourceId: org.id,
      details: { field: 'embedding_config', provider: input.provider },
      status: 'success',
      ...meta,
    });

    return c.json({ success: true });
  }
);

// DELETE /api/v1/orgs/:slug/embedding-config
orgRoutes.delete('/:slug/embedding-config', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const meta = getRequestMeta(c);

  const org = await getOrganizationBySlug(slug);
  if (!org) throw new NotFoundError('Organization');

  await requireOrgAdmin(c, org.id);

  await db
    .delete(organizationEmbeddingConfig)
    .where(eq(organizationEmbeddingConfig.organizationId, org.id));

  await logAuditEvent({
    userId: c.get('userId'),
    action: 'organization.updated' as AuditAction,
    resource: 'organization',
    resourceId: org.id,
    details: { field: 'embedding_config', action: 'removed' },
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

export { orgRoutes as organizationRoutes };
