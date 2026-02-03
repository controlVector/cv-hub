import { randomBytes, createHash } from 'crypto';
import { eq, and, gt, isNull } from 'drizzle-orm';

import { db } from '../db';
import { oauthClients, oauthAccessTokens, oauthRefreshTokens, users } from '../db/schema';
import { env } from '../config/env';
import { hashToken, generateSecureToken } from '../utils/crypto';
import {
  storeDeviceAuth,
  getDeviceAuth,
  updateDeviceAuth,
  deleteDeviceAuth,
  storeUserCodeMapping,
  getDeviceCodeByUserCode,
  deleteUserCodeMapping,
  type DeviceAuthData,
} from '../lib/redis';
import { oauthLogger } from '../utils/logger';

// ==================== Constants ====================

const DEVICE_CODE_EXPIRY_SECONDS = 900;  // 15 minutes
const MIN_POLLING_INTERVAL = 5;           // 5 seconds minimum between polls
const ACCESS_TOKEN_EXPIRY = 60 * 60 * 1000;   // 1 hour
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

// Characters for user codes: consonants (no ambiguous) + digits (no 0, 1)
// Avoids: I, L, O, 0, 1 which look similar
const USER_CODE_CHARS = 'BCDFGHJKMNPQRSTVWXYZ23456789';

// CV-Hub scopes for Git operations
export const CV_HUB_SCOPES = {
  'repo:read': 'Clone and fetch repositories',
  'repo:write': 'Push to repositories',
  'repo:admin': 'Manage repository settings',
  'profile': 'Read user profile',
  'email': 'Read user email',
  'offline_access': 'Stay logged in (refresh token)',
  'openid': 'OpenID Connect identifier',
} as const;

export const DEFAULT_CLI_SCOPES = ['repo:read', 'repo:write', 'profile', 'offline_access'];

// ==================== Types ====================

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export type DeviceTokenError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant'
  | 'invalid_client';

export interface DeviceTokenErrorResponse {
  error: DeviceTokenError;
  error_description: string;
}

export interface VerifyUserCodeResult {
  success: boolean;
  error?: string;
  clientName?: string;
  scopes?: string[];
  deviceCode?: string;
}

// ==================== User Code Generation ====================

/**
 * Generate a user-friendly code in format XXXX-XXXX
 * Uses consonants + digits (no ambiguous chars) for ~25 bits entropy
 */
function generateUserCode(): string {
  const bytes = randomBytes(8);
  let code = '';

  for (let i = 0; i < 8; i++) {
    const index = bytes[i] % USER_CODE_CHARS.length;
    code += USER_CODE_CHARS[index];
    if (i === 3) code += '-';  // Add dash in middle
  }

  return code;
}

/**
 * Hash user code for storage lookup (normalize to uppercase, remove dash)
 */
