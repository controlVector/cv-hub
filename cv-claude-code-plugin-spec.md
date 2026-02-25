# CV-Connect: Control Vector Plugin for Claude Code

## Product Spec — February 25, 2026

**Owner:** Control Vector LLC
**Contact:** schmotz@controlvector.io
**Branding:** Control Vector (NOT Nyx Industries)

---

## 1. What This Is

A Claude Code plugin that wires every Claude Code session — local, remote-controlled, or headless — into CV-Hub's orchestration and safety layer. Any developer running Claude Code with CV-Connect installed gets:

- **Session registration** — every session auto-registers with CV-Hub
- **Task dispatch** — CV-Hub can assign structured tasks to registered sessions
- **Observability** — every tool use, file change, and completion event reports to CV-Hub
- **Policy enforcement** — CV-Safe rules execute deterministically before dangerous operations via PreToolUse hooks
- **Thread continuity** — session context bridges into CV-Git's knowledge graph so the next session picks up where this one left off

The plugin is a thin client. All intelligence lives in CV-Hub and CV-Git. The plugin just hooks Claude Code's lifecycle events and relays structured JSON.

---

## 2. Why Now

Anthropic shipped Remote Control today (Feb 25, 2026). It gives developers a viewport into a single local session from their phone. It does NOT provide:

- Multi-session orchestration
- Task queuing or dispatch
- Cross-session knowledge continuity
- Policy enforcement or safety guardrails
- Observability or audit trails

Control Vector provides all of the above. CV-Connect is the bridge that makes every Claude Code session — including Remote Control sessions — a managed node in the Control Vector platform.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CV-Hub (mcp.controlvector.io)         │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌──────────┐  │
│  │ Sessions │  │  Tasks   │  │ Events │  │ Policies │  │
│  │ Registry │  │  Queue   │  │  Log   │  │ (CV-Safe)│  │
│  └────▲─────┘  └────┬─────┘  └───▲────┘  └────┬─────┘  │
│       │             │            │             │         │
└───────┼─────────────┼────────────┼─────────────┼────────┘
        │             │            │             │
    HTTPS/TLS     HTTPS/TLS   HTTPS/TLS     HTTPS/TLS
        │             │            │             │
┌───────┼─────────────┼────────────┼─────────────┼────────┐
│       │     CV-Connect Plugin (Claude Code)    │        │
│       │             │            │             │         │
│  SessionStart   Stop/Poll    PostToolUse   PreToolUse   │
│  SessionEnd     SubagentStop               (gate)       │
│                                                         │
│  Claude Code Instance (Z840, laptop, CI, etc.)          │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Hook Event Mapping

| Claude Code Event | CV-Connect Action | CV-Hub Endpoint |
|---|---|---|
| **SessionStart** | Register session, pull pending tasks, load CV-Git context | `POST /api/sessions` + `GET /api/tasks?target={machine_id}&status=pending` |
| **PreToolUse** | Check tool + args against CV-Safe policy ruleset. Block or modify if policy violated. | `POST /api/policy/check` |
| **PostToolUse** | Log tool name, args, result summary, duration, file paths touched | `POST /api/events` |
| **Stop** | Report session completion, push session summary to CV-Git thread, check for queued follow-up tasks | `PATCH /api/sessions/{id}` + `POST /api/threads/{id}/segments` |
| **SubagentStop** | Log subagent completion, link to parent session | `POST /api/events` (type: subagent_complete) |
| **SessionEnd** | Final cleanup, mark session closed, flush any buffered events | `PATCH /api/sessions/{id}` (status: closed) |
| **PreCompact** | Capture pre-compaction summary and push to CV-Git as a context checkpoint | `POST /api/threads/{id}/checkpoints` |

---

## 5. Configuration

The plugin reads from a `.cv-connect.json` in the project root or `~/.cv-connect/config.json` globally:

```json
{
  "cv_hub_url": "https://mcp.controlvector.io",
  "machine_id": "z840-primary",
  "auth": {
    "method": "oauth",
    "client_id": "cv-connect-plugin",
    "token_path": "~/.cv-connect/token.json"
  },
  "policy": {
    "enabled": true,
    "mode": "enforce",
    "fallback_on_network_error": "warn"
  },
  "events": {
    "buffer_size": 50,
    "flush_interval_seconds": 10,
    "log_tool_results": false
  },
  "tasks": {
    "poll_on_session_start": true,
    "auto_accept": false
  },
  "thread": {
    "cv_git_integration": true,
    "checkpoint_on_compact": true
  }
}
```

---

## 6. CV-Hub API Contract (New Endpoints)

These are the new endpoints CV-Hub needs to support the plugin. They layer onto the existing CV-Hub API at mcp.controlvector.io.

