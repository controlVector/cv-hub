/**
 * End-to-End MCP OAuth + Transport Integration Test
 * Simulates the full Claude.ai → CV-Hub connection lifecycle:
 *   1. Dynamic Client Registration (RFC 7591)
 *   2. Authorization code with PKCE
 *   3. Token exchange
 *   4. MCP session creation + initialize handshake
 *   5. tools/list + tools/call
 *   6. Token refresh (rotation)
 *   7. Old token revocation
 *   8. Session close
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { registerMCPClient, validateMCPAccessToken } from './mcp-oauth.service';
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  validateAccessToken,
  refreshAccessToken,
  revokeToken,
} from './oauth.service';
import {
  createMCPSession,
  getMCPSession,
  closeMCPSession,
} from '../mcp/session';
import {
  handleMCPRequest,
  registerTool,
  getRegisteredTools,
} from '../mcp/handler';
import { MCP_VERSION } from '../mcp/types';
import type { JsonRpcRequest } from '../mcp/types';
import { generateSecureToken } from '../utils/crypto';
import { createTestUserWithPassword, truncateAllTables } from '../test/test-db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;
function uid() { return `${Date.now()}_${++seq}`; }

function rpc(method: string, id: number, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params } as JsonRpcRequest;
}

function generatePKCE() {
  const codeVerifier = generateSecureToken(32);
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

// ---------------------------------------------------------------------------
// E2E Test
// ---------------------------------------------------------------------------

describe('MCP OAuth End-to-End Flow', () => {
  // Register a test tool so tools/list and tools/call have something to exercise
  beforeEach(() => {
    registerTool(
      {
        name: 'e2e_ping',
        description: 'Simple ping tool for E2E testing',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => ({
        content: [{ type: 'text', text: 'pong' }],
      }),
    );
  });

  it('completes the full Claude.ai connection lifecycle', async () => {
    // ---------------------------------------------------------------
    // 0. Create a test user (the person who will authorize Claude.ai)
    // ---------------------------------------------------------------
    const user = await createTestUserWithPassword({
      username: `e2e_user_${uid()}`,
      email: `e2e_${uid()}@test.com`,
    });

    // ---------------------------------------------------------------
    // 1. Dynamic Client Registration (RFC 7591)
    //    Claude.ai registers itself as an MCP client.
    // ---------------------------------------------------------------
    const registration = await registerMCPClient({
      client_name: 'Claude.ai E2E',
      redirect_uris: ['https://claude.ai/oauth/callback'],
      scope: 'openid profile email offline_access mcp:tools mcp:tasks',
    });

    expect(registration.client_id).toBeDefined();
    expect(registration.client_secret).toBeDefined();
    expect(registration.grant_types).toContain('authorization_code');
    expect(registration.scope).toContain('mcp:tools');

    const clientId = registration.client_id;
    const clientSecret = registration.client_secret!;

    // ---------------------------------------------------------------
    // 2. Create authorization code with PKCE challenge
    //    (simulates user clicking "Authorize" on the consent page)
    // ---------------------------------------------------------------
    const { codeVerifier, codeChallenge } = generatePKCE();

    const authCode = await createAuthorizationCode({
      clientId,
      userId: user.id,
      redirectUri: 'https://claude.ai/oauth/callback',
      scopes: ['openid', 'profile', 'email', 'offline_access', 'mcp:tools', 'mcp:tasks'],
      codeChallenge,
      codeChallengeMethod: 'S256',
    });

    expect(authCode).toBeDefined();

    // ---------------------------------------------------------------
    // 3. Exchange code for tokens (verify PKCE)
    // ---------------------------------------------------------------
    const tokens = await exchangeAuthorizationCode(
      authCode,
      clientId,
      'https://claude.ai/oauth/callback',
      codeVerifier,
    );

    expect(tokens).not.toBeNull();
    expect(tokens!.accessToken).toBeDefined();
    expect(tokens!.refreshToken).toBeDefined();
    expect(tokens!.idToken).toBeDefined(); // openid scope
    expect(tokens!.tokenType).toBe('Bearer');
    expect(tokens!.expiresIn).toBeGreaterThan(0);

    const accessToken = tokens!.accessToken;
    const refreshToken = tokens!.refreshToken!;

    // ---------------------------------------------------------------
    // 4. Validate access token via MCP auth cascade
    // ---------------------------------------------------------------
    const authResult = await validateMCPAccessToken(accessToken);
    expect(authResult.valid).toBe(true);
    expect(authResult.userId).toBe(user.id);

    // ---------------------------------------------------------------
    // 5. Create MCP session with the authenticated user
    // ---------------------------------------------------------------
    const sessionToken = await createMCPSession(user.id);
    expect(sessionToken).toBeDefined();

    const sessionCtx = await getMCPSession(sessionToken);
    expect(sessionCtx).not.toBeNull();
    expect(sessionCtx!.userId).toBe(user.id);

    // ---------------------------------------------------------------
    // 6. Initialize handshake (JSON-RPC)
    // ---------------------------------------------------------------
    const initRes = await handleMCPRequest(
      rpc('initialize', 1, {
        protocolVersion: MCP_VERSION,
        capabilities: {},
        clientInfo: { name: 'claude-ai', version: '1.0' },
      }),
      sessionCtx!,
      sessionToken,
    );

    expect(initRes).not.toBeNull();
    expect(initRes!.error).toBeUndefined();
    const initResult = initRes!.result as any;
    expect(initResult.protocolVersion).toBe(MCP_VERSION);
    expect(initResult.serverInfo.name).toContain('MCP Server');

    // Session should now be initialized
    const updatedCtx = await getMCPSession(sessionToken);
    expect(updatedCtx!.initialized).toBe(true);

    // ---------------------------------------------------------------
    // 7. tools/list — verify tools are returned
    // ---------------------------------------------------------------
    const listRes = await handleMCPRequest(
      rpc('tools/list', 2),
      updatedCtx!,
      sessionToken,
    );

    expect(listRes).not.toBeNull();
    const listResult = listRes!.result as any;
    expect(listResult.tools).toBeInstanceOf(Array);
    expect(listResult.tools.length).toBeGreaterThan(0);

    const toolNames = listResult.tools.map((t: any) => t.name);
    expect(toolNames).toContain('e2e_ping');

    // ---------------------------------------------------------------
    // 8. tools/call — execute a tool
    // ---------------------------------------------------------------
    const callRes = await handleMCPRequest(
      rpc('tools/call', 3, {
        name: 'e2e_ping',
        arguments: {},
      }),
      updatedCtx!,
      sessionToken,
    );

    expect(callRes).not.toBeNull();
    expect(callRes!.error).toBeUndefined();
    const callResult = callRes!.result as any;
    expect(callResult.content[0].text).toBe('pong');

    // ---------------------------------------------------------------
    // 9. Refresh token — get new access token
    // ---------------------------------------------------------------
    const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret);

    expect(refreshed).not.toBeNull();
    expect(refreshed!.accessToken).toBeDefined();
    expect(refreshed!.refreshToken).toBeDefined();
    expect(refreshed!.accessToken).not.toBe(accessToken);

    const newAccessToken = refreshed!.accessToken;

    // ---------------------------------------------------------------
    // 10. Validate new access token works
    // ---------------------------------------------------------------
    const newAuthResult = await validateMCPAccessToken(newAccessToken);
    expect(newAuthResult.valid).toBe(true);
    expect(newAuthResult.userId).toBe(user.id);

    // ---------------------------------------------------------------
    // 11. Revoke old access token — verify it's invalid
    // ---------------------------------------------------------------
    await revokeToken(accessToken, 'access_token');

    const revokedResult = await validateAccessToken(accessToken);
    expect(revokedResult.valid).toBe(false);

    // New token still works
    const stillValid = await validateAccessToken(newAccessToken);
    expect(stillValid.valid).toBe(true);

    // ---------------------------------------------------------------
    // 12. Close MCP session — verify it's closed
    // ---------------------------------------------------------------
    await closeMCPSession(sessionToken);

    const closedCtx = await getMCPSession(sessionToken);
    expect(closedCtx).toBeNull();
  });
});
