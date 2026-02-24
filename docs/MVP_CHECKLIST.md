# CV-Hub MVP Checklist

**Last updated:** 2026-02-24
**Status:** In progress toward first paying customer

---

## DONE — Completed Items

### Infrastructure & Deployment
- [x] DOKS cluster running on DigitalOcean (all pods healthy)
- [x] TLS via cert-manager + Let's Encrypt on all domains
- [x] HSTS headers on main ingress (1yr, includeSubDomains)
- [x] NFS-backed git repo storage (100Gi)
- [x] Postgres, Redis, FalkorDB, Qdrant all running with PVCs
- [x] FalkorDB pinned to `v4.2.1`, Qdrant pinned to `v1.12.4`
- [x] Automated backups (cron jobs completing successfully)
- [x] Docker images building and pushing to DO registry
- [x] Worker entry points bundled with esbuild (fixed CrashLoopBackOff)
- [x] Qdrant recovered from corrupted collections
- [x] Sentry error tracking integrated (API + Web)
- [x] Error boundary with styled fallback in `main.tsx`
- [x] 404 catch-all page for unknown routes

### Auth & Security
- [x] JWT auth with access/refresh tokens
- [x] MFA (TOTP) support
- [x] OAuth (GitHub) login flow
- [x] CSRF protection
- [x] Rate limiting (100 req/15min default, 5 req/15min strict)
- [x] `requireAuth` / `optionalAuth` middleware on all protected routes
- [x] Graph routes access control (fixed cross-tenant data leak)
- [x] Feature Flags pages using authenticated API client (fixed 401s)

### Billing & Subscriptions
- [x] Stripe checkout flow (monthly/annual for Pro/Enterprise)
- [x] Stripe webhook handler (subscription lifecycle events)
- [x] Tier limits enforcement service (`tier-limits.service.ts`)
- [x] Duplicate checkout guard (returns 400 `ALREADY_SUBSCRIBED`)
- [x] `getTierNameFromPriceId()` — proper price-to-tier lookup via env vars
- [x] `TierLimitAlert` component for frontend upgrade CTA
- [x] MCP Gateway $5/mo bolt-on add-on billing
- [x] CV-Safe pricing card on pricing page

### Web UI — Pages Wired to Real APIs
- [x] **Dashboard** — stats, quick links, empty states for AI/Activity panels
- [x] **Repositories list** — real API data, search, visibility filters
- [x] **New Repository** — creation form with org selector, tier limit handling
- [x] **Repository Detail / Code tab** — file tree, file viewer, branch selector
- [x] **Repository Detail / Pull Requests tab** — state filters (open/merged/all)
- [x] **Repository Detail / Issues tab** — search, state filters, create dialog
- [x] **Repository Detail / Actions tab** — CI/CD pipelines list
- [x] **Repository Detail / Settings tab** — description, visibility, danger zone delete
- [x] **Pull Requests page** — user PRs + review requests from real API
- [x] **Commit History** — branch selector working, navigation paths fixed
- [x] **Feature Flags Dashboard** — list, toggle, delete via authenticated API
- [x] **Feature Flag Editor** — create/edit/rules via authenticated API
- [x] **Knowledge Graph** — graph visualization
- [x] **AI Assistant** — chat interface
- [x] **Search** — code/semantic/symbol search
- [x] **Organization Settings** — members, billing
- [x] **Pricing Page** — tier cards with Stripe checkout
- [x] **Profile Page** — user settings, SSH keys, API tokens
- [x] **Login / Register / MFA** — full auth flow

---

## TODO — Must Fix Before First Customer

### P0 — Security (blocks launch)

- [x] **Change Postgres password** — rotated to strong random value
- [x] **Set Stripe production keys** — live keys, webhook, and all price IDs configured

- [x] **Fix XSS in AIAssistant.tsx** (line 408) — added HTML entity escaping before markdown transforms
  - File: `apps/web/src/pages/AIAssistant.tsx:408`

- [x] ~~**LogViewer.tsx XSS**~~ — uses `ansi-to-html` which escapes HTML by default; safe

- [x] **Permission checks on Issue/PR operations** — added author/write/admin checks to all mutations
- [x] **App Store admin bypass** — replaced no-op `requireAdmin()` with org ownership checks

### P1 — Bugs (breaks user experience)

- [x] **Dead code in NewRepository.tsx** (line 171) — fixed to `!isTierLimitError(createMutation.error)`
  - File: `apps/web/src/pages/NewRepository.tsx:171`

- [x] **OrganizationSettings form never populates** — changed `useState()` to `useEffect(..., [org])`
  - File: `apps/web/src/pages/orgs/OrganizationSettings.tsx:92`

- [x] **AI Explain button navigates to wrong route** — fixed to `/dashboard/ai-assistant`
  - File: `apps/web/src/pages/RepositoryDetail.tsx:183`

- [x] **"View Knowledge Graph" menu links to nonexistent route** — fixed to `/dashboard/graph?repo=...`
  - File: `apps/web/src/pages/RepositoryDetail.tsx:418`

- [x] **Repo pagination returns wrong total** — fixed to compute from result count + offset
- [x] **cv-git getCommit() has wrong WHERE clause** — fixed to use `commits.repositoryId` and `commits.sha`

### MCP Gateway & cv-git Integration

- [x] **OAuth clients registered** — `cv-git-cli`, `claude-code-cli`, `mcp-gateway-prod` all in database
  - `cv-git-cli`: device_code grant for CLI auth
  - `claude-code-cli`: device_code grant for Claude Code auth
  - `mcp-gateway-prod`: authorization_code + device_code + refresh_token for Claude.ai

