import { registerTool } from '../handler';
import {
  createThread,
  getThread,
  listThreads,
  updateThreadStatus,
  addSegment,
  endSegment,
  createBridge,
  acceptBridge,
  getThreadSummary,
} from '../../services/thread.service';
import type { MCPTool, MCPToolResult, MCPSessionContext } from '../types';

// ============================================================================
// create_thread
// ============================================================================

const createThreadTool: MCPTool = {
  name: 'create_thread',
  description:
    'Create a new workflow thread for tracking work across multiple sessions and platforms. Threads group related segments of work.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Thread title describing the overall goal',
      },
      description: {
        type: 'string',
        description: 'Detailed description of the workflow',
      },
      repository_id: {
        type: 'string',
        description: 'Repository UUID this thread is associated with (optional)',
      },
      metadata: {
        type: 'object',
        description: 'Arbitrary metadata (tags, labels, etc.)',
      },
    },
    required: ['title'],
  },
};

async function handleCreateThread(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const thread = await createThread({
    userId: ctx.userId,
    title: args.title as string,
    description: args.description as string | undefined,
    repositoryId: args.repository_id as string | undefined,
    metadata: args.metadata as Record<string, unknown> | undefined,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            thread_id: thread.id,
            title: thread.title,
            status: thread.status,
            created_at: thread.createdAt,
            message: 'Thread created. Add segments as you work across sessions.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ============================================================================
// list_threads
// ============================================================================

const listThreadsTool: MCPTool = {
  name: 'list_threads',
  description: 'List workflow threads. Filter by status or repository.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status',
        enum: ['active', 'paused', 'completed', 'archived'],
      },
      repository_id: {
        type: 'string',
        description: 'Filter by repository UUID',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
    },
  },
};

async function handleListThreads(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const threads = await listThreads({
    userId: ctx.userId,
    status: args.status as string | undefined,
    repositoryId: args.repository_id as string | undefined,
    limit: (args.limit as number) || 20,
  });

  const summary = threads.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    total_segments: t.totalSegments,
    repository_id: t.repositoryId,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ threads: summary, total: threads.length }, null, 2),
      },
    ],
  };
}

// ============================================================================
// add_segment
// ============================================================================

const addSegmentTool: MCPTool = {
  name: 'add_segment',
  description:
    'Add a new segment to a workflow thread. Segments represent individual work sessions on a specific platform (Claude.ai, Claude Code, etc.).',
  inputSchema: {
    type: 'object',
    properties: {
      thread_id: {
        type: 'string',
        description: 'Thread UUID to add the segment to',
      },
      platform: {
        type: 'string',
        description: 'Platform this segment runs on',
        enum: ['claude_ai', 'claude_code', 'cv_hub_api'],
      },
      segment_type: {
        type: 'string',
        description: 'Type of work in this segment',
        enum: ['planning', 'execution', 'review', 'research', 'debugging'],
      },
      title: {
        type: 'string',
        description: 'Short title for this segment',
      },
      summary: {
        type: 'string',
        description: 'Summary of what this segment accomplished or is working on',
      },
      session_identifier: {
        type: 'string',
        description: 'External session ID (e.g., Claude conversation ID)',
      },
      context_snapshot: {
        type: 'object',
        description:
          'Snapshot of key context at segment start (active files, branch, decisions, etc.)',
      },
      tools_used: {
        type: 'array',
        description: 'List of tools used in this segment',
        items: { type: 'string' },
      },
      files_modified: {
        type: 'array',
        description: 'List of files modified in this segment',
        items: { type: 'string' },
      },
      previous_segment_id: {
        type: 'string',
        description: 'ID of the previous segment to link from (creates an edge)',
      },
      edge_type: {
        type: 'string',
        description: 'Type of edge from previous segment',
        enum: ['continuation', 'fork', 'merge', 'handoff'],
      },
    },
    required: ['thread_id', 'platform'],
  },
};

async function handleAddSegment(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  try {
    const segment = await addSegment({
      threadId: args.thread_id as string,
      userId: ctx.userId,
      platform: args.platform as any,
      segmentType: args.segment_type as any,
      title: args.title as string | undefined,
      summary: args.summary as string | undefined,
      sessionIdentifier: args.session_identifier as string | undefined,
      contextSnapshot: args.context_snapshot as any,
      toolsUsed: args.tools_used as string[] | undefined,
      filesModified: args.files_modified as string[] | undefined,
      previousSegmentId: args.previous_segment_id as string | undefined,
      edgeType: args.edge_type as any,
      metadata: undefined,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              segment_id: segment.id,
              thread_id: segment.threadId,
              platform: segment.platform,
              segment_type: segment.segmentType,
              started_at: segment.startedAt,
              message: 'Segment added to thread.',
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: error.message }],
      isError: true,
    };
  }
}

// ============================================================================
// end_segment
// ============================================================================

const endSegmentTool: MCPTool = {
  name: 'end_segment',
  description:
    'Mark a segment as ended. Include a summary and result snapshot to capture what was accomplished.',
  inputSchema: {
    type: 'object',
    properties: {
      segment_id: {
        type: 'string',
        description: 'Segment UUID to end',
      },
      thread_id: {
        type: 'string',
        description: 'Thread UUID the segment belongs to',
      },
      summary: {
        type: 'string',
        description: 'Summary of what was accomplished in this segment',
      },
      result_snapshot: {
        type: 'object',
        description: 'Snapshot of key context at segment end',
      },
      files_modified: {
        type: 'array',
        description: 'Final list of files modified',
        items: { type: 'string' },
      },
      tools_used: {
        type: 'array',
        description: 'Final list of tools used',
        items: { type: 'string' },
      },
    },
    required: ['segment_id', 'thread_id'],
  },
};

