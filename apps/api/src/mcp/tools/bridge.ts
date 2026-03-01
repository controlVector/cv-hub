/**
 * MCP Tools: Chat ↔ Code Bridge
 *
 * cv_list_executors  — List online Claude Code instances
 * cv_connect         — Link this conversation to a specific machine
 * cv_disconnect      — Unlink this conversation
 * cv_connection_status — Check current connection
 */

import { registerTool } from '../handler';
import {
  listExecutorsFiltered,
  findExecutorByMachineName,
} from '../../services/executor.service';
import {
  bindSession,
  unbindSession,
  getActiveBinding,
} from '../../services/session-binding.service';
import type { MCPTool, MCPToolResult, MCPSessionContext } from '../types';

function timeAgo(date: Date | null): string {
  if (!date) return 'never';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function statusIcon(status: string): string {
  switch (status) {
    case 'online': return '\u{1F7E2}';  // green circle
    case 'busy': return '\u{1F7E1}';    // yellow circle
    case 'offline': return '\u26AB';     // black circle
    case 'error': return '\u{1F534}';   // red circle
    default: return '\u2753';           // question mark
  }
}

// ============================================================================
// cv_list_executors
// ============================================================================

const listExecutorsTool: MCPTool = {
  name: 'cv_list_executors',
  description:
    'List your online Claude Code instances. Shows machine name, available repos, and current status.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status: "online", "offline", or "all" (default: "all")',
        enum: ['online', 'offline', 'all'],
      },
    },
  },
};

async function handleListExecutors(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const status = (args.status as 'online' | 'offline' | 'all') || 'all';
  const executors = await listExecutorsFiltered(ctx.userId, { status });

  if (executors.length === 0) {
    const msg = status === 'online'
      ? 'No online machines found.\n\nStart a Claude Code session with CV-Hub hooks to register a machine:\n  1. cv auth login\n  2. cd your-project && cv init -y\n  3. claude'
      : 'No machines registered.\n\nGet started:\n  1. Install: npm install -g @controlVector/cv-git\n  2. Authenticate: cv auth login\n  3. In your project: cv init -y\n  4. Start Claude Code: claude\n\nYour machine will appear here automatically.';
    return { content: [{ type: 'text', text: msg }] };
  }

  const lines = ['Your Claude Code instances:\n'];
  const header = '  Machine                Status     Repos                       Last Active';
  const divider = '  ' + '\u2500'.repeat(74);
  lines.push(header, divider);

  for (const e of executors) {
    const name = (e.machineName || e.name).padEnd(22);
    const st = `${statusIcon(e.status)} ${e.status}`.padEnd(12);
    const repos = (e.repos || []).join(', ') || '(none)';
    const reposStr = repos.length > 27 ? repos.slice(0, 24) + '...' : repos.padEnd(27);
    const lastActive = timeAgo(e.lastHeartbeatAt);
    lines.push(`  ${name}${st}${reposStr} ${lastActive}`);
  }

  lines.push('', 'Use cv_connect to link this conversation to a specific machine.');

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

// ============================================================================
// cv_connect
// ============================================================================

const connectTool: MCPTool = {
  name: 'cv_connect',
  description:
    'Link this conversation to a specific Claude Code instance. All tasks you dispatch will go to that machine.',
  inputSchema: {
    type: 'object',
    properties: {
      machine_name: {
        type: 'string',
        description: 'Machine name to connect to (case-insensitive)',
      },
    },
    required: ['machine_name'],
  },
};

async function handleConnect(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const machineName = args.machine_name as string;

  if (!machineName) {
    return {
      content: [{ type: 'text', text: 'machine_name is required. Use cv_list_executors to see available machines.' }],
      isError: true,
    };
  }

  // Check if already connected
  const existing = await getActiveBinding(ctx.sessionId);
  if (existing) {
    const name = existing.executor.machineName || existing.executor.name;
    return {
      content: [{
        type: 'text',
        text: `Already connected to "${name}". Use cv_disconnect first, then connect to a different machine.`,
      }],
      isError: true,
    };
  }

  // Find executor by machine name
  const executor = await findExecutorByMachineName(ctx.userId, machineName);
  if (!executor) {
    return {
      content: [{
        type: 'text',
        text: `No machine named "${machineName}" found. Use cv_list_executors to see available machines.`,
      }],
      isError: true,
    };
  }

  if (executor.status !== 'online') {
    return {
      content: [{
        type: 'text',
        text: `Machine "${machineName}" is ${executor.status}. Only online machines can be connected.\nUse cv_list_executors to see what's available.`,
      }],
      isError: true,
    };
  }

  // Use the executor's org, falling back to empty string if no org
  const orgId = executor.organizationId;
  if (!orgId) {
    return {
      content: [{
        type: 'text',
        text: `Machine "${machineName}" has no organization set. Re-register the executor with an organization.`,
      }],
      isError: true,
    };
  }

  await bindSession({
    mcpSessionId: ctx.sessionId,
    executorId: executor.id,
    userId: ctx.userId,
    organizationId: orgId,
  });

  const repos = (executor.repos || []).join(', ') || '(none detected)';
  const lines = [
    `\u2713 Connected to ${executor.machineName || executor.name}`,
    '',
    `This conversation is now linked to your machine.`,
    `Tasks you dispatch will go directly to this machine.`,
    '',
    `Available repos: ${repos}`,
    '',
    'To disconnect: use cv_disconnect',
  ];

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

// ============================================================================
// cv_disconnect
// ============================================================================

const disconnectTool: MCPTool = {
  name: 'cv_disconnect',
  description:
    'Unlink this conversation from its Claude Code instance. Future tasks will be routed automatically.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

async function handleDisconnect(
  _args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const unbound = await unbindSession(ctx.sessionId, ctx.userId);

  if (!unbound) {
    return {
      content: [{ type: 'text', text: 'Not currently connected to any machine. Nothing to disconnect.' }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: '\u2713 Disconnected. Future tasks will be routed to any available online machine.',
    }],
  };
}

// ============================================================================
// cv_connection_status
// ============================================================================

const connectionStatusTool: MCPTool = {
  name: 'cv_connection_status',
  description: 'Check which Claude Code instance this conversation is linked to.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

async function handleConnectionStatus(
  _args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const binding = await getActiveBinding(ctx.sessionId);

  if (!binding) {
    return {
      content: [{
        type: 'text',
        text: 'Not connected to any machine.\n\nUse cv_list_executors to see available machines, then cv_connect to link one.',
      }],
    };
  }

  const e = binding.executor;
  const lines = [
    `Connected to: ${e.machineName || e.name}`,
    `Status: ${statusIcon(e.status)} ${e.status}`,
    `Repos: ${(e.repos || []).join(', ') || '(none)'}`,
    `Last active: ${timeAgo(e.lastHeartbeatAt)}`,
    `Connected since: ${binding.boundAt.toISOString()}`,
    '',
    'Use cv_disconnect to unlink.',
  ];

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

// ============================================================================
// Register all bridge tools
// ============================================================================

export function registerBridgeTools(): void {
  registerTool(listExecutorsTool, handleListExecutors);
  registerTool(connectTool, handleConnect);
  registerTool(disconnectTool, handleDisconnect);
  registerTool(connectionStatusTool, handleConnectionStatus);
}
