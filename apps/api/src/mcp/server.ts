/**
 * MCP Server Factory
 * Creates a configured McpServer instance with all tools registered
 * for a given authenticated user and their scopes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRepoTools } from './tools/repo';
import { registerPullRequestTools } from './tools/pull-requests';
import { registerIssueTools } from './tools/issues';
import { registerGraphTools } from './tools/graph';
import { registerSearchTools } from './tools/search';
import { registerSyncTools } from './tools/sync';
import { registerCICDToolsOnMcp } from './tools/ci-cd';

/**
 * Create a fully-configured MCP server for a specific user session.
 *
 * The server is stateless — each request creates a new instance.
 * Tool closures capture the userId and scopes for access control.
 */
export function createMcpServer(userId: string, scopes: string[]): McpServer {
  const server = new McpServer({
    name: 'cv-hub',
    version: '1.0.0',
  });

  // Phase 1: Core tools
  registerRepoTools(server, userId, scopes);
  registerPullRequestTools(server, userId, scopes);
  registerIssueTools(server, userId, scopes);

  // Phase 2: Intelligence + CI/CD
  registerGraphTools(server, userId, scopes);
  registerSearchTools(server, userId, scopes);
  registerSyncTools(server, userId, scopes);
  registerCICDToolsOnMcp(server, userId);

  return server;
}
