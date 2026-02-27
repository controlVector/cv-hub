/**
 * OAuth 2.1 Service Layer Tests
 * Tests: client registration, PKCE authorization codes, token exchange,
 * refresh/rotation, revocation, introspection, and consent management.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { db } from '../db';
import { oauthClients, oauthAccessTokens, oauthRefreshTokens, users } from '../db/schema';
import { hashToken, generateSecureToken } from '../utils/crypto';
import {
  createOAuthClient,
  getClientByClientId,
  validateClientCredentials,
  validateRedirectUri,
  validateScopes,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  validateAccessToken,
  refreshAccessToken,
  revokeToken,
  introspectToken,
  hasUserConsent,
} from './oauth.service';
import {
  registerMCPClient,
  validateMCPAccessToken,
  hasMCPScope,
  MCP_DEFAULT_SCOPES,
  MCP_ALL_SCOPES,
} from './mcp-oauth.service';
import {
  truncateAllTables,
  createTestUserWithPassword,
} from '../test/test-db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;
function uid() {
  return `${Date.now()}_${++seq}`;
}

/** Create a test user and return the user row. */
async function createUser() {
  return createTestUserWithPassword({
    username: `oauth_user_${uid()}`,
    email: `oauth_${uid()}@test.com`,
  });
}

/** Register a confidential OAuth client with sensible defaults. */
async function createConfidentialClient(ownerId?: string) {
  return createOAuthClient({
    name: `Test Client ${uid()}`,
    redirectUris: ['https://example.com/callback'],
    isConfidential: true,
    ownerId,
  });
}

/** Register a public OAuth client (no secret). */
async function createPublicClient() {
  return createOAuthClient({
    name: `Public Client ${uid()}`,
    redirectUris: ['https://example.com/callback'],
    isConfidential: false,
  });
}

