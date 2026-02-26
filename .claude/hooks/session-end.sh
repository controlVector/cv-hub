#!/usr/bin/env bash
# Claude Code hook: SessionEnd
# Unregisters executor from CV-Hub, or cleans up local state.
set -euo pipefail

# ── Load CV-Hub credentials (fallback if env vars not propagated) ────
if [[ -z "${CV_HUB_API:-}" || -z "${CV_HUB_PAT:-}" ]]; then
  CRED_FILE=""
  for candidate in "${CLAUDE_PROJECT_DIR:-.}/.claude/cv-hub.credentials" \
                   "${HOME}/.config/cv-hub/credentials"; do
    if [[ -f "$candidate" ]]; then
      CRED_FILE="$candidate"
      break
    fi
  done
  if [[ -z "$CRED_FILE" && "$HOME" != "/root" && -f "/root/.config/cv-hub/credentials" ]]; then
    CRED_FILE="/root/.config/cv-hub/credentials"
  fi
  if [[ -n "$CRED_FILE" ]]; then
    set -a; source "$CRED_FILE"; set +a
  fi
fi

# ── API path: unregister executor ────────────────────────────────────
if [[ -n "${CV_HUB_EXECUTOR_ID:-}" && -n "${CV_HUB_API:-}" && -n "${CV_HUB_PAT:-}" ]]; then
  curl -sf -X DELETE \
    -H "Authorization: Bearer ${CV_HUB_PAT}" \
    "${CV_HUB_API}/api/v1/executors/${CV_HUB_EXECUTOR_ID}" \
    >/dev/null 2>&1 || true
fi

# ── Cleanup turn counter files ───────────────────────────────────────
if [[ -n "${CV_HUB_SESSION_ID:-}" ]]; then
  rm -f "/tmp/cv-connect-turn-${CV_HUB_SESSION_ID}" 2>/dev/null || true
fi
if [[ -n "${CV_SESSION_ID:-}" ]]; then
  rm -f "/tmp/cv-turn-${CV_SESSION_ID}" 2>/dev/null || true
fi
