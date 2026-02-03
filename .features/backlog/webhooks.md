---
id: FEAT-008
title: Webhooks / Outbound Event Notifications
priority: high
effort: large
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: [FEAT-016]
---

# Webhooks / Outbound Event Notifications

## Problem

cv-hub has no way to notify external systems when events occur (push, PR opened, issue created, etc.). This blocks CI/CD integrations, chatbot notifications, deployment automation, and any third-party integration workflow. Webhooks are a fundamental GitHub feature that every serious user expects.

## Solution

Implement a full webhook system:
1. Users/org admins register webhook endpoints per-repository or per-organization
2. When triggering events occur (push, PR, issue, etc.), the system fires HTTP POST requests to registered endpoints
3. Delivery tracking with retry logic for failed deliveries
4. HMAC signature verification so receivers can validate payloads

## Acceptance Criteria

- [ ] Schema: `webhook_endpoints` table (id, repository_id, org_id, url, secret, events, active, created_at)
- [ ] Schema: `webhook_deliveries` table (id, webhook_id, event, payload, status_code, response, attempts, delivered_at)
- [ ] Service: `registerWebhook()`, `deleteWebhook()`, `updateWebhook()`, `listWebhooks()`
- [ ] Service: `triggerEvent()` dispatches to all matching webhooks
- [ ] Service: `retryFailedDeliveries()` with exponential backoff (max 3 retries)
- [ ] HMAC-SHA256 signature in `X-Hub-Signature-256` header
- [ ] Routes: `POST /api/repos/:owner/:repo/hooks` - register webhook
- [ ] Routes: `GET /api/repos/:owner/:repo/hooks` - list webhooks
- [ ] Routes: `PATCH /api/repos/:owner/:repo/hooks/:id` - update webhook
- [ ] Routes: `DELETE /api/repos/:owner/:repo/hooks/:id` - delete webhook
- [ ] Routes: `GET /api/repos/:owner/:repo/hooks/:id/deliveries` - delivery log
- [ ] Routes: `POST /api/repos/:owner/:repo/hooks/:id/ping` - test webhook
- [ ] Event types: push, pull_request, issues, issue_comment, create, delete, release, member
- [ ] Event triggers wired into existing services (PR service, issue service, git HTTP service)
- [ ] Async delivery via background queue (Redis-based)
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/webhooks.ts` - Database schema
- `apps/api/src/services/webhook.service.ts` - Core webhook logic
- `apps/api/src/services/webhook-delivery.service.ts` - HTTP delivery + retry
- `apps/api/src/routes/webhooks.ts` - Route handlers

**Files to modify:**
- `apps/api/src/db/schema/index.ts` - Export webhook schema
- `apps/api/src/app.ts` - Mount webhook routes
- `apps/api/src/services/pr.service.ts` - Trigger PR events
- `apps/api/src/services/issue.service.ts` - Trigger issue events
- `apps/api/src/services/git/git-http.service.ts` - Trigger push events
- `apps/api/src/services/git/ssh-server.ts` - Trigger push events on SSH push

**Key considerations:**
- Use Redis pub/sub or Bull queue for async delivery
- Payload format should match GitHub's webhook payload structure for compatibility
- Secret is hashed before storage, used for HMAC signing
- Delivery timeout: 10 seconds per attempt
- Rate limit: max 25 webhooks per repository

## Open Questions

- [ ] Should we support organization-level webhooks (fire for all repos)?
- [ ] Should webhook delivery run in a separate worker process?
