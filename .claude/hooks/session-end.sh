#!/usr/bin/env bash
# Claude Code hook: SessionEnd
# Unregisters this executor from CV-Hub.
set -euo pipefail

# These come from CLAUDE_ENV_FILE, set by session-start.sh
if [[ -z "${CV_HUB_EXECUTOR_ID:-}" || -z "${CV_HUB_API:-}" || -z "${CV_HUB_PAT:-}" ]]; then
  exit 0
fi

curl -sf -X DELETE \
  -H "Authorization: Bearer ${CV_HUB_PAT}" \
  "${CV_HUB_API}/api/v1/executors/${CV_HUB_EXECUTOR_ID}" \
  >/dev/null 2>&1 || true
