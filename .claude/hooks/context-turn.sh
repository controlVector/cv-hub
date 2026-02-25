#!/usr/bin/env bash
# Claude Code hook: Stop (context engine turn injection)
# Fires after each response cycle. Calls the context engine /turn endpoint
# with recently touched files. If new context is available, outputs to stdout
# so Claude Code picks it up as supplemental context.
set -euo pipefail

if [[ -z "${CV_HUB_API:-}" || -z "${CV_HUB_PAT:-}" || -z "${CV_HUB_REPO:-}" || -z "${CV_HUB_SESSION_ID:-}" ]]; then
  exit 0
fi

owner="${CV_HUB_REPO%%/*}"
repoSlug="${CV_HUB_REPO##*/}"

# Read hook input from stdin (Stop hook receives tool_name, tool_input, etc.)
input=$(cat)

# Extract files touched from recent git changes
files_json="[]"
if git rev-parse --git-dir >/dev/null 2>&1; then
  # Get files changed in the working tree (unstaged + staged)
  changed=$(git diff --name-only HEAD 2>/dev/null || true)
  if [[ -n "$changed" ]]; then
    files_json=$(echo "$changed" | head -20 | python3 -c "
import sys, json
files = [line.strip() for line in sys.stdin if line.strip()]
print(json.dumps(files))
" 2>/dev/null || echo "[]")
  fi
fi

# Build turn payload
# Use a rough token estimate (we don't know the real number — the hook input
# doesn't include it directly, so we pass 0 and let the server compare
# against its stored lastTokenEst)
payload=$(python3 -c "
import json
print(json.dumps({
    'session_id': '${CV_HUB_SESSION_ID}',
    'files_touched': ${files_json},
    'symbols_referenced': [],
    'turn_count': 0,
    'estimated_tokens_used': 0,
    'concern': 'codebase'
}))
" 2>/dev/null) || exit 0

resp=$(curl -sf -X POST \
  -H "Authorization: Bearer ${CV_HUB_PAT}" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "${CV_HUB_API}/api/v1/repos/${owner}/${repoSlug}/context-engine/turn" 2>/dev/null) || exit 0

# Extract context_markdown and output if non-empty
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
