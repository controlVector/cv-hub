import { eq, and, gt, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { db } from '../db';
import {
  oauthClients,
  oauthAuthorizationCodes,
  oauthAccessTokens,
  oauthRefreshTokens,
  oauthConsents,
  users,
} from '../db/schema';
import { hashToken, generateSecureToken } from '../utils/crypto';
import { env } from '../config/env';

// Token expiration times
const AUTH_CODE_EXPIRY = 10 * 60 * 1000;      // 10 minutes
const ACCESS_TOKEN_EXPIRY = 60 * 60 * 1000;   // 1 hour
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days
const ID_TOKEN_EXPIRY = 60 * 60;               // 1 hour (seconds for jose)

// Standard OAuth scopes
export const STANDARD_SCOPES = {
  openid: 'Required for OpenID Connect',
  profile: 'Access to basic profile information (name, username, avatar)',
  email: 'Access to email address',
  offline_access: 'Request a refresh token for long-term access',
  'repo:read': 'Clone and fetch repositories',
  'repo:write': 'Push to repositories',
  'repo:admin': 'Manage repository settings',
  'mcp:tools': 'Access MCP tool execution',
  'mcp:tasks': 'Manage agent tasks (create, read, update)',
  'mcp:threads': 'Thread continuity operations (create, read, bridge)',
  'mcp:execute': 'Execute tasks on agent executors',
} as const;

// ==================== Client Management ====================

export async function getClientByClientId(clientId: string) {
  return db.query.oauthClients.findFirst({
    where: and(
      eq(oauthClients.clientId, clientId),
      eq(oauthClients.isActive, true),
    ),
  });
}

export async function validateClientCredentials(
  clientId: string,
  clientSecret?: string,
): Promise<{ valid: boolean; client?: typeof oauthClients.$inferSelect }> {
  const client = await getClientByClientId(clientId);

  if (!client) {
    return { valid: false };
  }

  // Public clients don't have a secret
  if (!client.isConfidential) {
    return { valid: true, client };
  }

  // Confidential clients require a valid secret
  if (!clientSecret || !client.clientSecretHash) {
    return { valid: false };
  }

  const secretHash = hashToken(clientSecret);
  if (secretHash !== client.clientSecretHash) {
    return { valid: false };
  }

  return { valid: true, client };
}

export async function validateRedirectUri(clientId: string, redirectUri: string): Promise<boolean> {
  const client = await getClientByClientId(clientId);
  if (!client) return false;

  return client.redirectUris.includes(redirectUri);
}

export async function validateScopes(clientId: string, requestedScopes: string[]): Promise<string[]> {
  const client = await getClientByClientId(clientId);
  if (!client) return [];

  // Return only scopes that are both requested and allowed
  return requestedScopes.filter(scope => client.allowedScopes.includes(scope));
}

// ==================== Authorization Codes ====================

export async function createAuthorizationCode(params: {
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  codeChallengeMethod?: string;
  nonce?: string;
  rememberConsent?: boolean;
}): Promise<string> {
  const client = await getClientByClientId(params.clientId);
  if (!client) throw new Error('Invalid client');

  const code = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + AUTH_CODE_EXPIRY);

  await db.insert(oauthAuthorizationCodes).values({
    code,
    clientId: client.id,
    userId: params.userId,
    redirectUri: params.redirectUri,
    scopes: params.scopes,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    nonce: params.nonce,
    rememberConsent: params.rememberConsent ?? true,
    expiresAt,
  });

  return code;
}

