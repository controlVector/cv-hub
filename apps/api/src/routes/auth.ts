import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';

import {
  loginSchema,
  registerSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  emailVerificationSchema,
} from '@cv-hub/shared';

import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rate-limit';
import { logAuditEvent } from '../services/audit.service';
import {
  createUser,
  authenticateUser,
  getUserById,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
} from '../services/user.service';
import {
  createSession,
  validateRefreshToken,
  rotateRefreshToken,
  revokeSession,
  getUserSessions,
} from '../services/session.service';
import {
  generateAccessToken,
  getAccessTokenExpiry,
} from '../services/token.service';
import * as totpService from '../services/totp.service';
import * as webauthnService from '../services/webauthn.service';
import * as backupCodesService from '../services/backup-codes.service';
import { storeChallenge, consumeChallenge } from '../lib/redis';
import { generateSecureToken } from '../utils/crypto';
import { AuthenticationError } from '../utils/errors';
import { revokeAllUserOAuthTokens } from '../services/oauth.service';
import type { AppEnv } from '../app';

const auth = new Hono<AppEnv>();

// Helper to get userId from context (throws if not authenticated)
function getUserId(c: { get: (key: 'userId') => string | undefined }): string {
  const userId = getUserId(c);
  if (!userId) throw new AuthenticationError('Not authenticated');
  return userId;
}

// Helper to get sessionId from context
function getSessionId(c: { get: (key: 'sessionId') => string | undefined }): string {
  const sessionId = getSessionId(c);
  if (!sessionId) throw new AuthenticationError('No session');
  return sessionId;
}

// Helper to get request metadata
function getRequestMeta(c: any) {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : undefined,
    userAgent: c.req.header('user-agent'),
  };
}

// Cookie config
const REFRESH_COOKIE_NAME = 'cv_refresh';
const SESSION_COOKIE_NAME = 'cv_session';

function setAuthCookies(c: any, sessionId: string, refreshToken: string) {
  const secure = env.NODE_ENV === 'production';
  const maxAge = 7 * 24 * 60 * 60; // 7 days

  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge,
  });

  setCookie(c, REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/api/auth/refresh',
    maxAge,
  });
}

function clearAuthCookies(c: any) {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  deleteCookie(c, REFRESH_COOKIE_NAME, { path: '/api/auth/refresh' });
}

// POST /api/auth/register
auth.post('/register', strictRateLimiter, zValidator('json', registerSchema), async (c) => {
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);

  try {
    const user = await createUser(input);

    // Create session
    const { sessionId, refreshToken } = await createSession({
      userId: user.id,
      ...meta,
    });

    // Generate access token
    const accessToken = await generateAccessToken(user.id, sessionId);

    // Set cookies
    setAuthCookies(c, sessionId, refreshToken);

    // Audit log
    await logAuditEvent({
      userId: user.id,
      action: 'user.register',
      resource: 'user',
      resourceId: user.id,
      status: 'success',
      ...meta,
    });

    return c.json({
      user,
      accessToken,
      expiresIn: getAccessTokenExpiry(),
    }, 201);
  } catch (error) {
    await logAuditEvent({
      action: 'user.register',
      details: { email: input.email },
      status: 'failure',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      ...meta,
    });
    throw error;
  }
});

