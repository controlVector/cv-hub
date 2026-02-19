import { brand } from '../config/brand';
import { markSessionInitialized } from './session';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPSessionContext,
  MCPTool,
  MCPToolCallParams,
  MCPToolResult,
  MCPContent,
} from './types';
import { MCP_VERSION, JSON_RPC_ERRORS } from './types';

// Tool registry — populated by A.4 (tool handlers)
type ToolHandler = (
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
) => Promise<MCPToolResult>;

const toolRegistry = new Map<string, { tool: MCPTool; handler: ToolHandler }>();

/**
 * Register an MCP tool. Called during server startup by tool modules.
 */
export function registerTool(tool: MCPTool, handler: ToolHandler): void {
  toolRegistry.set(tool.name, { tool, handler });
}

/**
 * Get all registered tools (for tools/list).
 */
export function getRegisteredTools(): MCPTool[] {
  return Array.from(toolRegistry.values()).map((entry) => entry.tool);
}

/**
 * Handle a single JSON-RPC request and return a response.
 */
export async function handleMCPRequest(
  request: JsonRpcRequest,
  ctx: MCPSessionContext,
  sessionToken: string,
): Promise<JsonRpcResponse | null> {
  // Notifications (no id) don't get a response
  if (request.id === undefined || request.id === null) {
    await handleNotification(request, ctx, sessionToken);
    return null;
  }

  try {
    const result = await dispatchMethod(request, ctx, sessionToken);
    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };
  } catch (error: any) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: error.code || JSON_RPC_ERRORS.INTERNAL_ERROR,
        message: error.message || 'Internal error',
        data: error.data,
      },
    };
  }
}

/**
 * Dispatch a JSON-RPC method to the appropriate handler.
 */
async function dispatchMethod(
  request: JsonRpcRequest,
  ctx: MCPSessionContext,
  sessionToken: string,
): Promise<unknown> {
  switch (request.method) {
    case 'initialize':
      return handleInitialize(
        request.params as unknown as MCPInitializeParams,
        ctx,
        sessionToken,
      );

    case 'ping':
      return {};

    case 'tools/list':
      return handleToolsList(ctx);

    case 'tools/call':
      return handleToolsCall(
        request.params as unknown as MCPToolCallParams,
        ctx,
      );

    default:
      throw {
        code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        message: `Method not found: ${request.method}`,
      };
  }
}

/**
 * Handle notifications (messages without an id).
 */
async function handleNotification(
  request: JsonRpcRequest,
  ctx: MCPSessionContext,
  _sessionToken: string,
): Promise<void> {
  switch (request.method) {
    case 'notifications/initialized':
      // Client confirms initialization is complete — nothing to do
      break;

    case 'notifications/cancelled':
      // Client wants to cancel an in-progress request
      break;

    default:
      // Unknown notifications are silently ignored per spec
      break;
  }
}

// ============================================================================
// MCP Method Handlers
// ============================================================================

async function handleInitialize(
  params: MCPInitializeParams,
  ctx: MCPSessionContext,
  sessionToken: string,
): Promise<MCPInitializeResult> {
  // Mark session as initialized
  markSessionInitialized(sessionToken);

  return {
    protocolVersion: MCP_VERSION,
    capabilities: {
      tools: { listChanged: false },
      logging: {},
    },
    serverInfo: {
      name: `${brand.appName} MCP Server`,
      version: '1.0.0',
    },
    instructions: `You are connected to ${brand.appName}, an AI-native git platform. Use the available tools to manage agent tasks, relay work to Claude Code executors, and maintain thread continuity across sessions.`,
  };
}

async function handleToolsList(
  ctx: MCPSessionContext,
): Promise<{ tools: MCPTool[] }> {
  const tools = getRegisteredTools();
  return { tools };
}

async function handleToolsCall(
  params: MCPToolCallParams,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  if (!params?.name) {
    throw {
      code: JSON_RPC_ERRORS.INVALID_PARAMS,
      message: 'Missing tool name',
    };
  }

  const entry = toolRegistry.get(params.name);
  if (!entry) {
    throw {
      code: JSON_RPC_ERRORS.INVALID_PARAMS,
      message: `Unknown tool: ${params.name}`,
    };
  }

  try {
    return await entry.handler(params.arguments || {}, ctx);
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool ${params.name}: ${error.message || 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}
