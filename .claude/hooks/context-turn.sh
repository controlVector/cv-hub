#!/usr/bin/env bash
# Claude Code hook: Stop (context engine turn injection + egress)
# Fires after each response cycle. Calls the context engine /turn endpoint
# with recently touched files. If new context is available, outputs to stdout
# so Claude Code picks it up as supplemental context.
# After the /turn call, fires an async /egress call to push session knowledge
# back into the graph.
set -euo pipefail

if [[ -z "${CV_HUB_API:-}" || -z "${CV_HUB_PAT:-}" || -z "${CV_HUB_REPO:-}" || -z "${CV_HUB_SESSION_ID:-}" ]]; then
  exit 0
fi

owner="${CV_HUB_REPO%%/*}"
repoSlug="${CV_HUB_REPO##*/}"

# Read hook input from stdin (Stop hook receives session_id, transcript_path, last_assistant_message, etc.)
input=$(cat)

# ── Turn counter ──────────────────────────────────────────────────────
turn_file="/tmp/cv-connect-turn-${CV_HUB_SESSION_ID}"
if [[ -f "$turn_file" ]]; then
  turn_number=$(( $(cat "$turn_file") + 1 ))
else
  turn_number=1
fi
echo "$turn_number" > "$turn_file"

# ── Extract last assistant message from hook input ────────────────────
transcript_segment=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    msg = d.get('last_assistant_message', '')
    # Cap at 2000 chars for egress
    print(msg[:2000])
except:
    print('')
" <<< "$input" 2>/dev/null || true)

# ── Extract files touched from recent git changes ────────────────────
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

# ── Pull: call /turn for context injection ────────────────────────────
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

# ── Push: fire-and-forget /egress call ────────────────────────────────
# Runs in background so it doesn't block Claude Code's response cycle.
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
