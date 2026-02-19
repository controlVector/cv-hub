import { registerTaskRelayTools } from './tools/task-relay';
import { registerThreadContinuityTools } from './tools/thread-continuity';
import { getRegisteredTools } from './handler';

/**
 * Register all MCP tools. Call this during server startup.
 */
export function registerAllMCPTools(): void {
  registerTaskRelayTools();
  registerThreadContinuityTools();

  const tools = getRegisteredTools();
  console.log(`[MCP] Registered ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
}