// POST /api/auth/login
auth.post('/login', strictRateLimiter, zValidator('json', loginSchema), async (c) => {
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);

  try {
    const user = await authenticateUser(input.email, input.password);

    // Check if MFA is required
    if (user.mfaEnabled) {
      // Generate MFA challenge token (temporary, expires in 5 minutes)
      const mfaToken = generateSecureToken(32);
      await storeChallenge(`mfa:login:${mfaToken}`, user.id, 300);

      // Determine available MFA methods
      const hasTOTP = await totpService.hasTOTPEnabled(user.id);
      const hasPasskeys = await webauthnService.hasPasskeys(user.id);
      const hasBackupCodes = await backupCodesService.hasBackupCodes(user.id);

      await logAuditEvent({
        userId: user.id,
        action: 'user.login.mfa_required',
        status: 'success',
        ...meta,
      });

      return c.json({
        mfaRequired: true,
        mfaToken,
        userId: user.id,
        methods: {
          totp: hasTOTP,
          passkey: hasPasskeys,
          backupCode: hasBackupCodes,
        },
      });
    }

    // No MFA - complete login directly
    const { sessionId, refreshToken } = await createSession({
      userId: user.id,
      ...meta,
    });

    const accessToken = await generateAccessToken(user.id, sessionId);
    setAuthCookies(c, sessionId, refreshToken);

    await logAuditEvent({
      userId: user.id,
      action: 'user.login',
      status: 'success',
      ...meta,
    });

    return c.json({
      user,
      accessToken,
      expiresIn: getAccessTokenExpiry(),
    });
  } catch (error) {
    await logAuditEvent({
      action: 'user.login',
      details: { email: input.email },
      status: 'failure',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      ...meta,
    });
    throw error;
  }
});

// POST /api/auth/login/mfa - Complete login after MFA verification
const mfaLoginSchema = z.object({
  mfaToken: z.string(),
  method: z.enum(['totp', 'passkey', 'backupCode']),
  code: z.string().optional(),
  passkeyResponse: z.any().optional(),
});

auth.post('/login/mfa', strictRateLimiter, zValidator('json', mfaLoginSchema), async (c) => {
  const { mfaToken, method, code, passkeyResponse } = c.req.valid('json');
  const meta = getRequestMeta(c);

  // Validate MFA token and get user ID
  const userId = await consumeChallenge(`mfa:login:${mfaToken}`);
  if (!userId) {
    throw new AuthenticationError('Invalid or expired MFA token');
  }

  // Verify based on method
  let verified = false;

  switch (method) {
    case 'totp':
      if (!code) {
        throw new AuthenticationError('TOTP code required');
      }
      verified = await totpService.verifyTOTPCode(userId, code);
      break;

    case 'backupCode':
      if (!code) {
        throw new AuthenticationError('Backup code required');
      }
      verified = await backupCodesService.verifyBackupCode(userId, code);
      break;

    case 'passkey':
      if (!passkeyResponse) {
        throw new AuthenticationError('Passkey response required');
      }
      const result = await webauthnService.verifyPasskeyAuthentication(passkeyResponse, userId);
      verified = result.verified;
      break;

    default:
      throw new AuthenticationError('Invalid MFA method');
  }

  if (!verified) {
    const mfaActionMap = {
      totp: 'user.login.mfa_totp',
      passkey: 'user.login.mfa_passkey',
      backupCode: 'user.login.mfa_backupCode',
    } as const;
    await logAuditEvent({
      userId,
      action: mfaActionMap[method],
      status: 'failure',
      ...meta,
    });
    throw new AuthenticationError('Invalid MFA code');
  }

  // MFA verified - complete login
  const user = await getUserById(userId);
  if (!user) {
    throw new AuthenticationError('User not found');
  }

  const { sessionId, refreshToken } = await createSession({
    userId,
    ...meta,
  });

  const accessToken = await generateAccessToken(userId, sessionId);
  setAuthCookies(c, sessionId, refreshToken);

  await logAuditEvent({
    userId,
    action: 'user.login',
    details: { mfaMethod: method },
    status: 'success',
    ...meta,
  });

  return c.json({
    user,
    accessToken,
    expiresIn: getAccessTokenExpiry(),
  });
});

// POST /api/auth/refresh
auth.post('/refresh', async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  const refreshToken = getCookie(c, REFRESH_COOKIE_NAME);

  if (!sessionId || !refreshToken) {
    throw new AuthenticationError('Missing refresh credentials');
  }

  const result = await validateRefreshToken(sessionId, refreshToken);

  if (!result) {
    clearAuthCookies(c);
    throw new AuthenticationError('Invalid or expired refresh token');
  }

  // Rotate refresh token
  const newRefreshToken = await rotateRefreshToken(sessionId);

  // Generate new access token
  const accessToken = await generateAccessToken(result.userId, sessionId);

  // Update cookies
  setAuthCookies(c, sessionId, newRefreshToken);

  return c.json({
    accessToken,
    expiresIn: getAccessTokenExpiry(),
  });
});

