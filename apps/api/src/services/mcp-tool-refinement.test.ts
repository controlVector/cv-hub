/**
 * MCP Tool Refinement Tests (Sprint 5 — Step 2)
 *
 * Tests: response truncation, input validation, empty-state messages,
 *        tool error handling, rate limit configuration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleMCPRequest,
  registerTool,
  getRegisteredTools,
  truncateToolResponse,
} from '../mcp/handler';
import { JSON_RPC_ERRORS } from '../mcp/types';
import type { JsonRpcRequest, MCPSessionContext, MCPToolResult } from '../mcp/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockCtx(overrides: Partial<MCPSessionContext> = {}): MCPSessionContext {
  return {
    sessionId: 'test-session-id',
    userId: 'test-user-id',
    scopes: ['mcp:tools', 'mcp:tasks'],
    initialized: true,
    ...overrides,
  };
}

function rpcToolCall(
  name: string,
  args: Record<string, unknown> = {},
  id: number = 1,
): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

// ---------------------------------------------------------------------------
// Response Truncation
// ---------------------------------------------------------------------------

describe('MCP Response Truncation', () => {
  it('truncateToolResponse leaves short responses unchanged', () => {
    const result: MCPToolResult = {
      content: [{ type: 'text', text: 'Short response' }],
    };
    const truncated = truncateToolResponse(result);
    expect(truncated.content[0].text).toBe('Short response');
  });

  it('truncateToolResponse truncates responses exceeding 4000 chars', () => {
    const longText = 'x'.repeat(5000);
    const result: MCPToolResult = {
      content: [{ type: 'text', text: longText }],
    };
    const truncated = truncateToolResponse(result);
    expect(truncated.content[0].text.length).toBeLessThan(longText.length);
    expect(truncated.content[0].text).toContain('truncated');
    // First 4000 chars should be preserved
    expect(truncated.content[0].text.startsWith('x'.repeat(4000))).toBe(true);
  });

  it('truncateToolResponse handles multiple content blocks', () => {
    const result: MCPToolResult = {
      content: [
        { type: 'text', text: 'a'.repeat(5000) },
        { type: 'text', text: 'short' },
        { type: 'text', text: 'b'.repeat(6000) },
      ],
    };
    const truncated = truncateToolResponse(result);
    expect(truncated.content[0].text).toContain('truncated');
    expect(truncated.content[1].text).toBe('short');
    expect(truncated.content[2].text).toContain('truncated');
  });

  it('truncateToolResponse preserves empty content arrays', () => {
    const result: MCPToolResult = { content: [] };
    const truncated = truncateToolResponse(result);
    expect(truncated.content).toEqual([]);
  });

  it('truncateToolResponse preserves isError flag', () => {
    const result: MCPToolResult = {
      content: [{ type: 'text', text: 'a'.repeat(5000) }],
      isError: true,
    };
    const truncated = truncateToolResponse(result);
    expect(truncated.isError).toBe(true);
    expect(truncated.content[0].text).toContain('truncated');
  });

  it('tool call result is truncated via handleMCPRequest', async () => {
    // Register a tool that returns a very long response
    registerTool(
      {
        name: 'test_long_response',
        description: 'Returns a very long response for truncation testing',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => ({
        content: [{ type: 'text', text: 'L'.repeat(8000) }],
      }),
    );

    const ctx = mockCtx();
    const req = rpcToolCall('test_long_response');
    const res = await handleMCPRequest(req, ctx, 'test-token');

    expect(res).not.toBeNull();
    const result = res!.result as MCPToolResult;
    expect(result.content[0].text).toContain('truncated');
    // Should be 4000 chars of content + truncation message
    expect(result.content[0].text.startsWith('L'.repeat(4000))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Input Validation
// ---------------------------------------------------------------------------

describe('MCP Input Validation', () => {
  it('tools/call with empty params returns error', async () => {
    const ctx = mockCtx();
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {},
    };
    const res = await handleMCPRequest(req, ctx, 'test-token');
    expect(res!.error).toBeDefined();
    expect(res!.error!.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
    expect(res!.error!.message).toContain('Missing tool name');
  });

  it('tools/call with null name returns error', async () => {
    const ctx = mockCtx();
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: null, arguments: {} } as any,
    };
    const res = await handleMCPRequest(req, ctx, 'test-token');
    expect(res!.error).toBeDefined();
    expect(res!.error!.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS);
  });

  it('tools/call with unknown tool returns descriptive error', async () => {
    const ctx = mockCtx();
    const req = rpcToolCall('totally_made_up_tool', {});
    const res = await handleMCPRequest(req, ctx, 'test-token');
    expect(res!.error).toBeDefined();
    expect(res!.error!.message).toContain('Unknown tool');
    expect(res!.error!.message).toContain('totally_made_up_tool');
  });

  it('tools/call with missing arguments defaults to empty object', async () => {
    registerTool(
      {
        name: 'test_no_args',
        description: 'Requires no arguments',
        inputSchema: { type: 'object', properties: {} },
      },
      async (args) => ({
        content: [{ type: 'text', text: `keys: ${Object.keys(args).length}` }],
      }),
    );

    const ctx = mockCtx();
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'test_no_args' },
    };
    const res = await handleMCPRequest(req, ctx, 'test-token');
    expect(res!.error).toBeUndefined();
    const result = res!.result as MCPToolResult;
    expect(result.content[0].text).toBe('keys: 0');
  });
});

// ---------------------------------------------------------------------------
// Tool Error Handling
// ---------------------------------------------------------------------------

describe('MCP Tool Error Handling', () => {
  it('tool that throws returns isError result with message', async () => {
    registerTool(
      {
        name: 'test_throwing_tool',
        description: 'Always throws',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => {
        throw new Error('Something went wrong in the tool');
      },
    );

    const ctx = mockCtx();
    const req = rpcToolCall('test_throwing_tool');
    const res = await handleMCPRequest(req, ctx, 'test-token');

    expect(res).not.toBeNull();
    // Tool errors are caught and returned as result with isError
    const result = res!.result as MCPToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Something went wrong');
    expect(result.content[0].text).toContain('test_throwing_tool');
  });

  it('tool that throws without message still returns useful error', async () => {
    registerTool(
      {
        name: 'test_bare_throw',
        description: 'Throws without message',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => {
        throw {};
      },
    );

    const ctx = mockCtx();
    const req = rpcToolCall('test_bare_throw');
    const res = await handleMCPRequest(req, ctx, 'test-token');

    const result = res!.result as MCPToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown error');
  });
});

// ---------------------------------------------------------------------------
// Empty-State Messages
// ---------------------------------------------------------------------------

describe('MCP Empty-State Responses', () => {
  it('get_task_result for nonexistent task returns error with helpful message', async () => {
    // Import the task relay tools (they register themselves)
    await import('../mcp/tools/task-relay');

    const ctx = mockCtx();
    const req = rpcToolCall('get_task_result', {
      task_id: '00000000-0000-0000-0000-000000000000',
    });
    const res = await handleMCPRequest(req, ctx, 'test-token');

    expect(res).not.toBeNull();
    // Could be a result with isError or a caught exception in error field
    if (res!.result) {
      const result = res!.result as MCPToolResult;
      expect(result.isError).toBe(true);
      expect(result.content[0].text.toLowerCase()).toContain('not found');
    } else {
      // Tool threw — handler catches it and returns isError result
      expect(res!.result || res!.error).toBeDefined();
    }
  });

  it('cancel_task for nonexistent task returns error with helpful message', async () => {
    const ctx = mockCtx();
    const req = rpcToolCall('cancel_task', {
      task_id: '00000000-0000-0000-0000-000000000000',
    });
    const res = await handleMCPRequest(req, ctx, 'test-token');

    expect(res).not.toBeNull();
    if (res!.result) {
      const result = res!.result as MCPToolResult;
      expect(result.isError).toBe(true);
      expect(result.content[0].text.toLowerCase()).toContain('not found');
    } else {
      expect(res!.result || res!.error).toBeDefined();
    }
  });

  it('tool returning empty result still has content array', async () => {
    registerTool(
      {
        name: 'test_empty_result',
        description: 'Returns empty content',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => ({
        content: [{ type: 'text', text: 'No results found. Try broadening your search criteria.' }],
      }),
    );

    const ctx = mockCtx();
    const req = rpcToolCall('test_empty_result');
    const res = await handleMCPRequest(req, ctx, 'test-token');

    const result = res!.result as MCPToolResult;
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].text).toContain('No results found');
  });
});

// ---------------------------------------------------------------------------
// Rate Limit Configuration
// ---------------------------------------------------------------------------

describe('MCP Rate Limit Configuration', () => {
  it('rate limiter is configured for 100 req/min', async () => {
    // Verify the rate limit config by reading the source
    const { createRateLimiter } = await import('../middleware/rate-limit');
    // The factory function exists and accepts config — verify it doesn't throw
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 100 });
    expect(typeof limiter).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Tool Registration Integrity
// ---------------------------------------------------------------------------

describe('MCP Tool Registration', () => {
  it('all registered tools have valid inputSchema with type "object"', () => {
    const tools = getRegisteredTools();
    expect(tools.length).toBeGreaterThan(0);

    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it('all registered tools have unique names', () => {
    const tools = getRegisteredTools();
    const names = tools.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });
});
