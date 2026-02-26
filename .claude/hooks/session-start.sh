#!/usr/bin/env bash
# Claude Code hook: SessionStart
# Registers this session as an executor with CV-Hub.
# Reads session JSON from stdin, writes CV_HUB_EXECUTOR_ID to $CLAUDE_ENV_FILE.
set -euo pipefail

CRED_FILE="${HOME}/.config/cv-hub/credentials"

# Load credentials — silently exit if not configured
if [[ ! -f "$CRED_FILE" ]]; then
  exit 0
fi
# shellcheck source=/dev/null
source "$CRED_FILE"

if [[ -z "${CV_HUB_PAT:-}" || -z "${CV_HUB_API:-}" ]]; then
  exit 0
fi

# Read hook input from stdin
input=$(cat)
session_id=$(echo "$input" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
cwd=$(echo "$input" | grep -o '"cwd":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
cwd="${cwd:-$(pwd)}"

# Detect owner/repo from git remote
repo_url=$(git -C "$cwd" remote get-url origin 2>/dev/null || true)
repo_name=""
if [[ -n "$repo_url" ]]; then
  # Extract owner/repo from SSH or HTTPS URLs, strip .git suffix
  repo_name=$(echo "$repo_url" | sed -E 's#\.git$##' | sed -E 's#.*[:/]([^/]+/[^/]+)$#\1#')
fi

# Build executor name
hostname=$(hostname -s 2>/dev/null || echo "unknown")
executor_name="claude-code:${hostname}:${session_id:0:8}"

# Build JSON payload
payload=$(cat <<EOF
{
  "name": "${executor_name}",
  "type": "claude_code",
  "workspace_root": "${cwd}",
  "capabilities": {
    "tools": ["bash", "read", "write", "edit", "glob", "grep"],
    "maxConcurrentTasks": 1
  }
}
EOF
)

# Register executor (non-fatal — context injection proceeds even if this fails)
resp=$(curl -sf -X POST \
  -H "Authorization: Bearer ${CV_HUB_PAT}" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "${CV_HUB_API}/api/v1/executors" 2>/dev/null) || resp=""

executor_id=$(echo "$resp" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

if [[ -n "$executor_id" && -n "${CLAUDE_ENV_FILE:-}" ]]; then
  echo "CV_HUB_EXECUTOR_ID=${executor_id}" >> "$CLAUDE_ENV_FILE"
  echo "CV_HUB_API=${CV_HUB_API}" >> "$CLAUDE_ENV_FILE"
  echo "CV_HUB_PAT=${CV_HUB_PAT}" >> "$CLAUDE_ENV_FILE"
  [[ -n "$repo_name" ]] && echo "CV_HUB_REPO=${repo_name}" >> "$CLAUDE_ENV_FILE"
  [[ -n "$session_id" ]] && echo "CV_HUB_SESSION_ID=${session_id}" >> "$CLAUDE_ENV_FILE"
fi

# ── Context Engine: inject initial context ─────────────────────────
if [[ -n "$repo_name" && -n "$session_id" ]]; then
  owner="${repo_name%%/*}"
  repoSlug="${repo_name##*/}"

  # Allow local owner override (git remote org may differ from CV-Hub org slug)
  CV_HUB_ORG_OVERRIDE="${CV_HUB_ORG_OVERRIDE:-}"
  if [[ -n "$CV_HUB_ORG_OVERRIDE" ]]; then
    owner="$CV_HUB_ORG_OVERRIDE"
  fi
  ctx_resp=$(curl -sf -X POST \
    -H "Authorization: Bearer ${CV_HUB_PAT}" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"${session_id}\",\"executor_id\":\"${executor_id:-}\",\"concern\":\"codebase\"}" \
    "${CV_HUB_API}/api/v1/repos/${owner}/${repoSlug}/context-engine/init" 2>/dev/null) || true

  # Extract context_markdown and output to stdout (Claude Code will see it)
  if [[ -n "$ctx_resp" ]]; then
    # Use python for reliable JSON extraction if available, else grep fallback
    ctx_md=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('context_markdown',''))" <<< "$ctx_resp" 2>/dev/null || true)
    if [[ -n "$ctx_md" ]]; then
      echo "$ctx_md"
    fi
  fi
fi