### 6.1 Sessions

```
POST   /api/sessions
  Body: { machine_id, project_dir, branch, session_id, claude_version, started_at }
  Returns: { id, pending_tasks: [...] }

PATCH  /api/sessions/{id}
  Body: { status: "completed"|"closed"|"error", summary?, duration_seconds? }

GET    /api/sessions
  Query: ?machine_id=&status=&after=
```

### 6.2 Events

```
POST   /api/events
  Body: { session_id, event_type, timestamp, payload }
  Accepts batch: [{ ... }, { ... }]

  event_type enum:
    tool_use        — PostToolUse data
    subagent_complete — SubagentStop data
    policy_block    — PreToolUse denial
    policy_warn     — PreToolUse warning
    checkpoint      — PreCompact summary
```

### 6.3 Policy

```
POST   /api/policy/check
  Body: { tool_name, tool_input, session_id, project_dir }
  Returns: { decision: "allow"|"deny"|"modify", reason?, updated_input? }
```

### 6.4 Tasks (extends existing)

```
GET    /api/tasks
  Query: ?target={machine_id}&status=pending

PATCH  /api/tasks/{id}
  Body: { status: "running"|"completed"|"failed", claimed_by, result?, summary? }
```

### 6.5 Thread Segments (CV-Git bridge)

```
POST   /api/threads/{thread_id}/segments
  Body: { session_id, summary, tools_used[], files_touched[], decisions[] }

POST   /api/threads/{thread_id}/checkpoints
  Body: { session_id, context_summary, pre_compaction: true }
```

---

## 7. Hook Implementation Details

### 7.1 SessionStart Hook

```bash
#!/bin/bash
# cv-connect-session-start.sh
# Reads: session_id, cwd, transcript_path from stdin JSON
# Outputs: stdout becomes Claude's context

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
CWD=$(echo "$INPUT" | jq -r '.cwd')
BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Load config
CONFIG=$(cat ~/.cv-connect/config.json 2>/dev/null || cat "$CWD/.cv-connect.json" 2>/dev/null)
CV_HUB_URL=$(echo "$CONFIG" | jq -r '.cv_hub_url')
MACHINE_ID=$(echo "$CONFIG" | jq -r '.machine_id')
TOKEN=$(cat ~/.cv-connect/token.json 2>/dev/null | jq -r '.access_token')

# Register session with CV-Hub
RESPONSE=$(curl -s -X POST "$CV_HUB_URL/api/sessions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg mid "$MACHINE_ID" \
    --arg dir "$CWD" \
    --arg branch "$BRANCH" \
    --arg sid "$SESSION_ID" \
    '{machine_id:$mid, project_dir:$dir, branch:$branch, session_id:$sid}')")

# Check for pending tasks
TASKS=$(echo "$RESPONSE" | jq -r '.pending_tasks // empty')
if [ -n "$TASKS" ] && [ "$TASKS" != "[]" ]; then
  TASK_COUNT=$(echo "$TASKS" | jq 'length')
  echo "CV-Hub: $TASK_COUNT pending task(s) for this machine. Use 'cv-task list' to review."
fi

# Load CV-Git context if available
if echo "$CONFIG" | jq -e '.thread.cv_git_integration' > /dev/null 2>&1; then
  CONTEXT=$(curl -s "$CV_HUB_URL/api/threads/latest?project_dir=$CWD" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.context_summary // empty')
  if [ -n "$CONTEXT" ]; then
    echo "CV-Git Context from last session: $CONTEXT"
  fi
fi
```

### 7.2 PreToolUse Hook (CV-Safe Policy Gate)