export async function exchangeAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<{
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn: number;
  tokenType: string;
  scopes: string[];
} | null> {
  const authCode = await db.query.oauthAuthorizationCodes.findFirst({
    where: and(
      eq(oauthAuthorizationCodes.code, code),
      gt(oauthAuthorizationCodes.expiresAt, new Date()),
      isNull(oauthAuthorizationCodes.usedAt),
    ),
    with: {
      // Note: We'll need to add relations for this to work
    },
  });

  if (!authCode) return null;

  // Get the client to verify
  const client = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.id, authCode.clientId),
  });

  if (!client || client.clientId !== clientId) return null;

  // Verify redirect URI
  if (authCode.redirectUri !== redirectUri) return null;

  // Verify PKCE if code challenge was set
  if (authCode.codeChallenge) {
    if (!codeVerifier) return null;

    const expectedChallenge = authCode.codeChallengeMethod === 'S256'
      ? createHash('sha256').update(codeVerifier).digest('base64url')
      : codeVerifier;

    if (expectedChallenge !== authCode.codeChallenge) return null;
  }

  // Mark code as used
  await db.update(oauthAuthorizationCodes)
    .set({ usedAt: new Date() })
    .where(eq(oauthAuthorizationCodes.id, authCode.id));

  // Generate tokens
  const accessToken = generateSecureToken(32);
  const accessTokenHash = hashToken(accessToken);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY);

  await db.insert(oauthAccessTokens).values({
    tokenHash: accessTokenHash,
    clientId: authCode.clientId,
    userId: authCode.userId,
    scopes: authCode.scopes,
    expiresAt: accessExpiresAt,
  });

  let refreshToken: string | undefined;
  if (authCode.scopes.includes('offline_access')) {
    refreshToken = generateSecureToken(32);
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY);

    await db.insert(oauthRefreshTokens).values({
      tokenHash: refreshTokenHash,
      clientId: authCode.clientId,
      userId: authCode.userId,
      scopes: authCode.scopes,
      expiresAt: refreshExpiresAt,
    });
  }

  // Generate ID token if openid scope is present
  let idToken: string | undefined;
  if (authCode.scopes.includes('openid')) {
    idToken = await generateIdToken(authCode.userId, clientId, authCode.scopes, authCode.nonce);
  }

  // Record or update consent (only if user chose to remember)
  if (authCode.rememberConsent) {
    await db.insert(oauthConsents)
      .values({
        clientId: authCode.clientId,
        userId: authCode.userId,
        scopes: authCode.scopes,
      })
      .onConflictDoUpdate({
        target: [oauthConsents.clientId, oauthConsents.userId],
        set: {
          scopes: authCode.scopes,
          updatedAt: new Date(),
          revokedAt: null,
        },
      });
  }

  return {
    accessToken,
    refreshToken,
    idToken,
    expiresIn: Math.floor(ACCESS_TOKEN_EXPIRY / 1000),
    tokenType: 'Bearer',
    scopes: authCode.scopes,
  };
}

// ==================== ID Token (OpenID Connect) ====================

async function generateIdToken(
  userId: string,
  clientId: string,
  scopes: string[],
  nonce?: string | null,
): Promise<string> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) throw new Error('User not found');

  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

  const claims: Record<string, any> = {
    sub: user.id,
    aud: clientId,
    iat: now,
    exp: now + ID_TOKEN_EXPIRY,
    iss: env.API_URL,
    auth_time: now,
  };

  if (nonce) {
    claims.nonce = nonce;
  }

  // Add profile claims if scope is present
  if (scopes.includes('profile')) {
    claims.name = user.displayName || user.username;
    claims.preferred_username = user.username;
    claims.picture = user.avatarUrl;
    claims.updated_at = Math.floor(user.updatedAt.getTime() / 1000);
  }

  // Add email claims if scope is present
  if (scopes.includes('email')) {
    claims.email = user.email;
    claims.email_verified = user.emailVerified;
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(secret);
}

// ==================== Access Token Validation ====================

export async function validateAccessToken(token: string): Promise<{
  valid: boolean;
  userId?: string;
  clientId?: string;
  scopes?: string[];
}> {
  const tokenHash = hashToken(token);

  const accessToken = await db.query.oauthAccessTokens.findFirst({
    where: and(
      eq(oauthAccessTokens.tokenHash, tokenHash),
      gt(oauthAccessTokens.expiresAt, new Date()),
      isNull(oauthAccessTokens.revokedAt),
    ),
  });

  if (!accessToken) {
    return { valid: false };
  }

  const client = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.id, accessToken.clientId),
  });

  return {
    valid: true,
    userId: accessToken.userId,
    clientId: client?.clientId,
    scopes: accessToken.scopes,
  };
}