function hashUserCode(userCode: string): string {
  const normalized = userCode.toUpperCase().replace(/-/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

// ==================== Device Authorization Flow ====================

/**
 * Initiate device authorization flow (RFC 8628 Section 3.1)
 * Called by device/CLI to get device_code and user_code
 */
export async function createDeviceAuthorization(
  clientId: string,
  requestedScopes: string[],
): Promise<DeviceAuthorizationResponse | { error: string; error_description: string }> {
  // Validate client exists and is active
  const client = await db.query.oauthClients.findFirst({
    where: and(
      eq(oauthClients.clientId, clientId),
      eq(oauthClients.isActive, true),
    ),
  });

  if (!client) {
    return {
      error: 'invalid_client',
      error_description: 'Unknown or inactive client',
    };
  }

  // Check client supports device_code grant
  if (!client.allowedGrantTypes.includes('urn:ietf:params:oauth:grant-type:device_code')) {
    return {
      error: 'unauthorized_client',
      error_description: 'Client not authorized for device authorization grant',
    };
  }

  // Validate scopes (filter to allowed scopes)
  const validScopes = requestedScopes.filter(
    scope => client.allowedScopes.includes(scope) && scope in CV_HUB_SCOPES
  );

  if (requestedScopes.length > 0 && validScopes.length === 0) {
    return {
      error: 'invalid_scope',
      error_description: 'None of the requested scopes are allowed',
    };
  }

  // Use default scopes if none requested
  const scopes = validScopes.length > 0 ? validScopes : DEFAULT_CLI_SCOPES.filter(
    s => client.allowedScopes.includes(s)
  );

  // Generate codes
  const deviceCode = generateSecureToken(32);  // 256-bit device code
  const userCode = generateUserCode();          // User-friendly code

  // Build verification URIs
  const verificationUri = `${env.APP_URL}/device`;
  const verificationUriComplete = `${env.APP_URL}/device?code=${encodeURIComponent(userCode)}`;

  const expiresAt = Date.now() + (DEVICE_CODE_EXPIRY_SECONDS * 1000);

  // Store device auth data in Redis
  const deviceAuthData: DeviceAuthData = {
    deviceCode,
    userCode,
    clientId,
    scopes,
    verificationUri,
    verificationUriComplete,
    expiresAt,
    interval: MIN_POLLING_INTERVAL,
    status: 'pending',
  };

  await storeDeviceAuth(deviceCode, deviceAuthData, DEVICE_CODE_EXPIRY_SECONDS);

  // Store user code -> device code mapping
  const userCodeHash = hashUserCode(userCode);
  await storeUserCodeMapping(userCodeHash, deviceCode, DEVICE_CODE_EXPIRY_SECONDS);

  oauthLogger.debug('Device authorization created', {
    clientId,
    userCode,
    scopes,
    expiresIn: DEVICE_CODE_EXPIRY_SECONDS,
  });

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: DEVICE_CODE_EXPIRY_SECONDS,
    interval: MIN_POLLING_INTERVAL,
  };
}

/**
 * Get device authorization status by user code (for verification page)
 * Returns client info and requested scopes
 */
export async function getDeviceAuthByUserCode(userCode: string): Promise<{
  found: boolean;
  clientName?: string;
  clientId?: string;
  scopes?: string[];
  status?: string;
  expired?: boolean;
}> {
  const userCodeHash = hashUserCode(userCode);
  const deviceCode = await getDeviceCodeByUserCode(userCodeHash);

  if (!deviceCode) {
    return { found: false };
  }

  const deviceAuth = await getDeviceAuth(deviceCode);
  if (!deviceAuth) {
    return { found: false };
  }

  // Check if expired
  if (Date.now() > deviceAuth.expiresAt) {
    return { found: true, expired: true, status: 'expired' };
  }

  // Get client info
  const client = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.clientId, deviceAuth.clientId),
  });

  return {
    found: true,
    clientName: client?.name || 'Unknown Application',
    clientId: deviceAuth.clientId,
    scopes: deviceAuth.scopes,
    status: deviceAuth.status,
    expired: false,
  };
}

/**
 * User verifies/approves the device authorization (RFC 8628 Section 3.3)
 * Called when user enters code and approves/denies
 */
export async function verifyUserCode(
  userCode: string,
  userId: string,
  action: 'approve' | 'deny',
  approvedScopes?: string[],
): Promise<VerifyUserCodeResult> {
  const userCodeHash = hashUserCode(userCode);
  const deviceCode = await getDeviceCodeByUserCode(userCodeHash);

  if (!deviceCode) {
    return {
      success: false,
      error: 'Invalid or expired user code',
    };
  }

  const deviceAuth = await getDeviceAuth(deviceCode);
  if (!deviceAuth) {
    return {
      success: false,
      error: 'Invalid or expired user code',
    };
  }

  // Check if expired
  if (Date.now() > deviceAuth.expiresAt) {
    await deleteDeviceAuth(deviceCode);
    await deleteUserCodeMapping(userCodeHash);
    return {
      success: false,
      error: 'User code has expired',
    };
  }

  // Check if already processed
  if (deviceAuth.status !== 'pending') {
    return {
      success: false,
      error: `Authorization already ${deviceAuth.status}`,
    };
  }

  // Update device auth status
  if (action === 'deny') {
    await updateDeviceAuth(deviceCode, {
      status: 'denied',
      userId,
    });

    oauthLogger.debug('Device authorization denied', {
      clientId: deviceAuth.clientId,
      userId,
    });

    return {
      success: true,
      deviceCode,
    };
  }

  // User approved - validate and set approved scopes
  const finalScopes = approvedScopes && approvedScopes.length > 0
    ? approvedScopes.filter(s => deviceAuth.scopes.includes(s))
    : deviceAuth.scopes;

  await updateDeviceAuth(deviceCode, {
    status: 'approved',
    userId,
    approvedScopes: finalScopes,
  });

  // Get client name for response
  const client = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.clientId, deviceAuth.clientId),
  });

  oauthLogger.debug('Device authorization approved', {
    clientId: deviceAuth.clientId,
    userId,
    scopes: finalScopes,
  });

  return {
    success: true,
    clientName: client?.name,
    scopes: finalScopes,
    deviceCode,
  };
}

/**
 * Exchange device code for tokens (RFC 8628 Section 3.4)
 * Called by device/CLI polling the token endpoint
 */
