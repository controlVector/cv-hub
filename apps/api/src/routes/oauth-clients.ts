import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';

import { db } from '../db';
import { oauthClients, oauthConsents } from '../db/schema';
import { requireAuth } from '../middleware/auth';
import { logAuditEvent } from '../services/audit.service';
import { createOAuthClient } from '../services/oauth.service';
import { hashToken, generateSecureToken } from '../utils/crypto';
import { ValidationError, NotFoundError, AuthenticationError } from '../utils/errors';
import type { AppEnv } from '../app';

const clients = new Hono<AppEnv>();

// All routes require authentication
clients.use('*', requireAuth);

// Helper to get userId from context (throws if not authenticated)
function getUserId(c: { get: (key: 'userId') => string | undefined }): string {
  const userId = c.get('userId');
  if (!userId) throw new AuthenticationError('Not authenticated');
  return userId;
}

// Helper to get request metadata
function getRequestMeta(c: any) {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : undefined,
    userAgent: c.req.header('user-agent'),
  };
}

// ==================== Client CRUD ====================

// GET /oauth/clients - List user's OAuth clients
clients.get('/', async (c) => {
  const userId = getUserId(c);

  const userClients = await db.query.oauthClients.findMany({
    where: eq(oauthClients.ownerId, userId),
    orderBy: (clients, { desc }) => [desc(clients.createdAt)],
  });

  // Return without secret hash
  return c.json({
    clients: userClients.map(client => ({
      id: client.id,
      clientId: client.clientId,
      name: client.name,
      description: client.description,
      logoUrl: client.logoUrl,
      websiteUrl: client.websiteUrl,
      redirectUris: client.redirectUris,
      allowedScopes: client.allowedScopes,
      isConfidential: client.isConfidential,
      requirePkce: client.requirePkce,
      isFirstParty: client.isFirstParty,
      isActive: client.isActive,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    })),
  });
});

// POST /oauth/clients - Create new OAuth client
const createClientSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  websiteUrl: z.string().url().optional(),
  redirectUris: z.array(z.string().url()).min(1).max(10),
  isConfidential: z.boolean().optional().default(true),
  logoUrl: z.string().url().optional(),
  privacyPolicyUrl: z.string().url().optional(),
  termsOfServiceUrl: z.string().url().optional(),
});

clients.post('/', zValidator('json', createClientSchema), async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');
  const meta = getRequestMeta(c);

  const { clientId, clientSecret } = await createOAuthClient({
    name: body.name,
    description: body.description,
    redirectUris: body.redirectUris,
    websiteUrl: body.websiteUrl,
    isConfidential: body.isConfidential,
    ownerId: userId,
  });

  // If there's a logo URL or policy URLs, update them
  if (body.logoUrl || body.privacyPolicyUrl || body.termsOfServiceUrl) {
    await db.update(oauthClients)
      .set({
        logoUrl: body.logoUrl,
        privacyPolicyUrl: body.privacyPolicyUrl,
        termsOfServiceUrl: body.termsOfServiceUrl,
      })
      .where(eq(oauthClients.clientId, clientId));
  }

  await logAuditEvent({
    userId,
    action: 'oauth.client.create',
    resource: 'oauth_client',
    status: 'success',
    details: { name: body.name, clientId },
    ...meta,
  });

  // Return the new client with secret (only shown once!)
  return c.json({
    client: {
      clientId,
      clientSecret,
      name: body.name,
      description: body.description,
      redirectUris: body.redirectUris,
      websiteUrl: body.websiteUrl,
      isConfidential: body.isConfidential,
    },
    message: clientSecret
      ? 'Save your client secret now - it will not be shown again!'
      : undefined,
  }, 201);
});

// GET /oauth/clients/:clientId - Get specific client
clients.get('/:clientId', async (c) => {
  const userId = getUserId(c);
  const clientId = c.req.param('clientId');

  const client = await db.query.oauthClients.findFirst({
    where: and(
      eq(oauthClients.clientId, clientId),
      eq(oauthClients.ownerId, userId),
    ),
  });

  if (!client) {
    throw new NotFoundError('OAuth client not found');
  }

  return c.json({
    client: {
      id: client.id,
      clientId: client.clientId,
      name: client.name,
      description: client.description,
      logoUrl: client.logoUrl,
      websiteUrl: client.websiteUrl,
      privacyPolicyUrl: client.privacyPolicyUrl,
      termsOfServiceUrl: client.termsOfServiceUrl,
      redirectUris: client.redirectUris,
      allowedScopes: client.allowedScopes,
      isConfidential: client.isConfidential,
      requirePkce: client.requirePkce,
      isFirstParty: client.isFirstParty,
      isActive: client.isActive,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    },
  });
});

// PATCH /oauth/clients/:clientId - Update client
const updateClientSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  websiteUrl: z.string().url().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  privacyPolicyUrl: z.string().url().nullable().optional(),
  termsOfServiceUrl: z.string().url().nullable().optional(),
  redirectUris: z.array(z.string().url()).min(1).max(10).optional(),
  isActive: z.boolean().optional(),
});

