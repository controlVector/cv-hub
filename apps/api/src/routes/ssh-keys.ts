/**
 * SSH Keys API Routes
 * Manage user SSH keys for git authentication
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

import { requireAuth } from '../middleware/auth';
import {
  addKey,
  removeKey,
  listKeys,
  getKey,
  validateKeyFormat,
} from '../services/ssh-keys.service';
import { ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const sshKeysRoutes = new Hono<AppEnv>();

// All routes require authentication
sshKeysRoutes.use('*', requireAuth);

// ============================================================================
// Schemas
// ============================================================================

const addKeySchema = z.object({
  title: z.string().min(1).max(255),
  publicKey: z.string().min(50).max(10000), // SSH keys are typically 400-800 chars
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/user/ssh-keys - List user's SSH keys
 */
sshKeysRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    throw new ForbiddenError('Authentication required');
  }

  const keys = await listKeys(userId);

  // Mask the public key for security (only show type and fingerprint)
  const maskedKeys = keys.map((key) => ({
    id: key.id,
    title: key.title,
    keyType: key.keyType,
    fingerprint: key.fingerprint,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt,
    // Show only the key type and comment, not the full key
    publicKeyPreview: getKeyPreview(key.publicKey),
  }));

  return c.json({ keys: maskedKeys });
});

/**
 * POST /api/user/ssh-keys - Add a new SSH key
 */
sshKeysRoutes.post(
  '/',
  zValidator('json', addKeySchema),
  async (c) => {
    const userId = c.get('userId');
    if (!userId) {
      throw new ForbiddenError('Authentication required');
    }

    const { title, publicKey } = c.req.valid('json');

    const key = await addKey(userId, title, publicKey);

    return c.json({
      key: {
        id: key.id,
        title: key.title,
        keyType: key.keyType,
        fingerprint: key.fingerprint,
        createdAt: key.createdAt,
      },
    }, 201);
  }
);

/**
 * GET /api/user/ssh-keys/:id - Get a single SSH key
 */
sshKeysRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const keyId = c.req.param('id');

  if (!userId) {
    throw new ForbiddenError('Authentication required');
  }

  const key = await getKey(keyId);

  if (!key || key.userId !== userId) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'SSH key not found' } }, 404);
  }

  return c.json({
    key: {
      id: key.id,
      title: key.title,
      keyType: key.keyType,
      fingerprint: key.fingerprint,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
      publicKeyPreview: getKeyPreview(key.publicKey),
    },
  });
});

/**
 * DELETE /api/user/ssh-keys/:id - Remove an SSH key
 */
sshKeysRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const keyId = c.req.param('id');

  if (!userId) {
    throw new ForbiddenError('Authentication required');
  }

  await removeKey(userId, keyId);

  return c.json({ success: true });
});

/**
 * POST /api/user/ssh-keys/validate - Validate an SSH key without adding it
 */
sshKeysRoutes.post(
  '/validate',
  zValidator('json', z.object({ publicKey: z.string() })),
  async (c) => {
    const { publicKey } = c.req.valid('json');

    const result = validateKeyFormat(publicKey);

    return c.json({
      valid: result.valid,
      type: result.type,
      fingerprint: result.fingerprint,
      comment: result.comment,
      error: result.error,
    });
  }
);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get a preview of the public key (type + last 20 chars)
 */
function getKeyPreview(publicKey: string): string {
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length >= 2) {
    const [type, data, ...comment] = parts;
    const lastChars = data.slice(-20);
    const commentStr = comment.length > 0 ? ` ${comment.join(' ')}` : '';
    return `${type} ...${lastChars}${commentStr}`;
  }
  return publicKey.slice(0, 50) + '...';
}

export { sshKeysRoutes };