export async function exchangeDeviceCode(
  deviceCode: string,
  clientId: string,
): Promise<DeviceTokenResponse | DeviceTokenErrorResponse> {
  // Get device auth data
  const deviceAuth = await getDeviceAuth(deviceCode);

  if (!deviceAuth) {
    return {
      error: 'invalid_grant',
      error_description: 'Invalid or expired device code',
    };
  }

  // Verify client matches
  if (deviceAuth.clientId !== clientId) {
    return {
      error: 'invalid_client',
      error_description: 'Client mismatch',
    };
  }

  // Check if expired
  if (Date.now() > deviceAuth.expiresAt) {
    await deleteDeviceAuth(deviceCode);
    const userCodeHash = hashUserCode(deviceAuth.userCode);
    await deleteUserCodeMapping(userCodeHash);

    return {
      error: 'expired_token',
      error_description: 'Device code has expired',
    };
  }

  // Check polling interval (slow_down if too fast)
  const now = Date.now();
  if (deviceAuth.lastPolledAt) {
    const timeSinceLastPoll = (now - deviceAuth.lastPolledAt) / 1000;
    if (timeSinceLastPoll < deviceAuth.interval) {
      // Increase interval by 5 seconds as per RFC 8628
      await updateDeviceAuth(deviceCode, {
        lastPolledAt: now,
        interval: deviceAuth.interval + 5,
      });

      return {
        error: 'slow_down',
        error_description: 'Polling too frequently',
      };
    }
  }

  // Update last polled time
  await updateDeviceAuth(deviceCode, { lastPolledAt: now });

  // Check status
  switch (deviceAuth.status) {
    case 'pending':
      return {
        error: 'authorization_pending',
        error_description: 'Waiting for user authorization',
      };

    case 'denied':
      // Clean up
      await deleteDeviceAuth(deviceCode);
      const userCodeHashDenied = hashUserCode(deviceAuth.userCode);
      await deleteUserCodeMapping(userCodeHashDenied);

      return {
        error: 'access_denied',
        error_description: 'User denied authorization',
      };

    case 'expired':
      await deleteDeviceAuth(deviceCode);
      const userCodeHashExpired = hashUserCode(deviceAuth.userCode);
      await deleteUserCodeMapping(userCodeHashExpired);

      return {
        error: 'expired_token',
        error_description: 'Device code has expired',
      };

    case 'approved':
      // Generate tokens!
      break;
  }

  // User approved - generate tokens
  if (!deviceAuth.userId || !deviceAuth.approvedScopes) {
    return {
      error: 'invalid_grant',
      error_description: 'Authorization incomplete',
    };
  }

  // Get the internal client ID (UUID) from client_id string
  const client = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.clientId, clientId),
  });

  if (!client) {
    return {
      error: 'invalid_client',
      error_description: 'Unknown client',
    };
  }

  // Generate access token
  const accessToken = generateSecureToken(32);
  const accessTokenHash = hashToken(accessToken);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY);

  await db.insert(oauthAccessTokens).values({
    tokenHash: accessTokenHash,
    clientId: client.id,
    userId: deviceAuth.userId,
    scopes: deviceAuth.approvedScopes,
    expiresAt: accessExpiresAt,
  });

  // Generate refresh token if offline_access scope is present
  let refreshToken: string | undefined;
  if (deviceAuth.approvedScopes.includes('offline_access')) {
    refreshToken = generateSecureToken(32);
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY);

    await db.insert(oauthRefreshTokens).values({
      tokenHash: refreshTokenHash,
      clientId: client.id,
      userId: deviceAuth.userId,
      scopes: deviceAuth.approvedScopes,
      expiresAt: refreshExpiresAt,
    });
  }

  // Clean up device auth data
  await deleteDeviceAuth(deviceCode);
  const userCodeHash = hashUserCode(deviceAuth.userCode);
  await deleteUserCodeMapping(userCodeHash);

  oauthLogger.info('Device code exchanged for tokens', {
    clientId,
    userId: deviceAuth.userId,
    scopes: deviceAuth.approvedScopes,
  });

  const response: DeviceTokenResponse = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_EXPIRY / 1000),
    scope: deviceAuth.approvedScopes.join(' '),
  };

  if (refreshToken) {
    response.refresh_token = refreshToken;
  }

  return response;
}

/**
 * Check if response is an error
 */
export function isDeviceTokenError(
  response: DeviceTokenResponse | DeviceTokenErrorResponse
): response is DeviceTokenErrorResponse {
  return 'error' in response;
}
