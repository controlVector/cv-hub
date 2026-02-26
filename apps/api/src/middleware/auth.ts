import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifyAccessToken } from '../services/token.service';
import { getSessionUser } from '../services/session.service';
import { validateToken } from '../services/pat.service';
import { AuthenticationError } from '../utils/errors';
import { authLogger } from '../utils/logger';

const SESSION_COOKIE_NAME = 'cv_session';

export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);

  // 1. Try PAT (cv_pat_*) first if it has the prefix
  if (token.startsWith('cv_pat_')) {
    const result = await validateToken(token);
    if (!result.valid || !result.userId) {
      throw new AuthenticationError('Invalid or expired personal access token');
    }
    c.set('userId', result.userId);
    c.set('tokenScopes', result.scopes ?? []);
    if (result.organizationId) {
      c.set('patOrgId', result.organizationId);
    }
    await next();
    return;
  }

  // 2. Try JWT
  try {
    const payload = await verifyAccessToken(token);
    c.set('userId', payload.sub);
    c.set('sessionId', payload.sid);
  } catch {
    throw new AuthenticationError('Invalid or expired access token');
  }

  await next();
}

export async function optionalAuth(c: Context, next: Next) {
  // First try Bearer token
  const authHeader = c.req.header('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    // Try PAT first if it has the prefix
    if (token.startsWith('cv_pat_')) {
      const result = await validateToken(token);
      if (result.valid && result.userId) {
        c.set('userId', result.userId);
        c.set('tokenScopes', result.scopes ?? []);
        if (result.organizationId) {
          c.set('patOrgId', result.organizationId);
        }
        await next();
        return;
      }
    } else {
      // Try JWT
      try {
        const payload = await verifyAccessToken(token);
        c.set('userId', payload.sub);
        c.set('sessionId', payload.sid);
        await next();
        return;
      } catch {
        // Ignore invalid tokens, try cookie auth
      }
    }
  }

  // Then try session cookie (for browser requests like OAuth authorize)
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);

  authLogger.debug('Session cookie check', { sessionId: sessionId || 'none' });

  if (sessionId) {
    try {
      const result = await getSessionUser(sessionId);
      authLogger.debug('Session lookup result', { found: !!result });
      if (result) {
        c.set('userId', result.userId);
        c.set('sessionId', sessionId);
      }
    } catch (err) {
      authLogger.debug('Session lookup error', err as Error);
    }
  }

  await next();
}