```bash
#!/bin/bash
# cv-connect-policy-check.sh
# Exit 0 = allow, Exit 2 = deny
# Can output JSON with updatedInput to modify tool args

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
CWD=$(echo "$INPUT" | jq -r '.cwd')

CONFIG=$(cat ~/.cv-connect/config.json 2>/dev/null || cat "$CWD/.cv-connect.json" 2>/dev/null)
CV_HUB_URL=$(echo "$CONFIG" | jq -r '.cv_hub_url')
TOKEN=$(cat ~/.cv-connect/token.json 2>/dev/null | jq -r '.access_token')
POLICY_ENABLED=$(echo "$CONFIG" | jq -r '.policy.enabled // false')
POLICY_MODE=$(echo "$CONFIG" | jq -r '.policy.mode // "warn"')
FALLBACK=$(echo "$CONFIG" | jq -r '.policy.fallback_on_network_error // "warn"')

if [ "$POLICY_ENABLED" != "true" ]; then
  exit 0
fi

# Call CV-Safe policy check
RESULT=$(curl -s --max-time 5 -X POST "$CV_HUB_URL/api/policy/check" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg tn "$TOOL_NAME" \
    --argjson ti "$TOOL_INPUT" \
    --arg sid "$SESSION_ID" \
    --arg dir "$CWD" \
    '{tool_name:$tn, tool_input:$ti, session_id:$sid, project_dir:$dir}')" 2>/dev/null)

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  # Network error — apply fallback
  if [ "$FALLBACK" = "deny" ]; then
    echo '{"permissionDecision":"deny","reason":"CV-Safe: policy server unreachable, denying by default"}'
    exit 2
  fi
  # warn or allow — let it through
  exit 0
fi

DECISION=$(echo "$RESULT" | jq -r '.decision')
REASON=$(echo "$RESULT" | jq -r '.reason // empty')

case "$DECISION" in
  "deny")
    if [ "$POLICY_MODE" = "enforce" ]; then
      echo "{\"permissionDecision\":\"deny\",\"reason\":\"CV-Safe: $REASON\"}"
      exit 2
    else
      echo "{\"systemMessage\":\"CV-Safe warning: $REASON\"}"
      exit 0
    fi
    ;;
  "modify")
    UPDATED=$(echo "$RESULT" | jq -c '.updated_input')
    echo "{\"updatedInput\":$UPDATED}"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
```

### 7.3 PostToolUse Hook (Event Logger)

```bash
#!/bin/bash
# cv-connect-post-tool.sh
# Buffers events and flushes periodically

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
CWD=$(echo "$INPUT" | jq -r '.cwd')
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Extract relevant fields without logging full results (privacy)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.command // "N/A"' 2>/dev/null)

# Append to buffer file
BUFFER_FILE="/tmp/cv-connect-events-${SESSION_ID}.jsonl"
jq -n \
  --arg sid "$SESSION_ID" \
  --arg type "tool_use" \
  --arg ts "$TIMESTAMP" \
  --arg tool "$TOOL_NAME" \
  --arg file "$FILE_PATH" \
  '{session_id:$sid, event_type:$type, timestamp:$ts, payload:{tool:$tool, target:$file}}' \
  >> "$BUFFER_FILE"

# Flush if buffer exceeds threshold
BUFFER_SIZE=$(wc -l < "$BUFFER_FILE" 2>/dev/null || echo 0)
CONFIG=$(cat ~/.cv-connect/config.json 2>/dev/null || cat "$CWD/.cv-connect.json" 2>/dev/null)
FLUSH_THRESHOLD=$(echo "$CONFIG" | jq -r '.events.buffer_size // 50')

if [ "$BUFFER_SIZE" -ge "$FLUSH_THRESHOLD" ]; then
  CV_HUB_URL=$(echo "$CONFIG" | jq -r '.cv_hub_url')
  TOKEN=$(cat ~/.cv-connect/token.json 2>/dev/null | jq -r '.access_token')
  
  # Batch POST
  EVENTS=$(cat "$BUFFER_FILE" | jq -s '.')
  curl -s --max-time 5 -X POST "$CV_HUB_URL/api/events" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$EVENTS" > /dev/null 2>&1 &
  
  # Clear buffer
  > "$BUFFER_FILE"
fi
```

### 7.4 Stop Hook (Session Complete + Thread Bridge)

```bash
#!/bin/bash
# cv-connect-stop.sh
# Reports completion, flushes events, bridges to CV-Git thread

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path')
CWD=$(echo "$INPUT" | jq -r '.cwd')

CONFIG=$(cat ~/.cv-connect/config.json 2>/dev/null || cat "$CWD/.cv-connect.json" 2>/dev/null)
CV_HUB_URL=$(echo "$CONFIG" | jq -r '.cv_hub_url')
TOKEN=$(cat ~/.cv-connect/token.json 2>/dev/null | jq -r '.access_token')

# Flush remaining buffered events
BUFFER_FILE="/tmp/cv-connect-events-${SESSION_ID}.jsonl"
if [ -f "$BUFFER_FILE" ] && [ -s "$BUFFER_FILE" ]; then
  EVENTS=$(cat "$BUFFER_FILE" | jq -s '.')
  curl -s --max-time 5 -X POST "$CV_HUB_URL/api/events" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$EVENTS" > /dev/null 2>&1
  rm -f "$BUFFER_FILE"
fi

# Extract session summary from transcript (last N lines)
if [ -f "$TRANSCRIPT" ]; then
  SUMMARY=$(tail -20 "$TRANSCRIPT" | jq -s -R 'split("\n") | map(select(length > 0)) | join(" ")' 2>/dev/null || echo "Session completed")
else
  SUMMARY="\"Session completed\""
fi

# Mark session complete
curl -s --max-time 5 -X PATCH "$CV_HUB_URL/api/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"completed\",\"summary\":$SUMMARY}" > /dev/null 2>&1

# Bridge to CV-Git thread if enabled
CV_GIT=$(echo "$CONFIG" | jq -r '.thread.cv_git_integration // false')
if [ "$CV_GIT" = "true" ]; then
  # Get files touched from git diff
  FILES=$(git -C "$CWD" diff --name-only HEAD 2>/dev/null | jq -R -s 'split("\n") | map(select(length > 0))')
  
  curl -s --max-time 5 -X POST "$CV_HUB_URL/api/threads/auto/segments" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg sid "$SESSION_ID" \
      --argjson summary "$SUMMARY" \
      --argjson files "$FILES" \
      '{session_id:$sid, summary:$summary, files_touched:$files}')" > /dev/null 2>&1
fi
```

