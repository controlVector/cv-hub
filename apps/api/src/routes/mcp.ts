import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { requireMCPAuth } from '../middleware/mcp-auth';
import {
  createMCPSession,
  getMCPSession,
  closeMCPSession,
} from '../mcp/session';
import { handleMCPRequest } from '../mcp/handler';
import type { JsonRpcRequest, JsonRpcResponse } from '../mcp/types';
import { JSON_RPC_ERRORS } from '../mcp/types';

import type { AppEnv } from '../app';

const MCP_SESSION_HEADER = 'mcp-session-id';

const mcp = new Hono<AppEnv>();

// All MCP endpoints require OAuth Bearer token auth
mcp.use('*', requireMCPAuth);

// ============================================================================
// POST /mcp — Main MCP endpoint (Streamable HTTP Transport)
// ============================================================================

mcp.post('/', async (c) => {
  const userId = c.get('userId')!;
  const scopes: string[] = (c as any).mcpScopes || [];
  const mcpClientId: string | undefined = (c as any).mcpClientId;

  // Parse the JSON-RPC request body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      makeErrorResponse(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Invalid JSON'),
      400,
    );
  }

  // Get or create session
  let sessionToken = c.req.header(MCP_SESSION_HEADER);
  let ctx = sessionToken ? await getMCPSession(sessionToken) : null;

  // If no valid session, create one (session is established on first request)
  if (!ctx) {
    sessionToken = await createMCPSession(userId, mcpClientId);
    ctx = await getMCPSession(sessionToken);
    if (!ctx) {
      return c.json(
        makeErrorResponse(null, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Failed to create session'),
        500,
      );
    }
  }

  // Attach scopes from OAuth token to session context
  ctx.scopes = scopes;

  // Handle batch requests (array of JSON-RPC messages)
  if (Array.isArray(body)) {
    return handleBatchRequest(c, body, ctx, sessionToken!);
  }

  // Single request
  if (!isValidJsonRpcRequest(body)) {
    return c.json(
      makeErrorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC request'),
      400,
    );
  }

  const response = await handleMCPRequest(body as JsonRpcRequest, ctx, sessionToken!);

  // Set session header on response
  c.header(MCP_SESSION_HEADER, sessionToken!);

  // Notifications return 202 with no body
  if (response === null) {
    return c.body(null, 202);
  }

  return c.json(response);
});

// ============================================================================
// GET /mcp — SSE endpoint for server-initiated notifications
// ============================================================================

mcp.get('/', async (c) => {
  const sessionToken = c.req.header(MCP_SESSION_HEADER);
  if (!sessionToken) {
    return c.json({ error: 'Missing Mcp-Session-Id header' }, 400);
  }

  const ctx = await getMCPSession(sessionToken);
  if (!ctx) {
    return c.json({ error: 'Invalid or expired session' }, 404);
  }

  // Return an SSE stream that stays open for server-initiated messages.
  // For now, this is a keep-alive stream — actual notifications will be
  // added when we implement server push (e.g., task status updates).
  return streamSSE(c, async (stream) => {
    c.header(MCP_SESSION_HEADER, sessionToken);

    // Send initial comment to establish connection
    await stream.writeSSE({ event: 'ping', data: '{}' });

    // Keep the stream alive with periodic pings
    const interval = setInterval(async () => {
      try {
        await stream.writeSSE({ event: 'ping', data: '{}' });
      } catch {
        clearInterval(interval);
      }
    }, 30_000);

    // Clean up on close
    stream.onAbort(() => {
      clearInterval(interval);
    });

    // Hold the stream open (will be closed by client disconnect or abort)
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  });
});

// ============================================================================
// DELETE /mcp — Close session
// ============================================================================

mcp.delete('/', async (c) => {
  const sessionToken = c.req.header(MCP_SESSION_HEADER);
  if (!sessionToken) {
    return c.json({ error: 'Missing Mcp-Session-Id header' }, 400);
  }

  await closeMCPSession(sessionToken);

  return c.body(null, 204);
});

// ============================================================================
// Helpers
// ============================================================================

function isValidJsonRpcRequest(body: unknown): body is JsonRpcRequest {
  if (!body || typeof body !== 'object') return false;
  const obj = body as Record<string, unknown>;
  return (
    obj.jsonrpc === '2.0' &&
    typeof obj.method === 'string'
  );
}

function makeErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

async function handleBatchRequest(
  c: any,
  batch: unknown[],
  ctx: any,
  sessionToken: string,
) {
  const responses: JsonRpcResponse[] = [];

  for (const item of batch) {
    if (!isValidJsonRpcRequest(item)) {
      responses.push(
        makeErrorResponse(
          null,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          'Invalid JSON-RPC request in batch',
        ),
      );
      continue;
    }

    const response = await handleMCPRequest(item as JsonRpcRequest, ctx, sessionToken);
    if (response !== null) {
      responses.push(response);
    }
  }

  c.header(MCP_SESSION_HEADER, sessionToken);

  // If all were notifications, return 202
  if (responses.length === 0) {
    return c.body(null, 202);
  }

  return c.json(responses);
}

export { mcp as mcpRoutes };
