import type { Context, Next } from 'hono';
import { validateMCPAccessToken, hasMCPScope } from '../services/mcp-oauth.service';
import type { AppEnv } from '../app';

/**
 * Middleware that validates OAuth Bearer tokens for MCP endpoints.
 * Sets userId in context if valid. Rejects with 401 if invalid.
 */
export async function requireMCPAuth(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: 'invalid_token',
        error_description: 'Missing or invalid Bearer token',
      },
      401,
    );
  }

  const token = authHeader.slice(7);
  const result = await validateMCPAccessToken(token);

  if (!result.valid || !result.userId) {
    return c.json(
      {
        error: 'invalid_token',
        error_description: 'Token is invalid or expired',
      },
      401,
    );
  }

  // Set userId in context for downstream handlers
  c.set('userId', result.userId);

  // Store scopes and clientId for downstream scope checks
  (c as any).mcpScopes = result.scopes || [];
  (c as any).mcpClientId = result.clientId;

  await next();
}

/**
 * Factory: creates middleware that requires a specific MCP scope.
 * Must be used after requireMCPAuth.
 */
export function requireMCPScope(scope: string) {
  return async (c: Context<AppEnv>, next: Next) => {
    const scopes: string[] = (c as any).mcpScopes || [];

    if (!hasMCPScope(scopes, scope)) {
      return c.json(
        {
          error: 'insufficient_scope',
          error_description: `Required scope: ${scope}`,
        },
        403,
      );
    }

    await next();
  };
}
