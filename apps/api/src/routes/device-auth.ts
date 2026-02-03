import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rate-limit';
import { logAuditEvent } from '../services/audit.service';
import {
  createDeviceAuthorization,
  getDeviceAuthByUserCode,
  verifyUserCode,
  CV_HUB_SCOPES,
  DEFAULT_CLI_SCOPES,
} from '../services/device-auth.service';

import type { AppEnv } from '../app';

const deviceAuth = new Hono<AppEnv>();

// Helper to get request metadata
function getRequestMeta(c: any) {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : undefined,
    userAgent: c.req.header('user-agent'),
  };
}

// ==================== Device Authorization Endpoint ====================
// RFC 8628 Section 3.1 - Device Authorization Request

const deviceAuthorizeSchema = z.object({
  client_id: z.string().min(1),
  scope: z.string().optional(),
});

/**
 * POST /oauth/device/authorize
 * Initiate device authorization flow
 * Called by CLI/device to get device_code and user_code
 */
deviceAuth.post(
  '/authorize',
  strictRateLimiter,
  zValidator('form', deviceAuthorizeSchema),
  async (c) => {
    const body = c.req.valid('form');
    const meta = getRequestMeta(c);

    // Parse requested scopes
    const requestedScopes = body.scope
      ? body.scope.split(' ').filter(Boolean)
      : DEFAULT_CLI_SCOPES;

    const result = await createDeviceAuthorization(body.client_id, requestedScopes);

    // Log the attempt
    await logAuditEvent({
      action: 'oauth.device.authorize',
      status: 'error' in result ? 'failure' : 'success',
      details: {
        clientId: body.client_id,
        scopes: requestedScopes,
        error: 'error' in result ? result.error : undefined,
      },
      ...meta,
    });

    // Return error response
    if ('error' in result) {
      return c.json(result, 400);
    }

    // Return success response per RFC 8628
    return c.json(result);
  }
);

// ==================== User Verification Endpoint ====================
// RFC 8628 Section 3.3 - User Interaction

const verifySchema = z.object({
  user_code: z.string().min(8).max(9),  // XXXX-XXXX (8-9 chars with optional dash)
  action: z.enum(['approve', 'deny']),
  scopes: z.array(z.string()).optional(),  // Optional scope selection
});

/**
 * POST /oauth/device/verify
 * User approves or denies the device authorization
 * Requires authentication
 */
deviceAuth.post(
  '/verify',
  requireAuth,
  zValidator('json', verifySchema),
  async (c) => {
    const body = c.req.valid('json');
    const userId = c.get('userId')!;
    const meta = getRequestMeta(c);

    const result = await verifyUserCode(
      body.user_code,
      userId,
      body.action,
      body.scopes,
    );

    // Log the verification
    await logAuditEvent({
      userId,
      action: `oauth.device.${body.action}`,
      status: result.success ? 'success' : 'failure',
      details: {
        userCode: body.user_code.substring(0, 4) + '****',  // Partial code for privacy
        error: result.error,
        scopes: body.scopes,
      },
      ...meta,
    });

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({
      success: true,
      message: body.action === 'approve'
        ? `Authorization granted to ${result.clientName || 'the application'}`
        : 'Authorization denied',
      scopes: result.scopes,
    });
  }
);

// ==================== Status Endpoint ====================
// For the verification page to check code status

const statusQuerySchema = z.object({
  code: z.string().min(8).max(9),
});

/**
 * GET /oauth/device/status
 * Check device authorization status by user code
 * Used by verification page to display client info and requested scopes
 */
deviceAuth.get(
  '/status',
  zValidator('query', statusQuerySchema),
  async (c) => {
    const { code } = c.req.valid('query');

    const result = await getDeviceAuthByUserCode(code);

    if (!result.found) {
      return c.json({
        error: 'not_found',
        error_description: 'Invalid or expired code',
      }, 404);
    }

    if (result.expired) {
      return c.json({
        error: 'expired',
        error_description: 'This code has expired',
      }, 410);
    }

    if (result.status !== 'pending') {
      return c.json({
        error: 'already_processed',
        error_description: `This code has already been ${result.status}`,
      }, 409);
    }

    // Return client info and scopes for the verification page
    return c.json({
      client_name: result.clientName,
      client_id: result.clientId,
      scopes: result.scopes,
      scope_descriptions: result.scopes?.reduce((acc, scope) => {
        if (scope in CV_HUB_SCOPES) {
          acc[scope] = CV_HUB_SCOPES[scope as keyof typeof CV_HUB_SCOPES];
        }
        return acc;
      }, {} as Record<string, string>),
    });
  }
);

// ==================== Scopes Info Endpoint ====================

/**
 * GET /oauth/device/scopes
 * Get available CV-Hub scopes and their descriptions
 */
deviceAuth.get('/scopes', (c) => {
  return c.json({
    scopes: CV_HUB_SCOPES,
    default_scopes: DEFAULT_CLI_SCOPES,
  });
});

export { deviceAuth as deviceAuthRoutes };
