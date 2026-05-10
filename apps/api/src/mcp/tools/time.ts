/**
 * MCP Tool: cv_time
 * Returns CV-Hub server time so MCP clients have time awareness.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const startTime = Date.now();

export function registerTimeTools(server: McpServer) {
  server.tool(
    'cv_time',
    'Get the current CV-Hub server time, timezone, and UTC offset. Use this to understand what time it is when reasoning about deadlines, build durations, or task scheduling.',
    {},
    async () => {
      const now = new Date();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            iso: now.toISOString(),
            unix: Math.floor(now.getTime() / 1000),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            utc_offset: now.toTimeString().match(/GMT([+-]\d{4})/)?.[1] ?? '+0000',
            uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
          }, null, 2),
        }],
      };
    },
  );
}
