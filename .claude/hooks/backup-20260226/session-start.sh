#!/usr/bin/env bash
# Claude Code hook: SessionStart
# Registers executor with CV-Hub and injects initial context.
# Falls back to local cv knowledge CLI if no API credentials.
set -euo pipefail

# ── Load CV-Hub credentials ──────────────────────────────────────────
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

# Read hook input from stdin
input=$(cat)
session_id=$(echo "$input" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
cwd=$(echo "$input" | grep -o '"cwd":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
cwd="${cwd:-$(pwd)}"

# Detect owner/repo from git remote
repo_url=$(git -C "$cwd" remote get-url origin 2>/dev/null || true)
repo_name=""
if [[ -n "$repo_url" ]]; then
  repo_name=$(echo "$repo_url" | sed -E 's#\.git$##' | sed -E 's#.*[:/]([^/]+/[^/]+)$#\1#')
fi

# ── API path: register executor + inject context ─────────────────────
if [[ -n "${CV_HUB_PAT:-}" && -n "${CV_HUB_API:-}" ]]; then
  hostname=$(hostname -s 2>/dev/null || echo "unknown")
  executor_name="claude-code:${hostname}:${session_id:0:8}"

  payload=$(cat <<EOFPAYLOAD
{
  "name": "${executor_name}",
  "type": "claude_code",
  "workspace_root": "${cwd}",
  "capabilities": {
    "tools": ["bash", "read", "write", "edit", "glob", "grep"],
    "maxConcurrentTasks": 1
  }
}
EOFPAYLOAD
)

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
    [[ -n "${CV_HUB_ORG_OVERRIDE:-}" ]] && echo "CV_HUB_ORG_OVERRIDE=${CV_HUB_ORG_OVERRIDE}" >> "$CLAUDE_ENV_FILE"
  fi

  # Context Engine: inject initial context
  if [[ -n "$repo_name" && -n "$session_id" ]]; then
    owner="${CV_HUB_ORG_OVERRIDE:-${repo_name%%/*}}"
    repoSlug="${repo_name##*/}"

    ctx_resp=$(curl -sf -X POST \
      -H "Authorization: Bearer ${CV_HUB_PAT}" \
      -H "Content-Type: application/json" \
      -d "{\"session_id\":\"${session_id}\",\"executor_id\":\"${executor_id:-}\",\"concern\":\"codebase\"}" \
      "${CV_HUB_API}/api/v1/repos/${owner}/${repoSlug}/context-engine/init" 2>/dev/null) || true

    if [[ -n "$ctx_resp" ]]; then
      ctx_md=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('context_markdown',''))" <<< "$ctx_resp" 2>/dev/null || true)
      if [[ -n "$ctx_md" ]]; then
        echo "$ctx_md"
      fi
    fi
  fi
else
  # ── CLI fallback: local knowledge graph ──────────────────────────────
  if [[ -n "$session_id" && -n "${CLAUDE_ENV_FILE:-}" ]]; then
    echo "CV_SESSION_ID=${session_id}" >> "$CLAUDE_ENV_FILE"
  fi

  files_csv=""
  if git rev-parse --git-dir >/dev/null 2>&1; then
    changed=$(git diff --name-only HEAD 2>/dev/null | head -10 | tr '\n' ',' || true)
    changed="${changed%,}"
    [[ -n "$changed" ]] && files_csv="$changed"
  fi

  if [[ -n "$files_csv" ]] && command -v cv >/dev/null 2>&1; then
    cv knowledge query --files "$files_csv" --exclude-session "${session_id:-}" --limit 5 2>/dev/null || true
  fi
fi
