# CV-Hub Setup Guide: Chat-to-Code Bridge

Connect your Claude.ai conversations directly to your Claude Code instances.
Plan in Claude.ai, execute on your machine — one command to set up, one click
to connect.

## Prerequisites

- A CV-Hub account (https://hub.controlvector.io)
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)
- Node.js 18+

## 1. Install the CV-Git CLI

```bash
npm install -g @controlVector/cv-git
```

## 2. Authenticate

```bash
cv auth login
```

This opens a browser window for OAuth. After authenticating, your credentials
are saved to `~/.config/cv-hub/credentials`.

## 3. Set Up Your Project

```bash
cd your-project
cv init -y
```

This installs Claude Code hooks that automatically register your machine
when you start a session. You'll be prompted to set a machine name — this
is the friendly name you'll use to connect from Claude.ai.

**Optional:** Set your machine name manually:

```bash
echo 'CV_HUB_MACHINE_NAME=z840-primary' >> ~/.config/cv-hub/credentials
```

## 4. Add the MCP Connector in Claude.ai

In Claude.ai, go to **Settings → MCP Connectors** and add:

```
Name: CV-Hub
URL: https://api.hub.controlvector.io/mcp
```

Claude.ai will walk you through the OAuth consent flow.

## 5. Connect a Conversation to Your Machine

Start Claude Code on your machine:

```bash
claude
```

Your machine appears in the CV-Hub dashboard within seconds. In Claude.ai,
use the `cv_connect` tool:

> "Connect me to z840-primary"

Claude.ai responds with confirmation:

```
✓ Connected to z840-primary

This conversation is now linked to your Z840 workstation.
Tasks you dispatch will go directly to this machine.

Available repos: cv-hub, cv-git, nyx-core

To disconnect: use cv_disconnect
```

## 6. Dispatch Tasks

Once connected, create tasks in Claude.ai:

> "Create a task to fix the login bug in the auth module"

The task is routed directly to your connected machine. Claude Code picks it
up on the next poll cycle.

## 7. Check Status

Use these tools in Claude.ai:

| Tool | Description |
|------|-------------|
| `cv_list_executors` | See all your machines and their status |
| `cv_connect` | Link this conversation to a machine |
| `cv_disconnect` | Unlink from current machine |
| `cv_connection_status` | Check which machine is connected |
| `create_task` | Dispatch a task to your connected machine |
| `list_tasks` | See task status and results |
| `get_task_result` | Get full task output |

## Troubleshooting

### Machine not appearing in dashboard

1. Check hooks are installed: `cv doctor`
2. Verify credentials: `cv auth list`
3. Ensure Claude Code is running (hooks fire on session start)
4. Check API is reachable: `curl https://api.hub.controlvector.io/health`

### "No online machines found"

- Start a Claude Code session on your machine
- Hooks register the executor automatically on session start
- The machine goes offline when the Claude Code session ends

### "Machine appears offline"

- Executors without a heartbeat for 5 minutes are marked offline
- Restart your Claude Code session to re-register
- Check network connectivity to the CV-Hub API

### "Already connected to a different machine"

- Use `cv_disconnect` first, then `cv_connect` to the new machine
- Each Claude.ai conversation can be linked to one machine at a time

### Machine name not showing

Add `CV_HUB_MACHINE_NAME=your-name` to `~/.config/cv-hub/credentials`,
then restart your Claude Code session.
