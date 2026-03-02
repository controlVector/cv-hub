/**
 * Tool Annotations Tests
 *
 * Validates:
 *  - All known tools have annotations
 *  - Read-only tools have correct hints
 *  - Destructive tools have correct hints
 *  - getAnnotations defaults to READ_ONLY for unknown tools
 */

import { describe, it, expect } from 'vitest';
import { toolAnnotations, getAnnotations } from './annotations';

const READ_ONLY_TOOLS = [
  'list_repos', 'get_repo', 'get_file', 'get_tree', 'list_branches',
  'get_diff', 'get_commit', 'get_commit_history',
  'list_pulls', 'get_pull',
  'list_issues', 'get_issue',
  'query_graph', 'get_symbol', 'find_callers', 'find_callees',
  'find_call_paths', 'find_dead_code', 'complexity_hotspots', 'graph_stats',
  'search_code', 'search_symbols',
  'get_sync_status',
  'list_executors', 'list_tasks', 'get_task_result',
  'check_active_tasks', 'get_task_prompts',
  'get_repo_context', 'get_context_at_ref',
  'get_focused_context', 'get_impact_context',
  'cv_safety_check', 'cv_architecture_review',
  'list_pipelines', 'get_pipeline', 'list_runs', 'get_run', 'get_run_logs',
];

const DESTRUCTIVE_TOOLS = ['merge_pull', 'cancel_run', 'cancel_task', 'delete_pipeline'];

const WRITE_TOOLS = [
  'create_repo', 'create_pull', 'create_issue', 'create_task',
  'trigger_pipeline', 'create_pipeline',
  'respond_to_prompt',
];

describe('toolAnnotations', () => {
  it('should have annotations for at least 40 tools', () => {
    expect(Object.keys(toolAnnotations).length).toBeGreaterThanOrEqual(40);
  });

  it.each(READ_ONLY_TOOLS)('should mark %s as readOnly', (name) => {
    const a = toolAnnotations[name];
    expect(a, `Missing annotations for ${name}`).toBeDefined();
    expect(a.readOnlyHint).toBe(true);
    expect(a.destructiveHint).toBe(false);
  });

  it.each(DESTRUCTIVE_TOOLS)('should mark %s as destructive', (name) => {
    const a = toolAnnotations[name];
    expect(a, `Missing annotations for ${name}`).toBeDefined();
    expect(a.destructiveHint).toBe(true);
    expect(a.readOnlyHint).toBe(false);
  });

  it.each(WRITE_TOOLS)('should mark %s as write (non-destructive)', (name) => {
    const a = toolAnnotations[name];
    expect(a, `Missing annotations for ${name}`).toBeDefined();
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(false);
  });

  it('should default to readOnly for unknown tools', () => {
    const a = getAnnotations('nonexistent_tool');
    expect(a.readOnlyHint).toBe(true);
    expect(a.destructiveHint).toBe(false);
  });
});
