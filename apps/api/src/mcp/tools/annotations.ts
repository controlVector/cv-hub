/**
 * MCP Tool Annotations
 *
 * Maps tool names to their ToolAnnotations hints.
 * These hints help Claude.ai auto-approve read-only tools
 * and warn before destructive actions.
 *
 * @see https://modelcontextprotocol.io/docs/specification/2025-11-25/server/tools#annotations
 */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_SAFE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const WRITE_IDEMPOTENT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const DESTRUCTIVE_IDEMPOTENT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * Canonical annotations for every MCP tool.
 * Import and use: `toolAnnotations['tool_name']`
 */
export const toolAnnotations: Record<string, ToolAnnotations> = {
  // ── Repo tools ──────────────────────────────────────────
  list_repos: READ_ONLY,
  get_repo: READ_ONLY,
  get_file: READ_ONLY,
  get_tree: READ_ONLY,
  list_branches: READ_ONLY,
  get_diff: READ_ONLY,
  get_commit: READ_ONLY,
  get_commit_history: READ_ONLY,
  create_repo: WRITE_SAFE,

  // ── Pull Request tools ─────────────────────────────────
  list_pulls: READ_ONLY,
  get_pull: READ_ONLY,
  create_pull: WRITE_SAFE,
  merge_pull: DESTRUCTIVE,

  // ── Issue tools ────────────────────────────────────────
  list_issues: READ_ONLY,
  get_issue: READ_ONLY,
  create_issue: WRITE_SAFE,
  update_issue: WRITE_IDEMPOTENT,

  // ── Graph tools ────────────────────────────────────────
  query_graph: READ_ONLY,
  get_symbol: READ_ONLY,
  find_callers: READ_ONLY,
  find_callees: READ_ONLY,
  find_call_paths: READ_ONLY,
  find_dead_code: READ_ONLY,
  complexity_hotspots: READ_ONLY,
  graph_stats: READ_ONLY,

  // ── Search tools ───────────────────────────────────────
  search_code: READ_ONLY,
  search_symbols: READ_ONLY,

  // ── Sync tools ─────────────────────────────────────────
  trigger_graph_sync: WRITE_IDEMPOTENT,
  get_sync_status: READ_ONLY,

  // ── CI/CD tools ────────────────────────────────────────
  list_pipelines: READ_ONLY,
  get_pipeline: READ_ONLY,
  list_runs: READ_ONLY,
  get_run: READ_ONLY,
  trigger_pipeline: WRITE_SAFE,
  cancel_run: DESTRUCTIVE_IDEMPOTENT,
  get_run_logs: READ_ONLY,
  create_pipeline: WRITE_SAFE,
  update_pipeline: WRITE_IDEMPOTENT,
  delete_pipeline: DESTRUCTIVE,

  // ── Executor relay tools ───────────────────────────────
  list_executors: READ_ONLY,
  create_task: WRITE_SAFE,
  list_tasks: READ_ONLY,
  get_task_result: READ_ONLY,
  cancel_task: DESTRUCTIVE_IDEMPOTENT,

  // ── Context tools ──────────────────────────────────────
  get_repo_context: READ_ONLY,
  get_context_at_ref: READ_ONLY,

  // ── Context engine tools ───────────────────────────────
  get_focused_context: READ_ONLY,
  get_impact_context: READ_ONLY,

  // ── Safety tools ───────────────────────────────────────
  cv_safety_check: READ_ONLY,
  cv_architecture_review: READ_ONLY,
};

/** Get annotations for a tool, defaulting to READ_ONLY if not found */
export function getAnnotations(toolName: string): ToolAnnotations {
  return toolAnnotations[toolName] ?? READ_ONLY;
}
