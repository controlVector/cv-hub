---
id: FEAT-031
title: AI Conversation Persistence
priority: low
effort: small
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# AI Conversation Persistence

## Problem

AI assistant conversations are ephemeral. Users lose context when they navigate away or refresh the page. There's no history of past interactions.

## Solution

Store conversation threads in the database, allowing users to resume conversations and reference past interactions.

## Acceptance Criteria

- [ ] Schema: `ai_conversations` table (id, user_id, repository_id, title, created_at, updated_at)
- [ ] Schema: `ai_messages` table (id, conversation_id, role, content, metadata, created_at)
- [ ] Service: `createConversation()`, `addMessage()`, `getConversation()`, `listConversations()`
- [ ] Routes: `GET /api/repos/:owner/:repo/assistant/conversations` - list conversations
- [ ] Routes: `POST /api/repos/:owner/:repo/assistant/conversations` - create conversation
- [ ] Routes: `GET /api/repos/:owner/:repo/assistant/conversations/:id` - get with messages
- [ ] Routes: `DELETE /api/repos/:owner/:repo/assistant/conversations/:id` - delete conversation
- [ ] Auto-title conversations from first message
- [ ] Message metadata stores: model used, tokens consumed, context sources
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/ai-conversations.ts`
- `apps/api/src/services/conversation.service.ts`
- `apps/api/src/routes/conversations.ts`

**Key considerations:**
- Store both user and assistant messages
- Metadata tracks which files/vectors were used for context
- Consider message size limits (large code blocks)
- Conversation archival after 30 days of inactivity
