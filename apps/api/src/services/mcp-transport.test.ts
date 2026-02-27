/**
 * MCP Transport, Session Management, and Auth Validation Tests
 * Tests: session CRUD, JSON-RPC handler dispatch, tool registry, auth cascade.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { mcpSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  createMCPSession,
  getMCPSession,
  closeMCPSession,
  markSessionInitialized,
} from '../mcp/session';
import {
  handleMCPRequest,
  registerTool,
  getRegisteredTools,
} from '../mcp/handler';
import { JSON_RPC_ERRORS, MCP_VERSION } from '../mcp/types';
import type { JsonRpcRequest, MCPSessionContext } from '../mcp/types';
import {
  validateMCPAccessToken,
  registerMCPClient,
} from './mcp-oauth.service';
import {
  createOAuthClient,
  createAuthorizationCode,
  exchangeAuthorizationCode,
} from './oauth.service';
import { generateSecureToken } from '../utils/crypto';
import { createHash } from 'crypto';
import {
  truncateAllTables,
  createTestUserWithPassword,
} from '../test/test-db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;
function uid() { return `${Date.now()}_${++seq}`; }

async function createUser() {
  return createTestUserWithPassword({
    username: `mcp_user_${uid()}`,
    email: `mcp_${uid()}@test.com`,
  });
}

function mockCtx(overrides: Partial<MCPSessionContext> = {}): MCPSessionContext {
  return {
    sessionId: 'test-session-id',
    userId: 'test-user-id',
    scopes: ['mcp:tools', 'mcp:tasks'],
    initialized: true,
    ...overrides,
  };
}

function rpcRequest(method: string, id?: string | number, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params } as JsonRpcRequest;
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

describe('MCP Session Management', () => {
  describe('createMCPSession', () => {
    it('creates a session and returns a token', async () => {
      const user = await createUser();
      const token = await createMCPSession(user.id);

      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);

      // Verify it's persisted in DB
      const row = await db.query.mcpSessions.findFirst({
        where: eq(mcpSessions.sessionToken, token),
      });
      expect(row).toBeDefined();
      expect(row!.userId).toBe(user.id);
      expect(row!.status).toBe('active');
    });
  });

  describe('getMCPSession', () => {
    it('returns valid session context', async () => {
      const user = await createUser();
      const token = await createMCPSession(user.id);

      const ctx = await getMCPSession(token);

      expect(ctx).not.toBeNull();
      expect(ctx!.userId).toBe(user.id);
      expect(ctx!.initialized).toBe(false);
    });

    it('returns null for expired session', async () => {
      const user = await createUser();
      const token = await createMCPSession(user.id);

      // Manually expire the session
      await db
        .update(mcpSessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(mcpSessions.sessionToken, token));

      const ctx = await getMCPSession(token);
      expect(ctx).toBeNull();
    });

    it('returns null for nonexistent session', async () => {
      const ctx = await getMCPSession('nonexistent_token');
      expect(ctx).toBeNull();
    });
  });

  describe('closeMCPSession', () => {
    it('marks session closed', async () => {
      const user = await createUser();
      const token = await createMCPSession(user.id);

      await closeMCPSession(token);

      // Session should no longer be retrievable
      const ctx = await getMCPSession(token);
      expect(ctx).toBeNull();

      // Verify status in DB
      const row = await db.query.mcpSessions.findFirst({
        where: eq(mcpSessions.sessionToken, token),
      });
      expect(row!.status).toBe('closed');
    });
  });

  describe('markSessionInitialized', () => {
    it('marks session as initialized', async () => {
      const user = await createUser();
      const token = await createMCPSession(user.id);

      // Before: not initialized
      let ctx = await getMCPSession(token);
      expect(ctx!.initialized).toBe(false);

      markSessionInitialized(token);

      // After: initialized
      ctx = await getMCPSession(token);
      expect(ctx!.initialized).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// JSON-RPC Handler
// ---------------------------------------------------------------------------

describe('MCP JSON-RPC Handler', () => {
  // Register a test tool for handler tests
  beforeEach(() => {
    registerTool(
      {
        name: 'test_echo',
        description: 'Echo back the input',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
      },
      async (args) => ({
        content: [{ type: 'text', text: `echo: ${args.message}` }],
      }),
    );
  });

  describe('handleMCPRequest — initialize', () => {
    it('returns server info and capabilities', async () => {
      const ctx = mockCtx({ initialized: false });
      const req = rpcRequest('initialize', 1, {
        protocolVersion: MCP_VERSION,
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0' },
      });

      const res = await handleMCPRequest(req, ctx, 'test-token');

      expect(res).not.toBeNull();
      expect(res!.result).toBeDefined();
      const result = res!.result as any;
      expect(result.protocolVersion).toBe(MCP_VERSION);
      expect(result.serverInfo.name).toContain('MCP Server');
      expect(result.serverInfo.version).toBe('1.0.0');
      expect(result.capabilities.tools).toBeDefined();
    });
  });

  describe('handleMCPRequest — tools/list', () => {
    it('returns registered tools', async () => {
      const ctx = mockCtx();
      const req = rpcRequest('tools/list', 2);

      const res = await handleMCPRequest(req, ctx, 'test-token');

      expect(res).not.toBeNull();
      const result = res!.result as any;
      expect(result.tools).toBeInstanceOf(Array);
      expect(result.tools.length).toBeGreaterThan(0);

      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('test_echo');
    });
  });

  describe('handleMCPRequest — tools/call', () => {
    it('valid tool returns result', async () => {
      const ctx = mockCtx();
      const req = rpcRequest('tools/call', 3, {
        name: 'test_echo',
        arguments: { message: 'hello' },
      });

      const res = await handleMCPRequest(req, ctx, 'test-token');

      expect(res).not.toBeNull();
      expect(res!.error).toBeUndefined();
      const result = res!.result as any;
      expect(result.content[0].text).toBe('echo: hello');
    });

    it('unknown tool returns error result (caught by handler)', async () => {
      const ctx = mockCtx();
      const req = rpcRequest('tools/call', 4, {
        name: 'nonexistent_tool',
        arguments: {},
      });

      const res = await handleMCPRequest(req, ctx, 'test-token');

      expect(res).not.toBeNull();
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
      expect(res!.error!.message).toContain('Unknown tool');
    });

    it('missing tool name returns error', async () => {
      const ctx = mockCtx();
      const req = rpcRequest('tools/call', 5, {
        arguments: {},
      });

      const res = await handleMCPRequest(req, ctx, 'test-token');

      expect(res).not.toBeNull();
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
    });
  });

  describe('handleMCPRequest — ping', () => {
    it('returns empty result', async () => {
      const ctx = mockCtx();
      const req = rpcRequest('ping', 6);

      const res = await handleMCPRequest(req, ctx, 'test-token');

      expect(res).not.toBeNull();
      expect(res!.result).toEqual({});
      expect(res!.error).toBeUndefined();
    });
  });

  describe('handleMCPRequest — unknown method', () => {
    it('returns METHOD_NOT_FOUND error', async () => {
      const ctx = mockCtx();
      const req = rpcRequest('nonexistent/method', 7);

      const res = await handleMCPRequest(req, ctx, 'test-token');

      expect(res).not.toBeNull();
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
    });
  });

  describe('handleMCPRequest — notification (no id)', () => {
    it('returns null for notifications', async () => {
      const ctx = mockCtx();
      const req: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      };

      const res = await handleMCPRequest(req, ctx, 'test-token');
      expect(res).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

describe('Tool Registry', () => {
  it('getRegisteredTools returns all registered tools', () => {
    registerTool(
      {
        name: 'test_registry_tool',
        description: 'A tool for testing',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );

    const tools = getRegisteredTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('test_registry_tool');
  });
});

// ---------------------------------------------------------------------------
// MCP Access Token Validation (auth cascade)
// ---------------------------------------------------------------------------

describe('validateMCPAccessToken', () => {
  it('validates an OAuth access token via cascade', async () => {
    const user = await createUser();
    const { clientId } = await createOAuthClient({
      name: `Transport Test Client ${uid()}`,
      redirectUris: ['https://example.com/callback'],
      isConfidential: false,
    });

    const code = await createAuthorizationCode({
      clientId,
      userId: user.id,
      redirectUri: 'https://example.com/callback',
      scopes: ['openid', 'mcp:tools'],
    });

    const tokens = await exchangeAuthorizationCode(
      code,
      clientId,
      'https://example.com/callback',
    );

    const result = await validateMCPAccessToken(tokens!.accessToken);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe(user.id);
  });

  it('invalid token returns false', async () => {
    const result = await validateMCPAccessToken('completely_invalid_token');
    expect(result.valid).toBe(false);
  });
});
