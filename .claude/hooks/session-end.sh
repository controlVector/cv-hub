#!/usr/bin/env bash
# Claude Code hook: SessionEnd
# Unregisters this executor from CV-Hub.
set -euo pipefail

# ── Load CV-Hub credentials (fallback if env vars not propagated) ────
if [[ -z "${CV_HUB_API:-}" || -z "${CV_HUB_PAT:-}" ]]; then
  CRED_FILE=""
  for candidate in "${CLAUDE_PROJECT_DIR:-.}/.claude/cv-hub.credentials" \
                   "/home/schmotz/.config/cv-hub/credentials" \
                   "/root/.config/cv-hub/credentials" \
                   "${HOME}/.config/cv-hub/credentials"; do
    if [[ -f "$candidate" ]]; then
      CRED_FILE="$candidate"
      break
    fi
  done
  if [[ -n "$CRED_FILE" ]]; then
    set -a; source "$CRED_FILE"; set +a
  fi
fi

# These come from CLAUDE_ENV_FILE, set by session-start.sh
if [[ -z "${CV_HUB_EXECUTOR_ID:-}" || -z "${CV_HUB_API:-}" || -z "${CV_HUB_PAT:-}" ]]; then
  exit 0
fi

curl -sf -X DELETE \
  -H "Authorization: Bearer ${CV_HUB_PAT}" \
  "${CV_HUB_API}/api/v1/executors/${CV_HUB_EXECUTOR_ID}" \
  >/dev/null 2>&1 || true
