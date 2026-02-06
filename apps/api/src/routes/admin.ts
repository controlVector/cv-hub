import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import { users } from '../db/schema';
import { eq, or } from 'drizzle-orm';
import { ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const admin = new Hono<AppEnv>();

// Middleware to require admin access
async function requireAdmin(c: { get: (key: 'userId') => string | undefined }) {
  const userId = c.get('userId');
  if (!userId) throw new ForbiddenError('Admin access required');

  const [user] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId));

  if (!user?.isAdmin) {
    throw new ForbiddenError('Admin access required');
  }
}

// Get admin status
admin.get('/status', requireAuth, async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ isAdmin: false });

  const [user] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId));

  return c.json({ isAdmin: user?.isAdmin ?? false });
});

// Get errata document
admin.get('/docs/errata', requireAuth, async (c) => {
  await requireAdmin(c);

  try {
    // Try to read from docs folder (development) or bundled location
    const docsPath = join(process.cwd(), 'docs', 'ERRATA.md');
    const content = await readFile(docsPath, 'utf-8');
    return c.json({ content, filename: 'ERRATA.md' });
  } catch {
    // Fallback: return a message if file not found
    return c.json({
      content: '# Errata\n\nDocument not found. Please check the docs/ERRATA.md file.',
      filename: 'ERRATA.md',
    });
  }
});

// Get release notes document
admin.get('/docs/releases', requireAuth, async (c) => {
  await requireAdmin(c);

  try {
    const docsPath = join(process.cwd(), 'docs', 'RELEASES.md');
    const content = await readFile(docsPath, 'utf-8');
    return c.json({ content, filename: 'RELEASES.md' });
  } catch {
    return c.json({
      content: '# Release Notes\n\nDocument not found. Please check the docs/RELEASES.md file.',
      filename: 'RELEASES.md',
    });
  }
});

// List all admin docs
admin.get('/docs', requireAuth, async (c) => {
  await requireAdmin(c);

  return c.json({
    documents: [
      { id: 'errata', name: 'Errata - Known Issues', path: '/admin/docs/errata' },
      { id: 'releases', name: 'Release Notes', path: '/admin/docs/releases' },
    ],
  });
});

// Grant admin access (super-admin only - first admin must be set via DB)
admin.post('/grant', requireAuth, async (c) => {
  await requireAdmin(c);

  const { email, username } = await c.req.json();

  if (!email && !username) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Email or username required' } }, 400);
  }

  const whereClause = email
    ? eq(users.email, email)
    : username
      ? eq(users.username, username)
      : undefined;

  if (!whereClause) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Email or username required' } }, 400);
  }

  const [targetUser] = await db
    .select({ id: users.id, email: users.email, username: users.username, isAdmin: users.isAdmin })
    .from(users)
    .where(whereClause);

  if (!targetUser) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
  }

  if (targetUser.isAdmin) {
    return c.json({ message: 'User is already an admin', user: targetUser });
  }

  await db
    .update(users)
    .set({ isAdmin: true, updatedAt: new Date() })
    .where(eq(users.id, targetUser.id));

  return c.json({
    message: 'Admin access granted',
    user: { ...targetUser, isAdmin: true },
  });
});

// Revoke admin access
admin.post('/revoke', requireAuth, async (c) => {
  await requireAdmin(c);

  const userId = c.get('userId');
  const { email, username } = await c.req.json();

  if (!email && !username) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Email or username required' } }, 400);
  }

  const whereClause = email
    ? eq(users.email, email)
    : username
      ? eq(users.username, username)
      : undefined;

  if (!whereClause) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Email or username required' } }, 400);
  }

  const [targetUser] = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(whereClause);

  if (!targetUser) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
  }

  // Prevent self-revocation
  if (targetUser.id === userId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Cannot revoke your own admin access' } }, 403);
  }

  await db
    .update(users)
    .set({ isAdmin: false, updatedAt: new Date() })
    .where(eq(users.id, targetUser.id));

  return c.json({
    message: 'Admin access revoked',
    user: { ...targetUser, isAdmin: false },
  });
});

// List all admins
admin.get('/users', requireAuth, async (c) => {
  await requireAdmin(c);

  const admins = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.isAdmin, true));

  return c.json({ admins });
});

export default admin;
