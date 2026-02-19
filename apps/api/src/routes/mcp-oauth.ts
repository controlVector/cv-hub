import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { env } from '../config/env';
import { brand } from '../config/brand';
import { registerMCPClient, MCP_ALL_SCOPES } from '../services/mcp-oauth.service';
import { STANDARD_SCOPES } from '../services/oauth.service';
import { logAuditEvent, type AuditAction } from '../services/audit.service';
import { strictRateLimiter } from '../middleware/rate-limit';

import type { AppEnv } from '../app';

const mcpOAuth = new Hono<AppEnv>();

// ==================== Dynamic Client Registration (RFC 7591) ====================

const registerClientSchema = z.object({
  client_name: z.string().min(1).max(100),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
  token_endpoint_auth_method: z
    .enum(['client_secret_post', 'client_secret_basic', 'none'])
    .optional(),
  logo_uri: z.string().url().optional(),
  client_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  tos_uri: z.string().url().optional(),
});

mcpOAuth.post(
  '/register',
  strictRateLimiter,
  zValidator('json', registerClientSchema),
  async (c) => {
    const body = c.req.valid('json');

    try {
      const result = await registerMCPClient(body);

      // Log audit event (no user context for dynamic registration)
      await logAuditEvent({
        action: 'oauth.client.dynamic_register' as AuditAction,
        resource: 'oauth_client',
        status: 'success',
        details: {
          clientId: result.client_id,
          clientName: body.client_name,
          grantTypes: result.grant_types,
        },
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
        userAgent: c.req.header('user-agent'),
      });

      return c.json(result, 201);
    } catch (error: any) {
      return c.json(
        {
          error: 'invalid_client_metadata',
          error_description: error.message || 'Invalid client metadata',
        },
        400,
      );
    }
  },
);

// ==================== Protected Resource Metadata (RFC 9728) ====================
// MCP spec: The MCP server exposes this so clients know where to authenticate.

mcpOAuth.get('/.well-known/oauth-protected-resource', (c) => {
  const mcpServerUrl = `https://mcp.${brand.domain}`;
  const authServerUrl = env.API_URL;

  return c.json({
    resource: mcpServerUrl,
    authorization_servers: [authServerUrl],
    scopes_supported: MCP_ALL_SCOPES,
    bearer_methods_supported: ['header'],
  });
});

// ==================== MCP-Enhanced OIDC Discovery ====================
// This supplements the main /.well-known/openid-configuration with MCP-specific info.

mcpOAuth.get('/.well-known/openid-configuration', (c) => {
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
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
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

export { mcpOAuth as mcpOAuthRoutes };