/** Generate a PKCE pair (verifier + S256 challenge). */
function generatePKCE() {
  const codeVerifier = generateSecureToken(32);
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

/** Full PKCE auth code → token exchange in one call. */
async function issueTokensViaPKCE(
  clientId: string,
  userId: string,
  scopes = ['openid', 'offline_access', 'mcp:tools'],
) {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const code = await createAuthorizationCode({
    clientId,
    userId,
    redirectUri: 'https://example.com/callback',
    scopes,
    codeChallenge,
    codeChallengeMethod: 'S256',
  });
  const tokens = await exchangeAuthorizationCode(
    code,
    clientId,
    'https://example.com/callback',
    codeVerifier,
  );
  return tokens!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuth 2.1 Service', () => {
  // -----------------------------------------------------------------------
  // Client Registration
  // -----------------------------------------------------------------------

  describe('createOAuthClient', () => {
    it('creates a confidential client with hashed secret', async () => {
      const result = await createConfidentialClient();

      expect(result.clientId).toBeDefined();
      expect(result.clientSecret).toBeDefined();
      expect(result.clientId.length).toBeGreaterThan(0);
      expect(result.clientSecret!.length).toBeGreaterThan(0);

      // Verify the client is stored in DB
      const client = await getClientByClientId(result.clientId);
      expect(client).toBeDefined();
      expect(client!.isConfidential).toBe(true);
      expect(client!.clientSecretHash).toBe(hashToken(result.clientSecret!));
    });

    it('creates a public client with no secret', async () => {
      const result = await createPublicClient();

      expect(result.clientId).toBeDefined();
      expect(result.clientSecret).toBeUndefined();

      const client = await getClientByClientId(result.clientId);
      expect(client).toBeDefined();
      expect(client!.isConfidential).toBe(false);
      expect(client!.clientSecretHash).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Dynamic Client Registration (MCP RFC 7591)
  // -----------------------------------------------------------------------

  describe('registerMCPClient', () => {
    it('creates client with credentials and default MCP scopes', async () => {
      const response = await registerMCPClient({
        client_name: 'Claude.ai MCP',
        redirect_uris: ['https://claude.ai/callback'],
      });

      expect(response.client_id).toBeDefined();
      expect(response.client_secret).toBeDefined();
      expect(response.client_name).toBe('Claude.ai MCP');
      expect(response.redirect_uris).toEqual(['https://claude.ai/callback']);
      expect(response.grant_types).toContain('authorization_code');
      expect(response.scope.split(' ')).toEqual(expect.arrayContaining(MCP_DEFAULT_SCOPES));
      expect(response.token_endpoint_auth_method).toBe('client_secret_post');
    });

    it('rejects empty redirect_uris', async () => {
      await expect(
        registerMCPClient({
          client_name: 'Bad Client',
          redirect_uris: [],
        }),
      ).rejects.toThrow('redirect_uris is required');
    });

    it('rejects invalid redirect_uri', async () => {
      await expect(
        registerMCPClient({
          client_name: 'Bad Client',
          redirect_uris: ['not-a-url'],
        }),
      ).rejects.toThrow('Invalid redirect_uri');
    });

    it('filters invalid scopes to defaults', async () => {
      const response = await registerMCPClient({
        client_name: 'Scoped Client',
        redirect_uris: ['https://example.com/cb'],
        scope: 'bogus_scope another_fake',
      });

      // All invalid scopes → fall back to defaults
      expect(response.scope.split(' ')).toEqual(expect.arrayContaining(MCP_DEFAULT_SCOPES));
    });

    it('public client (auth_method=none) has no secret', async () => {
      const response = await registerMCPClient({
        client_name: 'Public MCP',
        redirect_uris: ['https://example.com/cb'],
        token_endpoint_auth_method: 'none',
      });

      expect(response.client_secret).toBeUndefined();
      expect(response.token_endpoint_auth_method).toBe('none');

      const client = await getClientByClientId(response.client_id);
      expect(client!.isConfidential).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Client Credentials Validation
  // -----------------------------------------------------------------------

  describe('validateClientCredentials', () => {
    it('valid client + secret returns true', async () => {
      const { clientId, clientSecret } = await createConfidentialClient();
      const result = await validateClientCredentials(clientId, clientSecret!);

      expect(result.valid).toBe(true);
      expect(result.client).toBeDefined();
      expect(result.client!.clientId).toBe(clientId);
    });

    it('wrong secret returns false', async () => {
      const { clientId } = await createConfidentialClient();
      const result = await validateClientCredentials(clientId, 'wrong_secret');

      expect(result.valid).toBe(false);
      expect(result.client).toBeUndefined();
    });

    it('nonexistent client returns false', async () => {
      const result = await validateClientCredentials('nonexistent_id', 'secret');
      expect(result.valid).toBe(false);
    });

    it('public client validates without secret', async () => {
      const { clientId } = await createPublicClient();
      const result = await validateClientCredentials(clientId);

      expect(result.valid).toBe(true);
      expect(result.client).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Redirect URI + Scope Validation
  // -----------------------------------------------------------------------

  describe('validateRedirectUri', () => {
    it('accepts registered redirect URI', async () => {
      const { clientId } = await createConfidentialClient();
      const valid = await validateRedirectUri(clientId, 'https://example.com/callback');
      expect(valid).toBe(true);
    });

    it('rejects unregistered redirect URI', async () => {
      const { clientId } = await createConfidentialClient();
      const valid = await validateRedirectUri(clientId, 'https://evil.com/callback');
      expect(valid).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Authorization Code + PKCE
  // -----------------------------------------------------------------------

  describe('createAuthorizationCode + exchangeAuthorizationCode', () => {
    it('creates code and exchanges with valid PKCE verifier', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const { codeVerifier, codeChallenge } = generatePKCE();

      const code = await createAuthorizationCode({
        clientId,
        userId: user.id,
        redirectUri: 'https://example.com/callback',
        scopes: ['openid', 'profile', 'offline_access'],
        codeChallenge,
        codeChallengeMethod: 'S256',
      });

      expect(code).toBeDefined();
      expect(code.length).toBeGreaterThan(0);

      const tokens = await exchangeAuthorizationCode(
        code,
        clientId,
        'https://example.com/callback',
        codeVerifier,
      );

      expect(tokens).not.toBeNull();
      expect(tokens!.accessToken).toBeDefined();
      expect(tokens!.refreshToken).toBeDefined(); // offline_access scope
      expect(tokens!.idToken).toBeDefined(); // openid scope
      expect(tokens!.tokenType).toBe('Bearer');
      expect(tokens!.expiresIn).toBeGreaterThan(0);
      expect(tokens!.scopes).toContain('openid');
    });

    it('rejects wrong PKCE verifier', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const { codeChallenge } = generatePKCE();

      const code = await createAuthorizationCode({
        clientId,
        userId: user.id,
        redirectUri: 'https://example.com/callback',
        scopes: ['openid'],
        codeChallenge,
        codeChallengeMethod: 'S256',
      });

      const tokens = await exchangeAuthorizationCode(
        code,
        clientId,
        'https://example.com/callback',
        'totally_wrong_verifier',
      );

      expect(tokens).toBeNull();
    });

    it('rejects missing PKCE verifier when challenge was set', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const { codeChallenge } = generatePKCE();

      const code = await createAuthorizationCode({
        clientId,
        userId: user.id,
        redirectUri: 'https://example.com/callback',
        scopes: ['openid'],
        codeChallenge,
        codeChallengeMethod: 'S256',
      });

      // No verifier supplied
      const tokens = await exchangeAuthorizationCode(
        code,
        clientId,
        'https://example.com/callback',
      );

      expect(tokens).toBeNull();
    });

    it('rejects already-used code', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const { codeVerifier, codeChallenge } = generatePKCE();

      const code = await createAuthorizationCode({
        clientId,
        userId: user.id,
        redirectUri: 'https://example.com/callback',
        scopes: ['openid'],
        codeChallenge,
        codeChallengeMethod: 'S256',
      });

      // First exchange succeeds
      const tokens1 = await exchangeAuthorizationCode(
        code,
        clientId,
        'https://example.com/callback',
        codeVerifier,
      );
      expect(tokens1).not.toBeNull();

      // Second exchange fails (code already used)
      const tokens2 = await exchangeAuthorizationCode(
        code,
        clientId,
        'https://example.com/callback',
        codeVerifier,
      );
      expect(tokens2).toBeNull();
    });

    it('rejects mismatched redirect URI', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();

      const code = await createAuthorizationCode({
        clientId,
        userId: user.id,
        redirectUri: 'https://example.com/callback',
        scopes: ['openid'],
      });

      const tokens = await exchangeAuthorizationCode(
        code,
        clientId,
        'https://different.com/callback',
      );

      expect(tokens).toBeNull();
    });

    it('does not return refresh token without offline_access scope', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();

      const code = await createAuthorizationCode({
        clientId,
        userId: user.id,
        redirectUri: 'https://example.com/callback',
        scopes: ['openid', 'profile'],
      });

      const tokens = await exchangeAuthorizationCode(
        code,
        clientId,
        'https://example.com/callback',
      );

      expect(tokens).not.toBeNull();
      expect(tokens!.accessToken).toBeDefined();
      expect(tokens!.refreshToken).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Access Token Validation
  // -----------------------------------------------------------------------

  describe('validateAccessToken', () => {
    it('valid token returns userId, clientId, scopes', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const tokens = await issueTokensViaPKCE(clientId, user.id);

      const result = await validateAccessToken(tokens.accessToken);

      expect(result.valid).toBe(true);
      expect(result.userId).toBe(user.id);
      expect(result.scopes).toContain('mcp:tools');
    });

    it('expired token returns invalid', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const tokens = await issueTokensViaPKCE(clientId, user.id);

      // Manually expire the token in DB
      const tokenHash = hashToken(tokens.accessToken);
      const { eq } = await import('drizzle-orm');
      await db
        .update(oauthAccessTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(oauthAccessTokens.tokenHash, tokenHash));

      const result = await validateAccessToken(tokens.accessToken);
      expect(result.valid).toBe(false);
    });

    it('revoked token returns invalid', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const tokens = await issueTokensViaPKCE(clientId, user.id);

      await revokeToken(tokens.accessToken, 'access_token');

      const result = await validateAccessToken(tokens.accessToken);
      expect(result.valid).toBe(false);
    });

    it('random string returns invalid', async () => {
      const result = await validateAccessToken('not_a_real_token');
      expect(result.valid).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Refresh Token + Rotation
  // -----------------------------------------------------------------------

  describe('refreshAccessToken', () => {
    it('valid refresh produces new tokens and rotates old refresh', async () => {
      const user = await createUser();
      const { clientId, clientSecret } = await createConfidentialClient();
      const original = await issueTokensViaPKCE(clientId, user.id);
      expect(original.refreshToken).toBeDefined();

      const refreshed = await refreshAccessToken(
        original.refreshToken!,
        clientId,
        clientSecret!,
      );

      expect(refreshed).not.toBeNull();
      expect(refreshed!.accessToken).toBeDefined();
      expect(refreshed!.refreshToken).toBeDefined();
      expect(refreshed!.accessToken).not.toBe(original.accessToken);
      expect(refreshed!.refreshToken).not.toBe(original.refreshToken);

      // Old refresh token should no longer work (rotated)
      const again = await refreshAccessToken(
        original.refreshToken!,
        clientId,
        clientSecret!,
      );
      expect(again).toBeNull();
    });

    it('revoked refresh token returns null', async () => {
      const user = await createUser();
      const { clientId, clientSecret } = await createConfidentialClient();
      const original = await issueTokensViaPKCE(clientId, user.id);

      await revokeToken(original.refreshToken!, 'refresh_token');

      const result = await refreshAccessToken(
        original.refreshToken!,
        clientId,
        clientSecret!,
      );
      expect(result).toBeNull();
    });

    it('wrong client secret returns null', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const original = await issueTokensViaPKCE(clientId, user.id);

      const result = await refreshAccessToken(
        original.refreshToken!,
        clientId,
        'wrong_secret',
      );
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Token Revocation
  // -----------------------------------------------------------------------

  describe('revokeToken', () => {
    it('revokes an access token', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const tokens = await issueTokensViaPKCE(clientId, user.id);

      // Token is valid before revocation
      let result = await validateAccessToken(tokens.accessToken);
      expect(result.valid).toBe(true);

      await revokeToken(tokens.accessToken);

      // Token is invalid after revocation
      result = await validateAccessToken(tokens.accessToken);
      expect(result.valid).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Token Introspection (RFC 7662)
  // -----------------------------------------------------------------------

  describe('introspectToken', () => {
    it('active access token returns full claims', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const tokens = await issueTokensViaPKCE(clientId, user.id);

      const info = await introspectToken(tokens.accessToken);

      expect(info.active).toBe(true);
      expect(info.sub).toBe(user.id);
      expect(info.client_id).toBe(clientId);
      expect(info.token_type).toBe('Bearer');
      expect(info.scope).toContain('mcp:tools');
      expect(info.exp).toBeDefined();
      expect(info.iat).toBeDefined();
    });

    it('revoked token returns inactive', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const tokens = await issueTokensViaPKCE(clientId, user.id);

      await revokeToken(tokens.accessToken, 'access_token');

      const info = await introspectToken(tokens.accessToken);
      expect(info.active).toBe(false);
    });

    it('nonexistent token returns inactive', async () => {
      const info = await introspectToken('definitely_not_a_token');
      expect(info.active).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Consent Management
  // -----------------------------------------------------------------------

  describe('hasUserConsent', () => {
    it('returns true after token exchange with rememberConsent', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();

      // Exchange with rememberConsent (default true)
      await issueTokensViaPKCE(clientId, user.id, ['openid', 'offline_access']);

      const consented = await hasUserConsent(user.id, clientId, ['openid']);
      expect(consented).toBe(true);
    });

    it('returns false when no prior consent exists', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();

      const consented = await hasUserConsent(user.id, clientId, ['openid']);
      expect(consented).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // MCP Token Validation (cascade: PAT → JWT → OAuth)
  // -----------------------------------------------------------------------

  describe('validateMCPAccessToken', () => {
    it('validates an OAuth access token', async () => {
      const user = await createUser();
      const { clientId } = await createConfidentialClient();
      const tokens = await issueTokensViaPKCE(clientId, user.id);

      const result = await validateMCPAccessToken(tokens.accessToken);

      expect(result.valid).toBe(true);
      expect(result.userId).toBe(user.id);
    });

    it('invalid token returns false', async () => {
      const result = await validateMCPAccessToken('invalid_random_token');
      expect(result.valid).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // hasMCPScope utility
  // -----------------------------------------------------------------------

  describe('hasMCPScope', () => {
    it('returns true when scope is present', () => {
      expect(hasMCPScope(['mcp:tools', 'mcp:tasks'], 'mcp:tools')).toBe(true);
    });

    it('returns false when scope is missing', () => {
      expect(hasMCPScope(['mcp:tools'], 'mcp:execute')).toBe(false);
    });
  });
});
