import { eq } from 'drizzle-orm';
import { db } from '../db';
import { oauthClients } from '../db/schema';
import { hashToken, generateSecureToken } from '../utils/crypto';
import { oauthLogger } from '../utils/logger';

// MCP-specific scope defaults for dynamically registered clients
export const MCP_DEFAULT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'mcp:tools',
  'mcp:tasks',
  'mcp:threads',
];

export const MCP_ALL_SCOPES = [
  ...MCP_DEFAULT_SCOPES,
  'mcp:execute',
  'repo:read',
  'repo:write',
  'repo:admin',
];

// ==================== Dynamic Client Registration (RFC 7591) ====================

export interface ClientRegistrationRequest {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
  logo_uri?: string;
  client_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
}

export interface ClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string;
  token_endpoint_auth_method: string;
}

export async function registerMCPClient(
  request: ClientRegistrationRequest,
): Promise<ClientRegistrationResponse> {
  // Validate redirect URIs
  if (!request.redirect_uris || request.redirect_uris.length === 0) {
    throw new Error('redirect_uris is required');
  }

  for (const uri of request.redirect_uris) {
    try {
      new URL(uri);
    } catch {
      throw new Error(`Invalid redirect_uri: ${uri}`);
    }
  }

  // Determine grant types (default to authorization_code + refresh_token)
  const grantTypes = request.grant_types || ['authorization_code', 'refresh_token'];
  const responseTypes = request.response_types || ['code'];

  // Determine auth method
  const authMethod = request.token_endpoint_auth_method || 'client_secret_post';
  const isConfidential = authMethod !== 'none';

  // Parse and validate requested scopes
  const requestedScopes = request.scope
    ? request.scope.split(' ').filter(Boolean)
    : MCP_DEFAULT_SCOPES;

  const validScopes = requestedScopes.filter((s) => MCP_ALL_SCOPES.includes(s));
  const scopes = validScopes.length > 0 ? validScopes : MCP_DEFAULT_SCOPES;

  // Generate client credentials
  const clientId = generateSecureToken(16);
  let clientSecret: string | undefined;
  let clientSecretHash: string | undefined;

  if (isConfidential) {
    clientSecret = generateSecureToken(32);
    clientSecretHash = hashToken(clientSecret);
  }

  // Store the client
  await db.insert(oauthClients).values({
    clientId,
    clientSecretHash,
    name: request.client_name,
    description: `Dynamically registered MCP client`,
    redirectUris: request.redirect_uris,
    websiteUrl: request.client_uri,
    logoUrl: request.logo_uri,
    privacyPolicyUrl: request.policy_uri,
    termsOfServiceUrl: request.tos_uri,
    isConfidential,
    isFirstParty: false,
    allowedScopes: scopes,
    allowedGrantTypes: grantTypes,
    requirePkce: true, // OAuth 2.1: always require PKCE
    isActive: true,
  });

  oauthLogger.info('MCP client registered dynamically', {
    clientId,
    clientName: request.client_name,
    scopes,
    grantTypes,
  });

  return {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0, // Never expires
    client_name: request.client_name,
    redirect_uris: request.redirect_uris,
    grant_types: grantTypes,
    response_types: responseTypes,
    scope: scopes.join(' '),
    token_endpoint_auth_method: authMethod,
  };
}

// ==================== MCP OAuth Token Validation ====================

/**
 * Validate an OAuth access token and return the user + scopes.
 * Used by MCP endpoints to authenticate requests.
 */
export async function validateMCPAccessToken(token: string): Promise<{
  valid: boolean;
  userId?: string;
  clientId?: string;
  scopes?: string[];
}> {
  // Re-use the existing validateAccessToken logic
  const { validateAccessToken } = await import('./oauth.service');
  return validateAccessToken(token);
}

/**
 * Check if the given scopes include the required MCP scope.
 */
export function hasMCPScope(
  grantedScopes: string[],
  requiredScope: string,
): boolean {
  return grantedScopes.includes(requiredScope);
}
