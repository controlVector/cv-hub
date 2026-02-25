#!/usr/bin/env bash
# Claude Code hook: Stop (fires after each Claude Code response cycle)
# Polls CV-Hub for the next pending task. If found, outputs context for
# Claude Code to pick up as a follow-up prompt.
set -euo pipefail

if [[ -z "${CV_HUB_EXECUTOR_ID:-}" || -z "${CV_HUB_API:-}" || -z "${CV_HUB_PAT:-}" ]]; then
  exit 0
fi

# Poll for next task
resp=$(curl -sf -X POST \
  -H "Authorization: Bearer ${CV_HUB_PAT}" \
  -H "Content-Type: application/json" \
  "${CV_HUB_API}/api/v1/executors/${CV_HUB_EXECUTOR_ID}/poll" 2>/dev/null) || exit 0

# Check if a task was returned
task_id=$(echo "$resp" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -z "$task_id" ]]; then
  exit 0
fi

# Mark task as started
curl -sf -X POST \
  -H "Authorization: Bearer ${CV_HUB_PAT}" \
  -H "Content-Type: application/json" \
  "${CV_HUB_API}/api/v1/executors/${CV_HUB_EXECUTOR_ID}/tasks/${task_id}/start" \
  >/dev/null 2>&1 || true

# Extract task details
title=$(echo "$resp" | grep -o '"title":"[^"]*"' | head -1 | cut -d'"' -f4)
description=$(echo "$resp" | grep -o '"description":"[^"]*"' | head -1 | cut -d'"' -f4)
task_type=$(echo "$resp" | grep -o '"task_type":"[^"]*"' | head -1 | cut -d'"' -f4)
priority=$(echo "$resp" | grep -o '"priority":"[^"]*"' | head -1 | cut -d'"' -f4)
branch=$(echo "$resp" | grep -o '"branch":"[^"]*"' | head -1 | cut -d'"' -f4)

# Output task context — Claude Code will see this as a follow-up
cat <<EOF

--- CV-Hub Task Dispatched ---
Task ID: ${task_id}
Type: ${task_type:-custom}
Priority: ${priority:-medium}
Title: ${title}
${description:+Description: ${description}}
${branch:+Branch: ${branch}}

When you finish this task, report results by running:
  bash .claude/hooks/report-task.sh "${task_id}" "summary of what was done"

If the task fails, report the failure:
  bash .claude/hooks/report-task.sh "${task_id}" "error description" --fail
---

EOF
