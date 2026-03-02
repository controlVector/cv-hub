# cv-git CLI Changes: Machine Name Support

These changes enhance the cv-git CLI to support `CV_HUB_MACHINE_NAME` for the
Chat-to-Code bridge feature. The credential file `~/.config/cv-hub/credentials`
already supports this variable (read by session-start.sh hook in cv-hub).

## 1. `cv init` — Prompt for Machine Name

**File:** `packages/cli/src/commands/init.ts`

After installing hooks and confirming credentials, check if `CV_HUB_MACHINE_NAME`
is set in the credentials file. If not:

```
$ cv init -y

✓ Hooks installed (4/4)
✓ Credentials found
✓ Repository: acme-corp/cv-hub

⚠ No machine name configured.
  Your Claude Code sessions will register as "johns-macbook-pro.local"

  Want to set a friendly name? (used in Claude.ai to connect to this machine)
  Machine name [johns-macbook-pro]: z840-primary

  ✓ Set CV_HUB_MACHINE_NAME=z840-primary in credentials

  In Claude.ai, say: "Connect me to z840-primary"
```

With `-y` flag: use hostname silently, print info message but don't prompt.

**Implementation:**
- Read credentials file (`~/.config/cv-hub/credentials`)
- Check for `CV_HUB_MACHINE_NAME` line
- If missing and interactive: use `inquirer` to prompt
- If missing and `-y`: use `os.hostname()` silently
- Append `CV_HUB_MACHINE_NAME=<value>` to credentials file

## 2. `cv auth list` / `cv auth status` — Show Machine Name

**File:** `packages/cli/src/commands/auth.ts`

There is no `cv auth status` command currently. Either add one or enhance
`cv auth list` to show CV-Hub connection info:

```
$ cv auth list

  Credentials:
  ...
  ✓ CV-Hub: api.hub.controlvector.io (john@example.com)
    Machine name: z840-primary
    Org: acme-corp
    PAT: cv_pat_a1b2... (expires: 2026-12-01)

  To connect this machine from Claude.ai:
  "Connect me to z840-primary"
```

**Implementation:**
- Read `CV_HUB_MACHINE_NAME` from credentials file
- Display in the auth list output alongside other CV-Hub info

## 3. `cv doctor` — Show Executor Status

**File:** `packages/cli/src/commands/doctor.ts`

Add a check for executor registration status:

```
$ cv doctor

✓ Hooks installed (4/4)
✓ Credentials found
✓ API reachable
✓ Repository: acme-corp/cv-hub
✓ Machine name: z840-primary
⚠ Executor not registered (start a Claude Code session to register)
```

**Implementation:**
- Read `CV_HUB_MACHINE_NAME` from credentials
- If machine name set: print ✓ with value
- If not set: print ⚠ suggesting `cv init` to configure
- Optionally: GET `/api/v1/executors` and check if any match the machine name
  - If found and online: ✓ "Executor online"
  - If found and offline: ⚠ "Executor offline (last seen: Xh ago)"
  - If not found: ⚠ "Executor not registered"

## Credentials File Format

```bash
# ~/.config/cv-hub/credentials
CV_HUB_PAT=cv_pat_xxxxx
CV_HUB_API=https://api.hub.controlvector.io
CV_HUB_MACHINE_NAME=z840-primary    # human-readable executor name
```

> **Note:** `CV_HUB_ORG_ID` is deprecated. The server now resolves the
> organization automatically from the PAT's org scope or the user's org
> membership. Old credentials files with `CV_HUB_ORG_ID` still work (the
> variable is sourced but ignored by the hook). Minimal credentials:
> `CV_HUB_PAT`, `CV_HUB_API`, and optionally `CV_HUB_MACHINE_NAME`.