// ==================== Refresh Token ====================

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
} | null> {
  // Validate client credentials
  const { valid, client } = await validateClientCredentials(clientId, clientSecret);
  if (!valid || !client) return null;

  const tokenHash = hashToken(refreshToken);

  const token = await db.query.oauthRefreshTokens.findFirst({
    where: and(
      eq(oauthRefreshTokens.tokenHash, tokenHash),
      gt(oauthRefreshTokens.expiresAt, new Date()),
      isNull(oauthRefreshTokens.revokedAt),
      isNull(oauthRefreshTokens.rotatedAt),
    ),
  });

  if (!token || token.clientId !== client.id) return null;

  // Generate new access token
  const newAccessToken = generateSecureToken(32);
  const accessTokenHash = hashToken(newAccessToken);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY);

  const [accessTokenRecord] = await db.insert(oauthAccessTokens).values({
    tokenHash: accessTokenHash,
    clientId: token.clientId,
    userId: token.userId,
    scopes: token.scopes,
    expiresAt: accessExpiresAt,
  }).returning();

  // Rotate refresh token
  const newRefreshToken = generateSecureToken(32);
  const newRefreshTokenHash = hashToken(newRefreshToken);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY);

  const [newRefreshTokenRecord] = await db.insert(oauthRefreshTokens).values({
    tokenHash: newRefreshTokenHash,
    clientId: token.clientId,
    userId: token.userId,
    accessTokenId: accessTokenRecord.id,
    scopes: token.scopes,
    expiresAt: refreshExpiresAt,
  }).returning();

  // Mark old refresh token as rotated
  await db.update(oauthRefreshTokens)
    .set({
      rotatedAt: new Date(),
      replacedByTokenId: newRefreshTokenRecord.id,
    })
    .where(eq(oauthRefreshTokens.id, token.id));

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: Math.floor(ACCESS_TOKEN_EXPIRY / 1000),
    tokenType: 'Bearer',
  };
}

// ==================== Token Revocation ====================

export async function revokeToken(token: string, tokenTypeHint?: 'access_token' | 'refresh_token'): Promise<void> {
  const tokenHash = hashToken(token);

  // Try to revoke as access token
  if (!tokenTypeHint || tokenTypeHint === 'access_token') {
    await db.update(oauthAccessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthAccessTokens.tokenHash, tokenHash));
  }

  // Try to revoke as refresh token
  if (!tokenTypeHint || tokenTypeHint === 'refresh_token') {
    await db.update(oauthRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthRefreshTokens.tokenHash, tokenHash));
  }
}

// ==================== Consent Management ====================

export async function hasUserConsent(userId: string, clientId: string, scopes: string[]): Promise<boolean> {
  const client = await getClientByClientId(clientId);
  if (!client) return false;

  // First-party apps skip consent
  if (client.isFirstParty) return true;

  const consent = await db.query.oauthConsents.findFirst({
    where: and(
      eq(oauthConsents.clientId, client.id),
      eq(oauthConsents.userId, userId),
      isNull(oauthConsents.revokedAt),
    ),
  });

  if (!consent) return false;

  // Check if all requested scopes are covered by the consent
  return scopes.every(scope => consent.scopes.includes(scope));
}

export async function getUserConsents(userId: string) {
  return db.query.oauthConsents.findMany({
    where: and(
      eq(oauthConsents.userId, userId),
      isNull(oauthConsents.revokedAt),
    ),
  });
}

export async function revokeUserConsent(userId: string, clientId: string): Promise<void> {
  const client = await getClientByClientId(clientId);
  if (!client) return;

  await db.update(oauthConsents)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(oauthConsents.clientId, client.id),
      eq(oauthConsents.userId, userId),
    ));

  // Also revoke all tokens for this client/user combination
  await db.update(oauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(oauthAccessTokens.clientId, client.id),
      eq(oauthAccessTokens.userId, userId),
    ));

  await db.update(oauthRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(oauthRefreshTokens.clientId, client.id),
      eq(oauthRefreshTokens.userId, userId),
    ));
}

// ==================== Revoke All User Tokens ====================

