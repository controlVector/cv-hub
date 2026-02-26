#!/usr/bin/env bash
# Claude Code hook: PreCompact
# Saves a checkpoint of the current working state before compaction occurs.
# Reads the transcript path from stdin and extracts recent file/symbol refs.
# This is notification-only — cannot block compaction.
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

if [[ -z "${CV_HUB_API:-}" || -z "${CV_HUB_PAT:-}" || -z "${CV_HUB_REPO:-}" || -z "${CV_HUB_SESSION_ID:-}" ]]; then
  exit 0
fi

owner="${CV_HUB_ORG_OVERRIDE:-${CV_HUB_REPO%%/*}}"
repoSlug="${CV_HUB_REPO##*/}"

# Read hook input from stdin
input=$(cat)

# Extract summary from the last part of the transcript
# The PreCompact hook receives { summary: string } with a compaction summary
summary=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('summary', '')[:5000])
except:
    print('')
" <<< "$input" 2>/dev/null || true)

# Gather files currently in context from git status
files_json="[]"
if git rev-parse --git-dir >/dev/null 2>&1; then
  changed=$(git diff --name-only HEAD 2>/dev/null || true)
  staged=$(git diff --name-only --cached 2>/dev/null || true)
  all_files=$(echo -e "${changed}\n${staged}" | sort -u)
  if [[ -n "$all_files" ]]; then
    files_json=$(echo "$all_files" | head -30 | python3 -c "
import sys, json
files = [line.strip() for line in sys.stdin if line.strip()]
print(json.dumps(files))
" 2>/dev/null || echo "[]")
  fi
fi

# Build checkpoint payload
payload=$(python3 -c "
import json, sys
print(json.dumps({
    'session_id': '${CV_HUB_SESSION_ID}',
    'transcript_summary': sys.argv[1][:5000],
    'files_in_context': json.loads(sys.argv[2]),
    'symbols_in_context': []
}))
" "$summary" "$files_json" 2>/dev/null) || exit 0

curl -sf -X POST \
  -H "Authorization: Bearer ${CV_HUB_PAT}" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "${CV_HUB_API}/api/v1/repos/${owner}/${repoSlug}/context-engine/checkpoint" \
  >/dev/null 2>&1 || true