clients.patch('/:clientId', zValidator('json', updateClientSchema), async (c) => {
  const userId = getUserId(c);
  const clientId = c.req.param('clientId');
  const body = c.req.valid('json');
  const meta = getRequestMeta(c);

  // Check ownership
  const client = await db.query.oauthClients.findFirst({
    where: and(
      eq(oauthClients.clientId, clientId),
      eq(oauthClients.ownerId, userId),
    ),
  });

  if (!client) {
    throw new NotFoundError('OAuth client not found');
  }

  // Build update object
  const updates: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.websiteUrl !== undefined) updates.websiteUrl = body.websiteUrl;
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl;
  if (body.privacyPolicyUrl !== undefined) updates.privacyPolicyUrl = body.privacyPolicyUrl;
  if (body.termsOfServiceUrl !== undefined) updates.termsOfServiceUrl = body.termsOfServiceUrl;
  if (body.redirectUris !== undefined) updates.redirectUris = body.redirectUris;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db.update(oauthClients)
    .set(updates)
    .where(eq(oauthClients.id, client.id));

  await logAuditEvent({
    userId,
    action: 'oauth.client.update',
    resource: 'oauth_client',
    resourceId: client.id,
    status: 'success',
    details: { clientId, updates: Object.keys(body) },
    ...meta,
  });

  // Fetch updated client
  const updatedClient = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.id, client.id),
  });

  return c.json({
    client: {
      id: updatedClient!.id,
      clientId: updatedClient!.clientId,
      name: updatedClient!.name,
      description: updatedClient!.description,
      logoUrl: updatedClient!.logoUrl,
      websiteUrl: updatedClient!.websiteUrl,
      redirectUris: updatedClient!.redirectUris,
      isActive: updatedClient!.isActive,
      updatedAt: updatedClient!.updatedAt,
    },
  });
});

// DELETE /oauth/clients/:clientId - Delete client
clients.delete('/:clientId', async (c) => {
  const userId = getUserId(c);
  const clientId = c.req.param('clientId');
  const meta = getRequestMeta(c);

  const client = await db.query.oauthClients.findFirst({
    where: and(
      eq(oauthClients.clientId, clientId),
      eq(oauthClients.ownerId, userId),
    ),
  });

  if (!client) {
    throw new NotFoundError('OAuth client not found');
  }

  // Delete the client (cascades to tokens, consents, etc.)
  await db.delete(oauthClients)
    .where(eq(oauthClients.id, client.id));

  await logAuditEvent({
    userId,
    action: 'oauth.client.delete',
    resource: 'oauth_client',
    resourceId: client.id,
    status: 'success',
    details: { clientId, name: client.name },
    ...meta,
  });

  return c.json({ success: true });
});

// POST /oauth/clients/:clientId/rotate-secret - Rotate client secret
clients.post('/:clientId/rotate-secret', async (c) => {
  const userId = getUserId(c);
  const clientId = c.req.param('clientId');
  const meta = getRequestMeta(c);

  const client = await db.query.oauthClients.findFirst({
    where: and(
      eq(oauthClients.clientId, clientId),
      eq(oauthClients.ownerId, userId),
    ),
  });

  if (!client) {
    throw new NotFoundError('OAuth client not found');
  }

  if (!client.isConfidential) {
    throw new ValidationError('Public clients do not have secrets');
  }

  // Generate new secret
  const newSecret = generateSecureToken(32);
  const newSecretHash = hashToken(newSecret);

  await db.update(oauthClients)
    .set({
      clientSecretHash: newSecretHash,
      updatedAt: new Date(),
    })
    .where(eq(oauthClients.id, client.id));

  await logAuditEvent({
    userId,
    action: 'oauth.client.secret_rotated',
    resource: 'oauth_client',
    resourceId: client.id,
    status: 'success',
    details: { clientId },
    ...meta,
  });

  return c.json({
    clientSecret: newSecret,
    message: 'Save your new client secret now - it will not be shown again!',
  });
});

// ==================== User's Authorized Apps (Consents) ====================

// GET /oauth/authorizations - List apps user has authorized
clients.get('/authorizations', async (c) => {
  const userId = getUserId(c);

  const consents = await db.query.oauthConsents.findMany({
    where: eq(oauthConsents.userId, userId),
    with: {
      // We'd need to set up relations for this
    },
  });

  // Fetch associated clients
  const clientIds = consents.map(c => c.clientId);
  const clientsList = await db.query.oauthClients.findMany({
    where: (clients, { inArray }) => inArray(clients.id, clientIds),
  });

  const clientMap = new Map(clientsList.map(c => [c.id, c]));

  return c.json({
    authorizations: consents
      .filter(consent => !consent.revokedAt)
      .map(consent => {
        const client = clientMap.get(consent.clientId);
        return {
          id: consent.id,
          clientId: client?.clientId,
          clientName: client?.name,
          clientDescription: client?.description,
          clientLogoUrl: client?.logoUrl,
          clientWebsiteUrl: client?.websiteUrl,
          scopes: consent.scopes,
          grantedAt: consent.grantedAt,
        };
      }),
  });
});

// DELETE /oauth/authorizations/:clientId - Revoke authorization
clients.delete('/authorizations/:clientId', async (c) => {
  const userId = getUserId(c);
  const clientId = c.req.param('clientId');
  const meta = getRequestMeta(c);

  const client = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.clientId, clientId),
  });

  if (!client) {
    throw new NotFoundError('OAuth client not found');
  }

  // Revoke consent (this also revokes tokens in the service)
  await db.update(oauthConsents)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(oauthConsents.clientId, client.id),
      eq(oauthConsents.userId, userId),
    ));

  await logAuditEvent({
    userId,
    action: 'oauth.authorization.revoked',
    resource: 'oauth_client',
    resourceId: client.id,
    status: 'success',
    details: { clientId },
    ...meta,
  });

  return c.json({ success: true });
});

export { clients as oauthClientRoutes };