export async function revokeAllUserOAuthTokens(userId: string): Promise<{ accessTokens: number; refreshTokens: number }> {
  // Revoke all access tokens for this user
  const accessResult = await db.update(oauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(oauthAccessTokens.userId, userId),
      isNull(oauthAccessTokens.revokedAt),
    ))
    .returning({ id: oauthAccessTokens.id });

  // Revoke all refresh tokens for this user
  const refreshResult = await db.update(oauthRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(oauthRefreshTokens.userId, userId),
      isNull(oauthRefreshTokens.revokedAt),
    ))
    .returning({ id: oauthRefreshTokens.id });

  return {
    accessTokens: accessResult.length,
    refreshTokens: refreshResult.length,
  };
}

// ==================== Token Introspection (RFC 7662) ====================

export async function introspectToken(
  token: string,
  tokenTypeHint?: 'access_token' | 'refresh_token',
): Promise<{
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  aud?: string;
  iss?: string;
}> {
  const tokenHash = hashToken(token);

  // Try as access token first (unless hint says refresh_token)
  if (!tokenTypeHint || tokenTypeHint === 'access_token') {
    const accessToken = await db.query.oauthAccessTokens.findFirst({
      where: eq(oauthAccessTokens.tokenHash, tokenHash),
    });

    if (accessToken) {
      // Check if revoked or expired
      const isActive = !accessToken.revokedAt && accessToken.expiresAt > new Date();

      if (!isActive) {
        return { active: false };
      }

      // Get client info
      const client = await db.query.oauthClients.findFirst({
        where: eq(oauthClients.id, accessToken.clientId),
      });

      // Get user info
      const user = await db.query.users.findFirst({
        where: eq(users.id, accessToken.userId),
      });

      return {
        active: true,
        scope: accessToken.scopes.join(' '),
        client_id: client?.clientId,
        username: user?.email,
        token_type: 'Bearer',
        exp: Math.floor(accessToken.expiresAt.getTime() / 1000),
        iat: Math.floor(accessToken.createdAt.getTime() / 1000),
        sub: accessToken.userId,
        aud: client?.clientId,
        iss: env.API_URL,
      };
    }
  }

  // Try as refresh token
  if (!tokenTypeHint || tokenTypeHint === 'refresh_token') {
    const refreshToken = await db.query.oauthRefreshTokens.findFirst({
      where: eq(oauthRefreshTokens.tokenHash, tokenHash),
    });

    if (refreshToken) {
      // Check if revoked, rotated, or expired
      const isActive = !refreshToken.revokedAt &&
                       !refreshToken.rotatedAt &&
                       refreshToken.expiresAt > new Date();

      if (!isActive) {
        return { active: false };
      }

      // Get client info
      const client = await db.query.oauthClients.findFirst({
        where: eq(oauthClients.id, refreshToken.clientId),
      });

      // Get user info
      const user = await db.query.users.findFirst({
        where: eq(users.id, refreshToken.userId),
      });

      return {
        active: true,
        scope: refreshToken.scopes.join(' '),
        client_id: client?.clientId,
        username: user?.email,
        token_type: 'refresh_token',
        exp: Math.floor(refreshToken.expiresAt.getTime() / 1000),
        iat: Math.floor(refreshToken.createdAt.getTime() / 1000),
        sub: refreshToken.userId,
        aud: client?.clientId,
        iss: env.API_URL,
      };
    }
  }

  // Token not found
  return { active: false };
}

// ==================== Client Registration ====================

export async function createOAuthClient(params: {
  name: string;
  description?: string;
  redirectUris: string[];
  websiteUrl?: string;
  isConfidential?: boolean;
  ownerId?: string;
}): Promise<{ clientId: string; clientSecret?: string }> {
  const clientId = generateSecureToken(16);
  let clientSecret: string | undefined;
  let clientSecretHash: string | undefined;

  if (params.isConfidential !== false) {
    clientSecret = generateSecureToken(32);
    clientSecretHash = hashToken(clientSecret);
  }

  await db.insert(oauthClients).values({
    clientId,
    clientSecretHash,
    name: params.name,
    description: params.description,
    redirectUris: params.redirectUris,
    websiteUrl: params.websiteUrl,
    isConfidential: params.isConfidential ?? true,
    ownerId: params.ownerId,
  });

  return { clientId, clientSecret };
}