async function handleEndSegment(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const segment = await endSegment({
    segmentId: args.segment_id as string,
    threadId: args.thread_id as string,
    userId: ctx.userId,
    summary: args.summary as string | undefined,
    resultSnapshot: args.result_snapshot as any,
    filesModified: args.files_modified as string[] | undefined,
    toolsUsed: args.tools_used as string[] | undefined,
  });

  if (!segment) {
    return {
      content: [{ type: 'text', text: 'Segment or thread not found.' }],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            segment_id: segment.id,
            ended_at: segment.endedAt,
            message: 'Segment marked as ended.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ============================================================================
// bridge_context
// ============================================================================

const bridgeContextTool: MCPTool = {
  name: 'bridge_context',
  description:
    'Create a context bridge to transfer context between segments or platforms. Use this when handing off work from Claude.ai to Claude Code or vice versa.',
  inputSchema: {
    type: 'object',
    properties: {
      thread_id: {
        type: 'string',
        description: 'Thread UUID',
      },
      from_segment_id: {
        type: 'string',
        description: 'Source segment UUID',
      },
      to_segment_id: {
        type: 'string',
        description:
          'Target segment UUID (optional — can be set later when target accepts)',
      },
      bridge_type: {
        type: 'string',
        description: 'Type of bridge',
        enum: ['task_dispatch', 'result_return', 'context_share', 'handoff'],
      },
      summary: {
        type: 'string',
        description: 'Brief summary of the context being bridged',
      },
      context: {
        type: 'string',
        description: 'Detailed context to transfer',
      },
      decisions: {
        type: 'array',
        description: 'Key decisions made that the next segment should know about',
        items: { type: 'string' },
      },
      task_ids: {
        type: 'array',
        description: 'Task IDs related to this bridge',
        items: { type: 'string' },
      },
      expires_in_minutes: {
        type: 'number',
        description: 'Bridge expiry in minutes (default: 1440 = 24h)',
      },
    },
    required: ['thread_id', 'from_segment_id'],
  },
};

async function handleBridgeContext(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  try {
    const bridge = await createBridge({
      threadId: args.thread_id as string,
      userId: ctx.userId,
      fromSegmentId: args.from_segment_id as string,
      toSegmentId: args.to_segment_id as string | undefined,
      bridgeType: args.bridge_type as any,
      contextPayload: {
        summary: args.summary as string | undefined,
        context: args.context as string | undefined,
        decisions: args.decisions as string[] | undefined,
        taskIds: args.task_ids as string[] | undefined,
      },
      expiresInMinutes: args.expires_in_minutes as number | undefined,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              bridge_id: bridge.id,
              thread_id: bridge.threadId,
              bridge_type: bridge.bridgeType,
              status: bridge.status,
              expires_at: bridge.expiresAt,
              message: bridge.toSegmentId
                ? 'Context bridge created and linked.'
                : 'Context bridge created. Awaiting target segment to accept.',
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: error.message }],
      isError: true,
    };
  }
}

// ============================================================================
// get_thread_summary
// ============================================================================

const getThreadSummaryTool: MCPTool = {
  name: 'get_thread_summary',
  description:
    'Get a comprehensive summary of a workflow thread including all segments, edges, and pending bridges. Use this to understand the full context of an ongoing workflow.',
  inputSchema: {
    type: 'object',
    properties: {
      thread_id: {
        type: 'string',
        description: 'Thread UUID to summarize',
      },
    },
    required: ['thread_id'],
  },
};

async function handleGetThreadSummary(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const summary = await getThreadSummary(
    args.thread_id as string,
    ctx.userId,
  );

  if (!summary) {
    return {
      content: [{ type: 'text', text: 'Thread not found.' }],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            thread: {
              id: summary.thread.id,
              title: summary.thread.title,
              description: summary.thread.description,
              status: summary.thread.status,
              total_segments: summary.thread.totalSegments,
              repository_id: summary.thread.repositoryId,
              created_at: summary.thread.createdAt,
            },
            segments: summary.segments,
            edges: summary.edges,
            pending_bridges: summary.pendingBridges,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ============================================================================
// update_thread_status
// ============================================================================

const updateThreadStatusTool: MCPTool = {
  name: 'update_thread_status',
  description: 'Update the status of a workflow thread.',
  inputSchema: {
    type: 'object',
    properties: {
      thread_id: {
        type: 'string',
        description: 'Thread UUID',
      },
      status: {
        type: 'string',
        description: 'New status',
        enum: ['active', 'paused', 'completed', 'archived'],
      },
    },
    required: ['thread_id', 'status'],
  },
};

async function handleUpdateThreadStatus(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const thread = await updateThreadStatus(
    args.thread_id as string,
    ctx.userId,
    args.status as any,
  );

  if (!thread) {
    return {
      content: [{ type: 'text', text: 'Thread not found.' }],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            thread_id: thread.id,
            status: thread.status,
            message: `Thread status updated to ${thread.status}.`,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ============================================================================
// Register all thread continuity tools
// ============================================================================

export function registerThreadContinuityTools(): void {
  registerTool(createThreadTool, handleCreateThread);
  registerTool(listThreadsTool, handleListThreads);
  registerTool(addSegmentTool, handleAddSegment);
  registerTool(endSegmentTool, handleEndSegment);
  registerTool(bridgeContextTool, handleBridgeContext);
  registerTool(getThreadSummaryTool, handleGetThreadSummary);
  registerTool(updateThreadStatusTool, handleUpdateThreadStatus);
}
