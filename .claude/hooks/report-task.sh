#!/usr/bin/env bash
# Utility: report task completion or failure to CV-Hub.
# Usage:
#   bash .claude/hooks/report-task.sh <task_id> "summary" [--fail]
#   bash .claude/hooks/report-task.sh <task_id> "error msg" --fail
set -euo pipefail

if [[ -z "${CV_HUB_EXECUTOR_ID:-}" || -z "${CV_HUB_API:-}" || -z "${CV_HUB_PAT:-}" ]]; then
  echo "Error: CV-Hub executor not registered. Run setup-auth.sh first." >&2
  exit 1
fi

task_id="${1:?Usage: report-task.sh <task_id> <summary> [--fail]}"
summary="${2:?Usage: report-task.sh <task_id> <summary> [--fail]}"
mode="${3:-}"

base="${CV_HUB_API}/api/v1/executors/${CV_HUB_EXECUTOR_ID}/tasks/${task_id}"

if [[ "$mode" == "--fail" ]]; then
  # Report failure
  payload=$(printf '{"error":"%s"}' "$summary")
  resp=$(curl -sf -X POST \
    -H "Authorization: Bearer ${CV_HUB_PAT}" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "${base}/fail" 2>&1) || {
    echo "Error: Failed to report task failure" >&2
    exit 1
  }
  echo "Task ${task_id} marked as failed."
else
  # Detect modified files via git
  files_modified=$(git diff --name-only HEAD~1 2>/dev/null | head -20 || true)
  files_json="[]"
  if [[ -n "$files_modified" ]]; then
    files_json=$(echo "$files_modified" | while IFS= read -r f; do printf '"%s",' "$f"; done | sed 's/,$//' | sed 's/^/[/' | sed 's/$/]/')
  fi

  payload=$(cat <<EOF
{
  "summary": "${summary}",
  "files_modified": ${files_json}
}
EOF
)

  resp=$(curl -sf -X POST \
    -H "Authorization: Bearer ${CV_HUB_PAT}" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "${base}/complete" 2>&1) || {
    echo "Error: Failed to report task completion" >&2
    exit 1
  }
  echo "Task ${task_id} marked as completed."
fi
