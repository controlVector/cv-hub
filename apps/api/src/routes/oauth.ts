import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getCookie } from 'hono/cookie';

import { env } from '../config/env';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rate-limit';
import { logAuditEvent } from '../services/audit.service';
import { getUserById } from '../services/user.service';
import {
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
  STANDARD_SCOPES,
} from '../services/oauth.service';
import {
  exchangeDeviceCode,
  isDeviceTokenError,
} from '../services/device-auth.service';
import { AuthenticationError, ValidationError } from '../utils/errors';
import { oauthLogger } from '../utils/logger';

import type { AppEnv } from '../app';

const oauth = new Hono<AppEnv>();

// Helper to get request metadata
function getRequestMeta(c: any) {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : undefined,
    userAgent: c.req.header('user-agent'),
  };
}

// Parse Basic Auth header
function parseBasicAuth(authHeader: string | undefined): { clientId?: string; clientSecret?: string } {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return {};
  }

  try {
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const [clientId, clientSecret] = decoded.split(':');
    return { clientId, clientSecret };
  } catch {
    return {};
  }
}

// ==================== Authorization Endpoint ====================

const authorizeQuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  scope: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.enum(['S256', 'plain']).optional(),
  nonce: z.string().optional(),
  prompt: z.enum(['none', 'login', 'consent']).optional(),
});

// GET /oauth/authorize - Start authorization flow
oauth.get('/authorize', optionalAuth, zValidator('query', authorizeQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const userId = c.get('userId');
  const meta = getRequestMeta(c);

  oauthLogger.debug('Authorization request', {
    clientId: query.client_id,
    redirectUri: query.redirect_uri,
    scope: query.scope,
    hasUser: !!userId,
  });

  // Validate client
  const client = await getClientByClientId(query.client_id);
  if (!client) {
    oauthLogger.debug('Unknown client', { clientId: query.client_id });
    return c.json({ error: 'invalid_client', error_description: 'Unknown client' }, 400);
  }

  // Validate redirect URI
  const validRedirect = await validateRedirectUri(query.client_id, query.redirect_uri);
  if (!validRedirect) {
    return c.json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' }, 400);
  }

  // Helper to redirect with error
  const redirectWithError = (error: string, description: string) => {
    const url = new URL(query.redirect_uri);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', description);
    if (query.state) url.searchParams.set('state', query.state);
    return c.redirect(url.toString());
  };

  // Parse and validate scopes
  const requestedScopes = query.scope?.split(' ').filter(Boolean) || ['openid'];
  const validScopes = await validateScopes(query.client_id, requestedScopes);

  if (requestedScopes.length > 0 && validScopes.length === 0) {
    return redirectWithError('invalid_scope', 'None of the requested scopes are allowed');
  }

  // Check PKCE requirement
  if (client.requirePkce && !query.code_challenge) {
    return redirectWithError('invalid_request', 'PKCE code_challenge is required');
  }

  if (query.code_challenge && query.code_challenge_method !== 'S256') {
    return redirectWithError('invalid_request', 'Only S256 code_challenge_method is supported');
  }

  // If user is not authenticated
  if (!userId) {
    if (query.prompt === 'none') {
      return redirectWithError('login_required', 'User is not authenticated');
    }

    // Redirect to login with return URL
    const returnUrl = new URL(c.req.url);
    const loginUrl = new URL('/login', env.APP_URL);
    loginUrl.searchParams.set('redirect', returnUrl.toString());
    return c.redirect(loginUrl.toString());
  }

  // Check if consent already granted (skip consent screen for first-party or already consented)
  const hasConsent = await hasUserConsent(userId, query.client_id, validScopes);

  if (hasConsent) {
    // Skip consent screen - generate code directly
    const code = await createAuthorizationCode({
      clientId: query.client_id,
      userId,
      redirectUri: query.redirect_uri,
      scopes: validScopes,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      nonce: query.nonce,
    });

    await logAuditEvent({
      userId,
      action: 'oauth.authorize',
      resource: 'oauth_client',
      resourceId: client.id,
      status: 'success',
      details: { scopes: validScopes, skipConsent: true },
      ...meta,
    });

    const url = new URL(query.redirect_uri);
    url.searchParams.set('code', code);
    if (query.state) url.searchParams.set('state', query.state);
    return c.redirect(url.toString());
  }

  // Need to show consent screen
  if (query.prompt === 'none') {
    return redirectWithError('consent_required', 'User consent is required');
  }

  // Return consent page data (frontend will render consent UI)
  // For now, redirect to consent page on frontend
  const consentUrl = new URL('/oauth/consent', env.APP_URL);
  consentUrl.searchParams.set('client_id', query.client_id);
  consentUrl.searchParams.set('redirect_uri', query.redirect_uri);
  consentUrl.searchParams.set('scope', validScopes.join(' '));
  if (query.state) consentUrl.searchParams.set('state', query.state);
  if (query.code_challenge) consentUrl.searchParams.set('code_challenge', query.code_challenge);
  if (query.code_challenge_method) consentUrl.searchParams.set('code_challenge_method', query.code_challenge_method);
  if (query.nonce) consentUrl.searchParams.set('nonce', query.nonce);

  return c.redirect(consentUrl.toString());
});

