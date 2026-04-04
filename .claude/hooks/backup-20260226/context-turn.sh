#!/usr/bin/env bash
# Claude Code hook: Stop (context engine turn injection + egress)
# Fires after each response cycle. Uses CV-Hub API if available, else local CLI.
echo "[DEBUG] CV_HUB_API=${CV_HUB_API:-UNSET} CV_HUB_SESSION_ID=${CV_HUB_SESSION_ID:-UNSET} CV_HUB_REPO=${CV_HUB_REPO:-UNSET}" >> /tmp/cv-hook-debug.log
echo "[DEBUG] HOME=$HOME CLAUDE_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-UNSET}" >> /tmp/cv-hook-debug.log
echo "[DEBUG] CV_HUB_API=${CV_HUB_API:-UNSET} CV_HUB_SESSION_ID=${CV_HUB_SESSION_ID:-UNSET} CV_HUB_REPO=${CV_HUB_REPO:-UNSET}" >> /tmp/cv-hook-debug.log
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

# ── API path ─────────────────────────────────────────────────────────
if [[ -n "${CV_HUB_API:-}" && -n "${CV_HUB_PAT:-}" && -n "${CV_HUB_REPO:-}" && -n "${CV_HUB_SESSION_ID:-}" ]]; then
  owner="${CV_HUB_ORG_OVERRIDE:-${CV_HUB_REPO%%/*}}"
  repoSlug="${CV_HUB_REPO##*/}"

  input=$(cat)

  # Turn counter
  turn_file="/tmp/cv-connect-turn-${CV_HUB_SESSION_ID}"
  if [[ -f "$turn_file" ]]; then
    turn_number=$(( $(cat "$turn_file") + 1 ))
  else
    turn_number=1
  fi
  echo "$turn_number" > "$turn_file"

  # Extract last assistant message
  transcript_segment=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    msg = d.get('last_assistant_message', '')
    print(msg[:2000])
except:
    print('')
" <<< "$input" 2>/dev/null || true)

  # Extract files touched from git changes
  files_json="[]"
  if git rev-parse --git-dir >/dev/null 2>&1; then
    changed=$(git diff --name-only HEAD 2>/dev/null || true)
    if [[ -n "$changed" ]]; then
      files_json=$(echo "$changed" | head -20 | python3 -c "
import sys, json
files = [line.strip() for line in sys.stdin if line.strip()]
print(json.dumps(files))
" 2>/dev/null || echo "[]")
    fi
  fi

  # Pull: call /turn for context injection
  payload=$(python3 -c "
import json
print(json.dumps({
    'session_id': '${CV_HUB_SESSION_ID}',
    'files_touched': ${files_json},
    'symbols_referenced': [],
    'turn_count': ${turn_number},
    'estimated_tokens_used': 0,
    'concern': 'codebase'
}))
" 2>/dev/null) || exit 0

  resp=$(curl -sf -X POST \
    -H "Authorization: Bearer ${CV_HUB_PAT}" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "${CV_HUB_API}/api/v1/repos/${owner}/${repoSlug}/context-engine/turn" 2>/dev/null) || exit 0

  ctx_md=$(python3 -c "
import sys, json
d = json.load(sys.stdin)
md = d.get('data', {}).get('context_markdown', '')
if md.strip():
    print(md)
" <<< "$resp" 2>/dev/null || true)

  if [[ -n "$ctx_md" ]]; then
    echo "$ctx_md"
  fi

  # Push: fire-and-forget /egress call
  if [[ -n "$transcript_segment" ]]; then
    egress_payload=$(python3 -c "
import json, sys
segment = sys.stdin.read()
print(json.dumps({
    'session_id': '${CV_HUB_SESSION_ID}',
    'turn_number': ${turn_number},
    'transcript_segment': segment,
    'files_touched': ${files_json},
    'symbols_referenced': [],
    'concern': 'codebase'
}))
" <<< "$transcript_segment" 2>/dev/null || true)

    if [[ -n "$egress_payload" ]]; then
      curl -sf -X POST \
        -H "Authorization: Bearer ${CV_HUB_PAT}" \
        -H "Content-Type: application/json" \
        -d "$egress_payload" \
        "${CV_HUB_API}/api/v1/repos/${owner}/${repoSlug}/context-engine/egress" \
        >/dev/null 2>&1 &
    fi
  fi

# ── CLI fallback ─────────────────────────────────────────────────────
elif [[ -n "${CV_SESSION_ID:-}" ]]; then
  input=$(cat)

  turn_file="/tmp/cv-turn-${CV_SESSION_ID}"
  if [[ -f "$turn_file" ]]; then
    turn_number=$(( $(cat "$turn_file") + 1 ))
  else
    turn_number=1
  fi
  echo "$turn_number" > "$turn_file"

  transcript_segment=""
  if command -v python3 >/dev/null 2>&1; then
    transcript_segment=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('last_assistant_message', '')[:2000])
except:
    print('')
" <<< "$input" 2>/dev/null || true)
  fi

  files_csv=""
  if git rev-parse --git-dir >/dev/null 2>&1; then
    changed=$(git diff --name-only HEAD 2>/dev/null | head -20 | tr '\n' ',' || true)
    changed="${changed%,}"
    [[ -n "$changed" ]] && files_csv="$changed"
  fi

  if [[ -n "$transcript_segment" ]] && command -v cv >/dev/null 2>&1; then
    cv knowledge egress \
      --session-id "$CV_SESSION_ID" \
      --turn "$turn_number" \
      --transcript "$transcript_segment" \
      ${files_csv:+--files "$files_csv"} \
      --concern "codebase" \
      >/dev/null 2>&1 &
  fi

  if [[ -n "$files_csv" ]] && command -v cv >/dev/null 2>&1; then
    cv knowledge query --files "$files_csv" --exclude-session "$CV_SESSION_ID" --limit 3 2>/dev/null || true
  fi
fi
