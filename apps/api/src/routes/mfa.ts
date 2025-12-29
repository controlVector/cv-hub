import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rate-limit';
import * as totpService from '../services/totp.service';
import * as backupCodesService from '../services/backup-codes.service';
import * as webauthnService from '../services/webauthn.service';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { users, mfaMethods } from '../db/schema';
import { logAuditEvent } from '../services/audit.service';
import type { AppEnv } from '../app';
import { AuthenticationError } from '../utils/errors';

const mfa = new Hono<AppEnv>();

// Helper to get userId from context (throws if not authenticated)
function getUserId(c: { get: (key: 'userId') => string | undefined }): string {
  const userId = getUserId(c);
  if (!userId) throw new AuthenticationError('Not authenticated');
  return userId;
}

// ==================== MFA Status ====================

// Get MFA status and methods
mfa.get('/status', requireAuth, async (c) => {
  const userId = getUserId(c);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { mfaEnabled: true },
  });

  const methods = await db.query.mfaMethods.findMany({
    where: eq(mfaMethods.userId, userId),
  });

  const totpEnabled = await totpService.hasTOTPEnabled(userId);
  const passkeysEnabled = await webauthnService.hasPasskeys(userId);
  const backupCodesRemaining = await backupCodesService.getRemainingCodesCount(userId);

  return c.json({
    mfaEnabled: user?.mfaEnabled ?? false,
    methods: methods.map((m) => ({
      type: m.type,
      enabled: m.enabled,
      primary: m.primary,
      lastUsedAt: m.lastUsedAt,
    })),
    totp: {
      enabled: totpEnabled,
    },
    passkeys: {
      enabled: passkeysEnabled,
      count: passkeysEnabled ? (await webauthnService.listPasskeys(userId)).length : 0,
    },
    backupCodes: {
      remaining: backupCodesRemaining,
    },
  });
});

// ==================== TOTP Setup ====================

const verifyCodeSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, 'Code must be 6 digits'),
});

// Initialize TOTP setup
mfa.post('/totp/setup', requireAuth, async (c) => {
  const userId = getUserId(c);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true },
  });

  if (!user) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
  }

  const result = await totpService.initializeTOTPSetup(userId, user.email);

  await logAuditEvent({
    userId,
    action: 'mfa.totp.setup_initiated',
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown',
    userAgent: c.req.header('user-agent'),
    status: 'success',
  });

  return c.json({
    secret: result.secret,
    qrCode: result.qrCodeDataUrl,
    backupUri: result.backupUri,
  });
});

// Verify TOTP setup with first code
mfa.post('/totp/verify', requireAuth, zValidator('json', verifyCodeSchema), async (c) => {
  const userId = getUserId(c);
  const { code } = c.req.valid('json');

  const verified = await totpService.verifyTOTPSetup(userId, code);

  await logAuditEvent({
    userId,
    action: 'mfa.totp.setup_completed',
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown',
    userAgent: c.req.header('user-agent'),
    status: verified ? 'success' : 'failure',
  });

  if (!verified) {
    return c.json({ error: { code: 'INVALID_CODE', message: 'Invalid verification code' } }, 400);
  }

  // Generate backup codes automatically when TOTP is enabled
  const backupCodes = await backupCodesService.generateBackupCodes(userId);

  return c.json({
    success: true,
    message: 'TOTP enabled successfully',
    backupCodes: backupCodes.codes,
  });
});

// Disable TOTP
mfa.delete('/totp', requireAuth, async (c) => {
  const userId = getUserId(c);

  await totpService.disableTOTP(userId);

  await logAuditEvent({
    userId,
    action: 'mfa.totp.disabled',
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown',
    userAgent: c.req.header('user-agent'),
    status: 'success',
  });

  return c.json({ success: true, message: 'TOTP disabled' });
});

// ==================== WebAuthn/Passkeys ====================

const deviceNameSchema = z.object({
  deviceName: z.string().max(100).optional(),
});

// Generate passkey registration options
mfa.post('/passkeys/register/options', requireAuth, async (c) => {
  const userId = getUserId(c);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { username: true, displayName: true },
  });

  if (!user) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
  }

  const options = await webauthnService.generatePasskeyRegistration(
    userId,
    user.username,
    user.displayName || user.username,
  );

  return c.json(options);
});

// Verify passkey registration
mfa.post(
  '/passkeys/register/verify',
  requireAuth,
  zValidator('json', z.object({
    response: z.any(),  // WebAuthn response object
    deviceName: z.string().max(100).optional(),
  })),
  async (c) => {
    const userId = getUserId(c);
    const { response, deviceName } = c.req.valid('json');

    const result = await webauthnService.verifyPasskeyRegistration(userId, response, deviceName);

    await logAuditEvent({
      userId,
      action: 'mfa.passkey.registered',
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown',
      userAgent: c.req.header('user-agent'),
      status: result.verified ? 'success' : 'failure',
      details: { deviceName },
    });

    if (!result.verified) {
      return c.json({ error: { code: 'VERIFICATION_FAILED', message: 'Passkey registration failed' } }, 400);
    }

    return c.json({
      success: true,
      credentialId: result.credentialId,
    });
  },
);