// POST /oauth/authorize - Handle consent submission
const nullToUndef = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === null ? undefined : v), schema);

const authorizePostSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  scope: z.string(),
  state: nullToUndef(z.string().optional()),
  code_challenge: nullToUndef(z.string().optional()),
  code_challenge_method: nullToUndef(z.enum(['S256', 'plain']).optional()),
  nonce: nullToUndef(z.string().optional()),
  consent: z.enum(['allow', 'deny']),
  remember: z.boolean().default(true),  // Remember consent for future requests
});

oauth.post('/authorize', requireAuth, zValidator('json', authorizePostSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId')!;
  const meta = getRequestMeta(c);

  // Validate redirect URI
  const validRedirect = await validateRedirectUri(body.client_id, body.redirect_uri);
  if (!validRedirect) {
    throw new ValidationError('Invalid redirect_uri');
  }

  // Helper to build redirect URL
  const buildRedirectUrl = (params: Record<string, string>) => {
    const url = new URL(body.redirect_uri);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  };

  // Handle denial
  if (body.consent === 'deny') {
    const client = await getClientByClientId(body.client_id);

    await logAuditEvent({
      userId,
      action: 'oauth.authorize.denied',
      resource: 'oauth_client',
      resourceId: client?.id,
      status: 'success',
      ...meta,
    });

    return c.json({
      redirect: buildRedirectUrl({
        error: 'access_denied',
        error_description: 'User denied the authorization request',
        ...(body.state && { state: body.state }),
      }),
    });
  }

  // Generate authorization code
  const scopes = body.scope.split(' ').filter(Boolean);

  const code = await createAuthorizationCode({
    clientId: body.client_id,
    userId,
    redirectUri: body.redirect_uri,
    scopes,
    codeChallenge: body.code_challenge,
    codeChallengeMethod: body.code_challenge_method,
    nonce: body.nonce,
    rememberConsent: body.remember,
  });

  const client = await getClientByClientId(body.client_id);

  await logAuditEvent({
    userId,
    action: 'oauth.authorize',
    resource: 'oauth_client',
    resourceId: client?.id,
    status: 'success',
    details: { scopes },
    ...meta,
  });

  return c.json({
    redirect: buildRedirectUrl({
      code,
      ...(body.state && { state: body.state }),
    }),
  });
});

// ==================== Token Endpoint ====================

const tokenSchema = z.object({
  grant_type: z.enum([
    'authorization_code',
    'refresh_token',
    'urn:ietf:params:oauth:grant-type:device_code',
  ]),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  device_code: z.string().optional(),  // For device authorization grant
});

