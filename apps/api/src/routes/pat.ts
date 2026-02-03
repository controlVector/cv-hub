/**
 * Personal Access Token (PAT) API Routes
 * Manage personal access tokens for API and git authentication
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

import { requireAuth } from '../middleware/auth';
import {
  createToken,
  listTokens,
  getToken,
  revokeToken,
  revokeAllTokens,
  getActiveTokenCount,
} from '../services/pat.service';
import { PAT_SCOPE_INFO } from '../db/schema/personal-access-tokens';
import { ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const patRoutes = new Hono<AppEnv>();

// All routes require authentication
patRoutes.use('*', requireAuth);

// ============================================================================
// Schemas
// ============================================================================

const createTokenSchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.string().datetime().optional(), // ISO 8601 datetime
  expiresInDays: z.number().int().min(1).max(365).optional(), // Alternative: days from now
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/user/tokens - List user's tokens
 */
patRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    throw new ForbiddenError('Authentication required');
  }

  const tokens = await listTokens(userId);

  return c.json({ tokens });
});

/**
 * POST /api/user/tokens - Create a new token
 */
patRoutes.post(
  '/',
  zValidator('json', createTokenSchema),
  async (c) => {
    const userId = c.get('userId');
    if (!userId) {
      throw new ForbiddenError('Authentication required');
    }

    const { name, scopes, expiresAt, expiresInDays } = c.req.valid('json');

    // Calculate expiration date
    let expiration: Date | undefined;
    if (expiresAt) {
      expiration = new Date(expiresAt);
    } else if (expiresInDays) {
      expiration = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    }

    const result = await createToken({
      userId,
      name,
      scopes,
      expiresAt: expiration,
    });

    // Return full token - this is the only time it's shown!
    return c.json({
      token: result.token,
      tokenInfo: result.tokenInfo,
      warning: 'Make sure to copy your token now. You won\'t be able to see it again!',
    }, 201);
  }
);

/**
 * GET /api/user/tokens/:id - Get a single token
 */
patRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const tokenId = c.req.param('id');

  if (!userId) {
    throw new ForbiddenError('Authentication required');
  }

  const token = await getToken(userId, tokenId);

  if (!token) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Token not found' } }, 404);
  }

  return c.json({ token });
});

/**
 * DELETE /api/user/tokens/:id - Revoke a token
 */
patRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const tokenId = c.req.param('id');

  if (!userId) {
    throw new ForbiddenError('Authentication required');
  }

  await revokeToken(userId, tokenId);

  return c.json({ success: true });
});

/**
 * POST /api/user/tokens/revoke-all - Revoke all tokens
 */
patRoutes.post('/revoke-all', async (c) => {
  const userId = c.get('userId');

  if (!userId) {
    throw new ForbiddenError('Authentication required');
  }

  const count = await revokeAllTokens(userId, 'User requested revocation of all tokens');

  return c.json({ success: true, revokedCount: count });
});

/**
 * GET /api/user/tokens/count - Get active token count
 */
patRoutes.get('/stats/count', async (c) => {
  const userId = c.get('userId');

  if (!userId) {
    throw new ForbiddenError('Authentication required');
  }

  const count = await getActiveTokenCount(userId);

  return c.json({ activeTokenCount: count });
});

/**
 * GET /api/user/tokens/scopes - Get available scopes
 */
patRoutes.get('/meta/scopes', async (c) => {
  // This doesn't require auth - it's informational
  return c.json({ scopes: PAT_SCOPE_INFO });
});

export { patRoutes };