// POST /api/auth/logout
auth.post('/logout', requireAuth, async (c) => {
  const sessionId = getSessionId(c);
  const userId = getUserId(c);
  const meta = getRequestMeta(c);

  if (sessionId) {
    await revokeSession(sessionId);
  }

  // Revoke all OAuth tokens for this user
  const revokedTokens = await revokeAllUserOAuthTokens(userId);

  clearAuthCookies(c);

  await logAuditEvent({
    userId,
    action: 'user.logout',
    status: 'success',
    details: {
      revokedOAuthAccessTokens: revokedTokens.accessTokens,
      revokedOAuthRefreshTokens: revokedTokens.refreshTokens,
    },
    ...meta,
  });

  return c.json({ success: true });
});

// GET /api/auth/me
auth.get('/me', requireAuth, async (c) => {
  const userId = getUserId(c);
  const user = await getUserById(userId);

  if (!user) {
    throw new AuthenticationError('User not found');
  }

  return c.json({ user });
});

// POST /api/auth/verify-email
auth.post('/verify-email', zValidator('json', emailVerificationSchema), async (c) => {
  const { token } = c.req.valid('json');
  const meta = getRequestMeta(c);

  await verifyEmail(token);

  await logAuditEvent({
    action: 'user.email_verify',
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// POST /api/auth/forgot-password
auth.post('/forgot-password', strictRateLimiter, zValidator('json', passwordResetRequestSchema), async (c) => {
  const { email } = c.req.valid('json');
  const meta = getRequestMeta(c);

  await requestPasswordReset(email);

  await logAuditEvent({
    action: 'user.password_reset_request',
    details: { email },
    status: 'success',
    ...meta,
  });

  // Always return success to prevent email enumeration
  return c.json({ success: true });
});

// POST /api/auth/reset-password
auth.post('/reset-password', strictRateLimiter, zValidator('json', passwordResetConfirmSchema), async (c) => {
  const { token, password } = c.req.valid('json');
  const meta = getRequestMeta(c);

  await resetPassword(token, password);

  await logAuditEvent({
    action: 'user.password_reset_complete',
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// GET /api/auth/sessions
auth.get('/sessions', requireAuth, async (c) => {
  const userId = getUserId(c);
  const currentSessionId = getSessionId(c);

  const sessions = await getUserSessions(userId);

  // Mark current session
  const sessionsWithCurrent = sessions.map(s => ({
    ...s,
    isCurrent: s.id === currentSessionId,
  }));

  return c.json({ sessions: sessionsWithCurrent });
});

// DELETE /api/auth/sessions/:sessionId
auth.delete('/sessions/:sessionId', requireAuth, async (c) => {
  const userId = getUserId(c);
  const targetSessionId = c.req.param('sessionId');
  const meta = getRequestMeta(c);

  await revokeSession(targetSessionId);

  await logAuditEvent({
    userId,
    action: 'user.session_revoke',
    details: { revokedSessionId: targetSessionId },
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// DELETE /api/auth/sessions (revoke all except current)
auth.delete('/sessions', requireAuth, async (c) => {
  const userId = getUserId(c);
  const currentSessionId = getSessionId(c);
  const meta = getRequestMeta(c);

  // Get all sessions except current
  const sessions = await getUserSessions(userId);
  for (const session of sessions) {
    if (session.id !== currentSessionId) {
      await revokeSession(session.id);
    }
  }

  // Also revoke all OAuth tokens for this user
  const revokedTokens = await revokeAllUserOAuthTokens(userId);

  await logAuditEvent({
    userId,
    action: 'user.sessions_revoke_all',
    status: 'success',
    details: {
      revokedSessions: sessions.length - 1, // Exclude current
      revokedOAuthAccessTokens: revokedTokens.accessTokens,
      revokedOAuthRefreshTokens: revokedTokens.refreshTokens,
    },
    ...meta,
  });

  return c.json({ success: true });
});

export { auth as authRoutes };
