/**
 * MCP Gateway Route
 *
 * Handles MCP Streamable HTTP transport at POST /mcp.
 * Stateless — each request creates a fresh McpServer + transport.
 *
 * Auth: Bearer token (PAT → JWT → OAuth), same as CLI API.
 * On 401: returns WWW-Authenticate header to trigger Claude.ai OAuth flow.
 *
 * Note on Hono ↔ MCP SDK bridge:
 *   The MCP SDK writes directly to the Node.js ServerResponse (c.env.outgoing).
 *   After that, @hono/node-server checks outgoing.writableEnded before trying to
 *   write Hono's Response, so the empty Response we return is safely ignored.
 */

import { Hono } from 'hono';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../mcp/server';
import { createRateLimiter } from '../middleware/rate-limit';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Services for auth
import * as patService from '../services/pat.service';
import * as tokenService from '../services/token.service';
import * as oauthService from '../services/oauth.service';

// ── Types ─────────────────────────────────────────────────────────────

type McpEnv = {
  Variables: {
    userId: string;
    tokenScopes: string[];
  };
  Bindings: {
    incoming: IncomingMessage;
    outgoing: ServerResponse;
  };
};

// ── Rate limiter ──────────────────────────────────────────────────────

const mcpRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 200,
});

// ── Auth middleware ────────────────────────────────────────────────────

const RESOURCE_METADATA_URL = `${env.API_URL}/.well-known/oauth-protected-resource`;

async function mcpAuth(c: any, next: () => Promise<void>) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    // Return 401 with WWW-Authenticate to trigger Claude.ai OAuth discovery
    c.header(
      'WWW-Authenticate',
      `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`,
    );
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);

  // 1. PAT (cv_pat_*)
  if (token.startsWith('cv_pat_')) {
    const result = await patService.validateToken(token);
    if (!result.valid || !result.userId) {
      c.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="invalid_token"`,
      );
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
    c.set('userId', result.userId);
    c.set('tokenScopes', result.scopes ?? []);
    return next();
  }

  // 2. JWT session token
  try {
    const payload = await tokenService.verifyAccessToken(token);
    c.set('userId', payload.sub);
    c.set('tokenScopes', [
      'repo:read', 'repo:write', 'repo:admin',
      'user:read', 'user:write',
      'org:read', 'org:write',
    ]);
    return next();
  } catch {
    // Not a valid JWT — fall through to OAuth
  }

  // 3. OAuth access token
  const oauthResult = await oauthService.validateAccessToken(token);
  if (oauthResult.valid && oauthResult.userId) {
    c.set('userId', oauthResult.userId);
    c.set('tokenScopes', oauthResult.scopes ?? []);
    return next();
  }

  c.header(
    'WWW-Authenticate',
    `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="invalid_token"`,
  );
  return c.json({ error: 'Invalid or expired token' }, 401);
}

// ── Route ─────────────────────────────────────────────────────────────

export const mcpGateway = new Hono<McpEnv>();

// Rate limiting
mcpGateway.use('*', mcpRateLimiter as any);

// Auth on all methods
mcpGateway.use('*', mcpAuth as any);

// ── POST /mcp ─────────────────────────────────────────────────────────
mcpGateway.post('/', async (c) => {
  const userId = c.get('userId');
  const scopes = c.get('tokenScopes');
  const startTime = Date.now();

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    }, 400);
  }

  // Log the request method for observability
  const method = body?.method ?? 'unknown';
  const toolName = body?.params?.name ?? null;

  try {
    // Create per-request MCP server + transport (stateless)
    const mcpServer = createMcpServer(userId, scopes);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no sessions
    });

    // Connect server to transport
    await mcpServer.connect(transport);

    // Get raw Node.js req/res from Hono's node-server bindings
    const nodeReq = c.env.incoming;
    const nodeRes = c.env.outgoing;

    // Let the MCP SDK handle the request/response directly.
    // After this call, nodeRes.writableEnded will be true.
    await transport.handleRequest(nodeReq, nodeRes, body);

    // Clean up the transport connection
    await transport.close();

    const duration = Date.now() - startTime;
    logger.info('api', 'MCP request', {
      userId,
      method,
      tool: toolName,
      duration: `${duration}ms`,
    });
  } catch (err: any) {
    const duration = Date.now() - startTime;
    logger.error('api', 'MCP request failed', {
      userId,
      method,
      tool: toolName,
      duration: `${duration}ms`,
      error: err.message,
    });

    // If the response wasn't already sent by the SDK, send a JSON-RPC error
    const nodeRes = c.env.outgoing;
    if (!nodeRes.writableEnded) {
      return c.json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: body?.id ?? null,
      }, 500);
    }
  }

  // The SDK already wrote to nodeRes. @hono/node-server checks
  // outgoing.writableEnded before writing, so this empty response is a no-op.
  return new Response(null);
});

// ── GET /mcp → 405 (no SSE in stateless mode) ────────────────────────
mcpGateway.get('/', (c) =>
  c.json({ error: 'Method not allowed. Use POST for MCP requests.' }, 405),
);

// ── DELETE /mcp → 405 (no sessions in stateless mode) ─────────────────
mcpGateway.delete('/', (c) =>
  c.json({ error: 'Method not allowed. Sessions are not supported.' }, 405),
);