- [x] **Device authorization page** — `/device` page for approving CLI logins
  - User enters code from terminal, sees scopes, approves/denies
  - File: `apps/web/src/pages/DeviceAuthPage.tsx`

- [x] **MCP auth supports PATs + JWTs** — `validateMCPAccessToken` now handles all 3 token types
  - Previously only validated OAuth tokens, now matches the gateway's auth logic
  - File: `apps/api/src/services/mcp-oauth.service.ts`

- [x] **Route ordering fix** — `/mcp/sdk` registered before `/mcp` to avoid middleware conflicts
  - File: `apps/api/src/app.ts`

- [x] **MCP gateway verified end-to-end** — PAT auth → billing gate → initialize → tools/list → tools/call all working
  - 44 tools exposed (repos, PRs, issues, graph, search, CI/CD, executor relay)
  - Tested: `initialize`, `tools/list`, `list_repos` all return correct data

### P2 — Polish (visible to customers, not blocking)

- [x] **Hardcoded notification badge** — hidden until real notification count is wired
  - File: `apps/web/src/components/Layout.tsx:352`

- [x] **Dashboard AI Insights / Activity Feed empty state** — improved with icons, guidance text, and CTA button
  - File: `apps/web/src/pages/Dashboard.tsx`

- [x] **Org nav link uses repo owner** — fixed to navigate to `/dashboard/orgs/{owner}/settings`
  - File: `apps/web/src/pages/RepositoryDetail.tsx:228`

- [x] **Pin Postgres/Redis to patch versions** — `postgres:16.6-alpine`, `redis:7.4-alpine`
  - File: `deploy/kubernetes/base/databases.yaml`

- [x] **Add HSTS to MCP ingress** — confirmed with `strict-transport-security: max-age=31536000; includeSubDomains`
  - File: `deploy/kubernetes/overlays/digitalocean/mcp-ingress.yaml`

- [x] **Update base ingress.yaml domains** — updated from `cv-hub.io` to `hub.controlvector.io`
  - File: `deploy/kubernetes/base/ingress.yaml`

- [x] **Pin app Docker images to registry-qualified names** — base manifests now reference `registry.digitalocean.com/cv-hub-registry/api:latest` and `web:latest`
  - Files: `deploy/kubernetes/base/api-deployment.yaml`, `worker-deployment.yaml`, `ingress.yaml`

### P3 — Tech Debt (not user-facing, do post-launch)

- [ ] **80+ `console.log` statements in API** — should use structured logger
  - Heaviest: `graph-sync.service.ts` (25+), `ssh-server.ts` (20+), `sync.service.ts` (15+)

- [ ] **Embedding service encryption not implemented** — 2 TODOs for `MFA_ENCRYPTION_KEY`
  - File: `apps/api/src/services/embedding.service.ts:225,231`

- [ ] **Rate limiter path-based key** — could be bypassed via query parameter variations
  - File: `apps/api/src/middleware/rate-limit.ts`

- [ ] **Release asset hash defaults to `'pending'`** — should validate
  - File: `apps/api/src/routes/app-store.ts:608`

---

## Spot-Check Guide

Quick routes to verify in the browser at `https://hub.controlvector.io`:

| Area | URL | What to Check |
|------|-----|---------------|
| Landing | `/` | Pricing cards, CTA buttons, branding |
| Login | `/login` | Email/password, GitHub OAuth |
| Dashboard | `/dashboard` | Stats render, nav links work |
| Repos list | `/dashboard/repositories` | Real repos load (not mock), search works |
| New repo | `/dashboard/repositories/new` | Form submits, tier limit shows on quota |
| Repo detail | `/dashboard/repositories/{owner}/{repo}` | File tree, code viewer, all 5 tabs |
| Commit history | `/dashboard/repositories/{owner}/{repo}/commits/main` | Commits load, branch selector populated |
| Pull Requests | `/dashboard/pull-requests` | Real PRs or empty state (not mock) |
| Feature Flags | `/dashboard/flags` | List loads (not 401), toggle works |
| Flag editor | `/dashboard/flags/new?organizationId=...` | Create form works |
| Org settings | `/dashboard/orgs/{slug}/settings` | Form populates with org data |
| Profile | `/dashboard/profile` | User info, SSH keys, tokens |
| Knowledge Graph | `/dashboard/graph` | Visualization loads |
| Search | `/dashboard/search?q=test` | Results appear |
| Pricing | `/pricing` | Cards render, checkout buttons work |
| 404 | `/dashboard/nonexistent` | Styled 404 page (not blank) |
| Device auth | `/device` | Code entry form, approve/deny flow |
| API health | `https://api.hub.controlvector.io/health` | `{"status":"ok"}` |
| MCP discover | `https://mcp.controlvector.io/.well-known/openid-configuration` | Full OIDC config |
| MCP resource | `https://mcp.controlvector.io/.well-known/oauth-protected-resource` | Bearer auth metadata |

---

## Infrastructure Status (as of 2026-02-24)

All pods healthy, zero crash loops, all PVCs bound.

| Service | Replicas | Status |
|---------|----------|--------|
| cv-hub-api | 2/2 | Running |
| cv-hub-web | 2/2 | Running |
| cv-hub-worker | 1/1 | Running |
| postgres-0 | 1/1 | Running |
| redis-0 | 1/1 | Running |
| falkordb-0 | 1/1 | Running |
| qdrant-0 | 1/1 | Running |
| nfs-server | 1/1 | Running |