### 7.5 PreCompact Hook (Context Checkpoint)

```bash
#!/bin/bash
# cv-connect-pre-compact.sh
# Captures context before compaction so CV-Git preserves it

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path')
CWD=$(echo "$INPUT" | jq -r '.cwd')

CONFIG=$(cat ~/.cv-connect/config.json 2>/dev/null || cat "$CWD/.cv-connect.json" 2>/dev/null)
CV_HUB_URL=$(echo "$CONFIG" | jq -r '.cv_hub_url')
TOKEN=$(cat ~/.cv-connect/token.json 2>/dev/null | jq -r '.access_token')
CHECKPOINT_ENABLED=$(echo "$CONFIG" | jq -r '.thread.checkpoint_on_compact // false')

if [ "$CHECKPOINT_ENABLED" = "true" ] && [ -f "$TRANSCRIPT" ]; then
  # Capture recent transcript as checkpoint
  CONTEXT=$(tail -50 "$TRANSCRIPT" | jq -s -R 'split("\n") | map(select(length > 0)) | join(" ")')
  
  curl -s --max-time 5 -X POST "$CV_HUB_URL/api/threads/auto/checkpoints" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg sid "$SESSION_ID" \
      --argjson ctx "$CONTEXT" \
      '{session_id:$sid, context_summary:$ctx, pre_compaction:true}')" > /dev/null 2>&1
fi
```

---

## 8. Claude Code Settings Integration

The plugin installs as a project-level `.claude/settings.json` or can be added globally:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.cv-connect/hooks/session-start.sh",
            "timeout": 15
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.cv-connect/hooks/policy-check.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.cv-connect/hooks/post-tool.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.cv-connect/hooks/stop.sh",
            "timeout": 15
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.cv-connect/hooks/subagent-stop.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.cv-connect/hooks/pre-compact.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.cv-connect/hooks/session-end.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

---

## 9. Installation Flow

```bash
# 1. Install CV-Connect
npm install -g @controlvector/cv-connect

# 2. Authenticate with CV-Hub
cv-connect login
# Opens browser → CV-Hub OAuth → stores token at ~/.cv-connect/token.json

# 3. Register this machine
cv-connect init --machine-id z840-primary
# Creates ~/.cv-connect/config.json
# Installs hooks to ~/.cv-connect/hooks/
# Adds to ~/.claude/settings.json (global) or .claude/settings.json (project)

# 4. Verify
cv-connect status
# Shows: authenticated, machine registered, hooks installed, CV-Hub reachable
```

---

## 10. Known Limitations & Workarounds

| Issue | Impact | Workaround |
|---|---|---|
| SubagentStop shares session_id across subagents (GitHub #7881) | Can't distinguish which subagent finished | Use transcript_path + timestamp correlation; lobby for fix |
| Hooks snapshot at session start | Config changes require session restart | Document this clearly; provide `cv-connect reload` that reminds user |
| Hook timeout is 10 min max | Policy checks must be fast | Local policy cache with async refresh; fail-open with warning |
| No inbound push to Claude Code | Can't push new tasks mid-session | SessionStart polls for tasks; Stop hook checks for follow-ups |
| Remote Control is closed | Can't programmatically interact with RC sessions | Irrelevant — hooks fire regardless of how the session is accessed |

---

## 11. Competitive Positioning

| Capability | Anthropic Remote Control | CV-Connect |
|---|---|---|
| View session from phone | Yes | N/A (complementary) |
| Multi-machine dispatch | No | Yes |
| Task queuing | No | Yes |
| Policy enforcement | No | Yes (CV-Safe) |
| Cross-session knowledge | No | Yes (CV-Git threads) |
| Audit trail | No | Yes (event log) |
| Compaction recovery | No | Yes (PreCompact checkpoints) |
| Works with Remote Control | N/A | Yes (hooks fire on all sessions) |

**Tagline:** "Anthropic lets you watch one session. Control Vector lets you orchestrate all of them."