oauth.post('/token', strictRateLimiter, zValidator('form', tokenSchema), async (c) => {
  const body = c.req.valid('form');
  const meta = getRequestMeta(c);

  oauthLogger.debug('Token request', {
    grantType: body.grant_type,
    hasCode: !!body.code,
    hasRefreshToken: !!body.refresh_token,
  });

  // Get client credentials (from body or Basic auth header)
  let clientId = body.client_id;
  let clientSecret = body.client_secret;

  const authHeader = c.req.header('Authorization');
  if (authHeader) {
    const basicAuth = parseBasicAuth(authHeader);
    clientId = basicAuth.clientId || clientId;
    clientSecret = basicAuth.clientSecret || clientSecret;
  }

  if (!clientId) {
    return c.json({ error: 'invalid_client', error_description: 'Missing client_id' }, 401);
  }

  // Handle authorization code grant
  if (body.grant_type === 'authorization_code') {
    if (!body.code) {
      return c.json({ error: 'invalid_request', error_description: 'Missing code' }, 400);
    }
    if (!body.redirect_uri) {
      return c.json({ error: 'invalid_request', error_description: 'Missing redirect_uri' }, 400);
    }

    // Validate client credentials for confidential clients
    const { valid, client } = await validateClientCredentials(clientId, clientSecret);
    if (!valid) {
      await logAuditEvent({
        action: 'oauth.token.invalid_client',
        status: 'failure',
        details: { clientId },
        ...meta,
      });
      return c.json({ error: 'invalid_client', error_description: 'Invalid client credentials' }, 401);
    }

    const result = await exchangeAuthorizationCode(
      body.code,
      clientId,
      body.redirect_uri,
      body.code_verifier,
    );

    if (!result) {
      await logAuditEvent({
        action: 'oauth.token.invalid_code',
        status: 'failure',
        details: { clientId },
        ...meta,
      });
      return c.json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' }, 400);
    }

    await logAuditEvent({
      action: 'oauth.token.issued',
      resource: 'oauth_client',
      resourceId: client?.id,
      status: 'success',
      details: { grantType: 'authorization_code', scopes: result.scopes },
      ...meta,
    });

    // Return token response
    const response: Record<string, any> = {
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
      scope: result.scopes.join(' '),
    };

    if (result.refreshToken) {
      response.refresh_token = result.refreshToken;
    }

    if (result.idToken) {
      response.id_token = result.idToken;
    }

    return c.json(response);
  }

  // Handle refresh token grant
  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) {
      return c.json({ error: 'invalid_request', error_description: 'Missing refresh_token' }, 400);
    }

    const result = await refreshAccessToken(body.refresh_token, clientId, clientSecret);

    if (!result) {
      await logAuditEvent({
        action: 'oauth.token.invalid_refresh',
        status: 'failure',
        details: { clientId },
        ...meta,
      });
      return c.json({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' }, 400);
    }

    await logAuditEvent({
      action: 'oauth.token.refreshed',
      status: 'success',
      details: { clientId },
      ...meta,
    });

    return c.json({
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
    });
  }

  // Handle device authorization grant (RFC 8628)
  if (body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
    if (!body.device_code) {
      return c.json({ error: 'invalid_request', error_description: 'Missing device_code' }, 400);
    }

    const result = await exchangeDeviceCode(body.device_code, clientId);

    if (isDeviceTokenError(result)) {
      // Log failure for non-pending errors
      if (result.error !== 'authorization_pending' && result.error !== 'slow_down') {
        await logAuditEvent({
          action: 'oauth.token.device_error',
          status: 'failure',
          details: { clientId, error: result.error },
          ...meta,
        });
      }

      // RFC 8628 Section 3.5 - Error responses
      // authorization_pending and slow_down return 400
      // access_denied returns 400
      // expired_token returns 400
      return c.json(result, 400);
    }

    // Success - tokens issued
    await logAuditEvent({
      action: 'oauth.token.device_issued',
      status: 'success',
      details: { clientId, grantType: 'device_code', scope: result.scope },
      ...meta,
    });

    return c.json(result);
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
});

// ==================== Token Revocation ====================

const revokeSchema = z.object({
  token: z.string(),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
});

oauth.post('/revoke', zValidator('form', revokeSchema), async (c) => {
  const body = c.req.valid('form');
  const meta = getRequestMeta(c);

  // Get client credentials
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  const authHeader = c.req.header('Authorization');
  if (authHeader) {
    const basicAuth = parseBasicAuth(authHeader);
    clientId = basicAuth.clientId;
    clientSecret = basicAuth.clientSecret;
  }

  // Validate client if credentials provided
  if (clientId) {
    const { valid } = await validateClientCredentials(clientId, clientSecret);
    if (!valid) {
      return c.json({ error: 'invalid_client' }, 401);
    }
  }

  // Revoke the token (always returns success per RFC 7009)
  await revokeToken(body.token, body.token_type_hint);

  await logAuditEvent({
    action: 'oauth.token.revoked',
    status: 'success',
    details: { tokenTypeHint: body.token_type_hint },
    ...meta,
  });

  // Return 200 with empty body per spec
  return c.body(null, 200);
});

// ==================== Token Introspection (RFC 7662) ====================

const introspectSchema = z.object({
  token: z.string(),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
});

oauth.post('/introspect', strictRateLimiter, zValidator('form', introspectSchema), async (c) => {
  // Require client authentication via Basic auth
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ error: 'invalid_client', error_description: 'Client authentication required' }, 401);
  }

  const basicAuth = parseBasicAuth(authHeader);
  if (!basicAuth.clientId) {
    return c.json({ error: 'invalid_client', error_description: 'Invalid client credentials' }, 401);
  }

  const { valid } = await validateClientCredentials(basicAuth.clientId, basicAuth.clientSecret);
  if (!valid) {
    return c.json({ error: 'invalid_client', error_description: 'Invalid client credentials' }, 401);
  }

  const body = c.req.valid('form');
  const result = await introspectToken(body.token, body.token_type_hint);

  return c.json(result);
});

