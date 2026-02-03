/**
 * Personal Access Token (PAT) Service
 * Manages personal access tokens for API and git authentication
 */

import { createHash, randomBytes } from 'crypto';
import { db } from '../db';
import { personalAccessTokens, users, type PersonalAccessToken } from '../db/schema';
import { eq, and, isNull, or, gt, lt } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '../utils/errors';

// ============================================================================
// Types
// ============================================================================

export interface CreateTokenInput {
  userId: string;
  name: string;
  scopes: string[];
  expiresAt?: Date;
}

export interface TokenInfo {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  isExpired: boolean;
  isRevoked: boolean;
}

export interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  scopes?: string[];
  tokenId?: string;
  error?: string;
}

export interface TokenWithUser {
  token: PersonalAccessToken;
  user: {
    id: string;
    username: string;
    email: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

const TOKEN_PREFIX = 'cv_pat_';
const TOKEN_BYTES = 32; // 256 bits of entropy
const VALID_SCOPES = [
  'repo:read',
  'repo:write',
  'repo:admin',
  'user:read',
  'user:write',
  'org:read',
  'org:write',
  'ssh_keys:read',
  'ssh_keys:write',
];

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate a new random token
 */
function generateToken(): string {
  const randomPart = randomBytes(TOKEN_BYTES).toString('base64url');
  return `${TOKEN_PREFIX}${randomPart}`;
}

/**
 * Hash a token for storage
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Get display prefix from token (first 12 chars)
 */
function getTokenPrefix(token: string): string {
  return token.slice(0, 12);
}

/**
 * Validate scope list
 */
function validateScopes(scopes: string[]): void {
  if (!scopes || scopes.length === 0) {
    throw new ValidationError('At least one scope is required');
  }

  for (const scope of scopes) {
    if (!VALID_SCOPES.includes(scope)) {
      throw new ValidationError(`Invalid scope: ${scope}`);
    }
  }
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Create a new personal access token
 * Returns the full token (only shown once)
 */
export async function createToken(input: CreateTokenInput): Promise<{ token: string; tokenInfo: TokenInfo }> {
  const { userId, name, scopes, expiresAt } = input;

  // Validate scopes
  validateScopes(scopes);

  // Validate name
  if (!name || name.trim().length === 0) {
    throw new ValidationError('Token name is required');
  }

  if (name.length > 255) {
    throw new ValidationError('Token name must be 255 characters or less');
  }

  // Generate token
  const token = generateToken();
  const tokenHash = hashToken(token);
  const tokenPrefix = getTokenPrefix(token);

  // Store in database
  const [pat] = await db.insert(personalAccessTokens).values({
    userId,
    name: name.trim(),
    tokenHash,
    tokenPrefix,
    scopes,
    expiresAt,
  }).returning();

  return {
    token, // Full token - only returned once!
    tokenInfo: {
      id: pat.id,
      name: pat.name,
      tokenPrefix: pat.tokenPrefix,
      scopes: pat.scopes as string[],
      expiresAt: pat.expiresAt,
      lastUsedAt: pat.lastUsedAt,
      createdAt: pat.createdAt,
      isExpired: pat.expiresAt ? pat.expiresAt < new Date() : false,
      isRevoked: !!pat.revokedAt,
    },
  };
}

/**
 * Validate a token and return user info if valid
 */
export async function validateToken(token: string): Promise<TokenValidationResult> {
  // Check token format
  if (!token.startsWith(TOKEN_PREFIX)) {
    return { valid: false, error: 'Invalid token format' };
  }

  // Hash and lookup
  const tokenHash = hashToken(token);

  const pat = await db.query.personalAccessTokens.findFirst({
    where: eq(personalAccessTokens.tokenHash, tokenHash),
    with: {
      user: true,
    },
  });

  if (!pat) {
    return { valid: false, error: 'Token not found' };
  }

  // Check if revoked
  if (pat.revokedAt) {
    return { valid: false, error: 'Token has been revoked' };
  }

  // Check expiration
  if (pat.expiresAt && pat.expiresAt < new Date()) {
    return { valid: false, error: 'Token has expired' };
  }

  // Update last used (async, don't wait)
  updateLastUsed(pat.id).catch(() => {});

  return {
    valid: true,
    userId: pat.userId,
    scopes: pat.scopes as string[],
    tokenId: pat.id,
  };
}

/**
 * Validate token and check for specific scope
 */
export async function validateTokenWithScope(token: string, requiredScope: string): Promise<TokenValidationResult> {
  const result = await validateToken(token);

  if (!result.valid) {
    return result;
  }

  if (!result.scopes?.includes(requiredScope)) {
    return {
      valid: false,
      error: `Token does not have required scope: ${requiredScope}`,
    };
  }

  return result;
}

/**
 * Validate token and check for any of the required scopes
 */
export async function validateTokenWithAnyScope(token: string, requiredScopes: string[]): Promise<TokenValidationResult> {
  const result = await validateToken(token);

  if (!result.valid) {
    return result;
  }

  const hasScope = requiredScopes.some(scope => result.scopes?.includes(scope));
  if (!hasScope) {
    return {
      valid: false,
      error: `Token does not have any of the required scopes: ${requiredScopes.join(', ')}`,
    };
  }

  return result;
}

/**
 * List all tokens for a user
 */
export async function listTokens(userId: string): Promise<TokenInfo[]> {
  const tokens = await db.query.personalAccessTokens.findMany({
    where: eq(personalAccessTokens.userId, userId),
    orderBy: (tokens, { desc }) => [desc(tokens.createdAt)],
  });

  const now = new Date();

  return tokens.map(pat => ({
    id: pat.id,
    name: pat.name,
    tokenPrefix: pat.tokenPrefix,
    scopes: pat.scopes as string[],
    expiresAt: pat.expiresAt,
    lastUsedAt: pat.lastUsedAt,
    createdAt: pat.createdAt,
    isExpired: pat.expiresAt ? pat.expiresAt < now : false,
    isRevoked: !!pat.revokedAt,
  }));
}

/**
 * Get a single token by ID
 */
export async function getToken(userId: string, tokenId: string): Promise<TokenInfo | null> {
  const pat = await db.query.personalAccessTokens.findFirst({
    where: and(
      eq(personalAccessTokens.id, tokenId),
      eq(personalAccessTokens.userId, userId)
    ),
  });

  if (!pat) {
    return null;
  }

  const now = new Date();

  return {
    id: pat.id,
    name: pat.name,
    tokenPrefix: pat.tokenPrefix,
    scopes: pat.scopes as string[],
    expiresAt: pat.expiresAt,
    lastUsedAt: pat.lastUsedAt,
    createdAt: pat.createdAt,
    isExpired: pat.expiresAt ? pat.expiresAt < now : false,
    isRevoked: !!pat.revokedAt,
  };
}

/**
 * Revoke a token
 */
export async function revokeToken(userId: string, tokenId: string, reason?: string): Promise<void> {
  const result = await db.update(personalAccessTokens)
    .set({
      revokedAt: new Date(),
      revokedReason: reason,
    })
    .where(and(
      eq(personalAccessTokens.id, tokenId),
      eq(personalAccessTokens.userId, userId),
      isNull(personalAccessTokens.revokedAt)
    ))
    .returning({ id: personalAccessTokens.id });

  if (result.length === 0) {
    throw new NotFoundError('Token not found or already revoked');
  }
}

/**
 * Revoke all tokens for a user
 */
export async function revokeAllTokens(userId: string, reason?: string): Promise<number> {
  const result = await db.update(personalAccessTokens)
    .set({
      revokedAt: new Date(),
      revokedReason: reason || 'Revoked all tokens',
    })
    .where(and(
      eq(personalAccessTokens.userId, userId),
      isNull(personalAccessTokens.revokedAt)
    ))
    .returning({ id: personalAccessTokens.id });

  return result.length;
}

/**
 * Update last used timestamp
 */
async function updateLastUsed(tokenId: string, ip?: string): Promise<void> {
  await db.update(personalAccessTokens)
    .set({
      lastUsedAt: new Date(),
      lastUsedIp: ip,
      usageCount: `COALESCE(usage_count, '0')::bigint + 1`,
    })
    .where(eq(personalAccessTokens.id, tokenId));
}

/**
 * Delete expired tokens (cleanup job)
 */
export async function deleteExpiredTokens(olderThan?: Date): Promise<number> {
  const cutoff = olderThan || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

  const result = await db.delete(personalAccessTokens)
    .where(
      or(
        // Expired more than 30 days ago
        lt(personalAccessTokens.expiresAt, cutoff),
        // Revoked more than 30 days ago
        lt(personalAccessTokens.revokedAt, cutoff)
      )
    )
    .returning({ id: personalAccessTokens.id });

  return result.length;
}

/**
 * Get active token count for a user
 */
export async function getActiveTokenCount(userId: string): Promise<number> {
  const now = new Date();

  const tokens = await db.query.personalAccessTokens.findMany({
    where: and(
      eq(personalAccessTokens.userId, userId),
      isNull(personalAccessTokens.revokedAt),
      or(
        isNull(personalAccessTokens.expiresAt),
        gt(personalAccessTokens.expiresAt, now)
      )
    ),
    columns: { id: true },
  });

  return tokens.length;
}