// List passkeys
mfa.get('/passkeys', requireAuth, async (c) => {
  const userId = getUserId(c);
  const passkeys = await webauthnService.listPasskeys(userId);
  return c.json({ passkeys });
});

// Delete a passkey
mfa.delete('/passkeys/:id', requireAuth, async (c) => {
  const userId = getUserId(c);
  const credentialId = c.req.param('id');

  const deleted = await webauthnService.deletePasskey(userId, credentialId);

  await logAuditEvent({
    userId,
    action: 'mfa.passkey.deleted',
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown',
    userAgent: c.req.header('user-agent'),
    status: deleted ? 'success' : 'failure',
    details: { credentialId },
  });

  if (!deleted) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Passkey not found' } }, 404);
  }

  return c.json({ success: true });
});

// ==================== Backup Codes ====================

// Generate new backup codes
mfa.post('/backup-codes/generate', requireAuth, async (c) => {
  const userId = getUserId(c);

  // Check if user has another MFA method enabled
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { mfaEnabled: true },
  });

  if (!user?.mfaEnabled) {
    return c.json({
      error: { code: 'MFA_NOT_ENABLED', message: 'Enable another MFA method first (TOTP or Passkey)' },
    }, 400);
  }

  const result = await backupCodesService.generateBackupCodes(userId);

  await logAuditEvent({
    userId,
    action: 'mfa.backup_codes.regenerated',
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown',
    userAgent: c.req.header('user-agent'),
    status: 'success',
  });

  return c.json({
    codes: result.codes,
    message: 'Save these codes securely. Each code can only be used once.',
  });
});

// Get remaining backup codes count
mfa.get('/backup-codes/status', requireAuth, async (c) => {
  const userId = getUserId(c);
  const remaining = await backupCodesService.getRemainingCodesCount(userId);

  return c.json({ remaining });
});

// ==================== MFA Verification (for login) ====================

// Verify TOTP code during login
mfa.post(
  '/verify/totp',
  strictRateLimiter,
  zValidator('json', z.object({
    userId: z.string().uuid(),
    code: z.string().length(6).regex(/^\d{6}$/),
  })),
  async (c) => {
    const { userId, code } = c.req.valid('json');

    const verified = await totpService.verifyTOTPCode(userId, code);

    await logAuditEvent({
      userId,
      action: 'mfa.totp.verified',
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown',
      userAgent: c.req.header('user-agent'),
      status: verified ? 'success' : 'failure',
    });

    if (!verified) {
      return c.json({ error: { code: 'INVALID_CODE', message: 'Invalid code' } }, 401);
    }

    return c.json({ verified: true });
  },
);

// Verify backup code during login
mfa.post(
  '/verify/backup-code',
  strictRateLimiter,
  zValidator('json', z.object({
    userId: z.string().uuid(),
    code: z.string(),
  })),
  async (c) => {
    const { userId, code } = c.req.valid('json');

    const verified = await backupCodesService.verifyBackupCode(userId, code);

    await logAuditEvent({
      userId,
      action: 'mfa.backup_code.used',
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown',
      userAgent: c.req.header('user-agent'),
      status: verified ? 'success' : 'failure',
    });

    if (!verified) {
      return c.json({ error: { code: 'INVALID_CODE', message: 'Invalid backup code' } }, 401);
    }

    // Check remaining codes
    const remaining = await backupCodesService.getRemainingCodesCount(userId);

    return c.json({
      verified: true,
      remainingCodes: remaining,
      warning: remaining <= 3 ? 'You have few backup codes remaining. Consider generating new ones.' : undefined,
    });
  },
);

// Generate passkey authentication options
mfa.post(
  '/verify/passkey/options',
  zValidator('json', z.object({
    userId: z.string().uuid().optional(),
  })),
  async (c) => {
    const { userId } = c.req.valid('json');
    const options = await webauthnService.generatePasskeyAuthentication(userId);
    return c.json(options);
  },
);

// Verify passkey authentication
mfa.post(
  '/verify/passkey',
  strictRateLimiter,
  zValidator('json', z.object({
    userId: z.string().uuid().optional(),
    response: z.any(),
  })),
  async (c) => {
    const { userId, response } = c.req.valid('json');

    const result = await webauthnService.verifyPasskeyAuthentication(response, userId);

    if (result.userId) {
      await logAuditEvent({
        userId: result.userId,
        action: 'mfa.passkey.verified',
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown',
        userAgent: c.req.header('user-agent'),
        status: result.verified ? 'success' : 'failure',
      });
    }

    if (!result.verified) {
      return c.json({ error: { code: 'VERIFICATION_FAILED', message: 'Passkey verification failed' } }, 401);
    }

    return c.json({
      verified: true,
      userId: result.userId,
    });
  },
);

export default mfa;
