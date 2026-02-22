// MCP Server exports

// CI/CD tools (legacy)
export * from './tools';

// MCP Streamable HTTP transport types (re-export selectively to avoid collision)
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPServerCapabilities,
  MCPClientCapabilities,
  MCPToolCallParams,
  MCPSessionContext,
  MCPContent,
} from './types';
export { MCP_VERSION, JSON_RPC_ERRORS } from './types';

// Rename transport-level MCPTool/MCPToolResult to avoid collision with CI/CD tools
export type { MCPTool as MCPToolDef, MCPToolResult as MCPToolCallResult } from './types';

// Handler & session
export { registerTool, getRegisteredTools, handleMCPRequest } from './handler';
export { createMCPSession, getMCPSession, closeMCPSession, markSessionInitialized } from './session';

// SDK-based MCP server factory (for mcpGateway route)
export { createMcpServer } from './server';
