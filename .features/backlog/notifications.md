---
id: FEAT-010
title: In-App Notifications System
priority: high
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# In-App Notifications System

## Problem

Users have no way to know when someone reviews their PR, mentions them in an issue, or when a repository they watch has activity. There is no notification infrastructure at all.

## Solution

Build a notification system that tracks events relevant to each user, marks them read/unread, and supports filtering by type. Optional WebSocket support for real-time delivery can come later.

## Acceptance Criteria

- [ ] Schema: `notifications` table (id, user_id, type, title, body, related_entity_type, related_entity_id, read_at, created_at)
- [ ] Schema: `notification_preferences` table (user_id, type, enabled, email_enabled)
- [ ] Service: `createNotification(userId, type, title, body, relatedEntity)`
- [ ] Service: `getNotifications(userId, { unreadOnly, type, limit, offset })`
- [ ] Service: `markRead(notificationId)`, `markAllRead(userId)`
- [ ] Service: `getUnreadCount(userId)`
- [ ] Routes: `GET /api/notifications` - list notifications
- [ ] Routes: `GET /api/notifications/unread-count` - unread count
- [ ] Routes: `PATCH /api/notifications/:id/read` - mark read
- [ ] Routes: `POST /api/notifications/mark-all-read` - mark all read
- [ ] Routes: `GET /api/notifications/preferences` - get preferences
- [ ] Routes: `PUT /api/notifications/preferences` - update preferences
- [ ] Notification types: pr_review, pr_merged, pr_comment, issue_assigned, issue_comment, mention, repo_push, release
- [ ] Wire into PR service, issue service, comment handlers
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/notifications.ts`
- `apps/api/src/services/notification.service.ts`
- `apps/api/src/routes/notifications.ts`

**Files to modify:**
- `apps/api/src/db/schema/index.ts` - Export notification schema
- `apps/api/src/app.ts` - Mount notification routes
- `apps/api/src/services/pr.service.ts` - Trigger notifications on PR events
- `apps/api/src/services/issue.service.ts` - Trigger notifications on issue events

**Key considerations:**
- Keep notification creation fast (don't block the request)
- Batch notifications for watchers (e.g., 10 pushes = 1 notification)
- Respect user preferences before creating notifications
- Future: WebSocket channel for real-time push