// ==================== UserInfo Endpoint (OIDC) ====================

oauth.get('/userinfo', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const token = authHeader.slice(7);
  const result = await validateAccessToken(token);

  if (!result.valid || !result.userId) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const user = await getUserById(result.userId);
  if (!user) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  // Build claims based on scopes
  const scopes = result.scopes || [];
  const claims: Record<string, any> = {
    sub: user.id,
  };

  if (scopes.includes('profile')) {
    claims.name = user.displayName || user.username;
    claims.preferred_username = user.username;
    claims.picture = user.avatarUrl;
    claims.updated_at = Math.floor(user.updatedAt.getTime() / 1000);
  }

  if (scopes.includes('email')) {
    claims.email = user.email;
    claims.email_verified = user.emailVerified;
  }

  return c.json(claims);
});

// ==================== OpenID Connect Discovery ====================

oauth.get('/.well-known/openid-configuration', (c) => {
  const issuer = env.API_URL;

  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    device_authorization_endpoint: `${issuer}/oauth/device/authorize`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    jwks_uri: `${issuer}/oauth/jwks`,
    scopes_supported: Object.keys(STANDARD_SCOPES),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:device_code',
    ],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'auth_time',
      'nonce',
      'name',
      'preferred_username',
      'picture',
      'email',
      'email_verified',
      'updated_at',
    ],
    code_challenge_methods_supported: ['S256'],
  });
});

// GET /oauth/clients/:clientId - Get client info for consent screen
oauth.get('/clients/:clientId', async (c) => {
  const clientId = c.req.param('clientId');
  const client = await getClientByClientId(clientId);

  if (!client) {
    return c.json({ error: 'Client not found' }, 404);
  }

  // Return public client info (no secret)
  return c.json({
    client: {
      clientId: client.clientId,
      name: client.name,
      description: client.description,
      logoUrl: client.logoUrl,
      websiteUrl: client.websiteUrl,
      privacyPolicyUrl: client.privacyPolicyUrl,
      termsOfServiceUrl: client.termsOfServiceUrl,
      isFirstParty: client.isFirstParty,
      createdAt: client.createdAt,  // When the app was registered
    },
  });
});

// GET /oauth/scopes - Get scope descriptions
oauth.get('/scopes', (c) => {
  return c.json({ scopes: STANDARD_SCOPES });
});

export { oauth as oauthRoutes };
