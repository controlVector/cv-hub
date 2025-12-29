---
id: FEAT-007
title: API Key Wallet for AI Services
priority: high
effort: large
area: api,web
status: completed
created: 2025-12-28
updated: 2025-12-28
completed: 2025-12-28
depends_on: []
blocks: []
---

# API Key Wallet for AI Services

## Problem

Users of cv-git need to manage API keys for various AI services (OpenAI, Anthropic, etc.). Currently this requires manual command-line configuration. A web-based wallet would provide:
- Easier key management
- Secure storage with encryption
- Key rotation and expiry tracking
- Usage monitoring
- Sharing keys across devices/sessions

## Solution

Build an API key wallet system with:
1. Encrypted key storage in the database
2. Web UI for CRUD operations on keys
3. API endpoints for cv-git to retrieve keys
4. Support for multiple AI providers
5. Optional usage tracking/limits

## Acceptance Criteria

- [x] Database schema for encrypted API keys
- [x] API keys encrypted at rest with user-specific key
- [ ] Web UI to add/edit/delete API keys (frontend pending)
- [x] Support for providers: OpenAI, Anthropic, Google AI, Mistral, Cohere, Groq, Together, OpenRouter, Custom
- [x] Key masking in UI (show only last 4 chars)
- [x] API endpoint for cv-git to fetch keys (requires auth)
- [ ] Key validation on save (test API call) (future enhancement)
- [x] Key expiry/rotation reminders (via expiresAt field)
- [x] Usage tracking per key (usageCount + lastUsedAt)
- [x] Tests pass
- [x] No TypeScript errors

## Implementation Summary

### Backend (Complete)

**Schema:** `apps/api/src/db/schema/api-keys.ts`
- `aiProviderEnum` pgEnum with 9 providers
- `apiKeys` table with encryption, usage tracking, expiry

**Service:** `apps/api/src/services/api-keys.service.ts`
- AES-256-GCM encryption with per-user key derivation
- CRUD operations: createApiKey, getUserApiKeys, getApiKeyById, updateApiKey, deleteApiKey
- getDecryptedApiKey for cv-git integration
- PROVIDER_INFO constant with docs URLs and key prefixes

**Routes:** `apps/api/src/routes/api-keys.ts`
- `GET /api/keys` - List all keys for user
- `POST /api/keys` - Create new key
- `GET /api/keys/:id` - Get key info
- `GET /api/keys/provider/:provider` - Get decrypted key (for cv-git)
- `PATCH /api/keys/:id` - Update key
- `DELETE /api/keys/:id` - Delete key

**Audit logging:** Added api_key.created, api_key.updated, api_key.deleted actions

### Frontend (Pending)

- `apps/web/src/pages/settings/ApiKeysPage.tsx` - wallet UI (not yet implemented)

## Technical Notes

**Encryption approach:**
- Derive per-user encryption key from MFA_ENCRYPTION_KEY + user ID
- Use AES-256-GCM for key encryption
- Store as `iv:encrypted` format
- Never log or expose full keys

**API for cv-git:**
```
GET /api/keys/provider/:provider
Authorization: Bearer <access_token>

Response: { key: "sk-..." }
```

## Open Questions

- [ ] Should keys be scoped to specific OAuth clients/apps?
- [ ] Should we support key sharing between users?
- [ ] Rate limiting on key retrieval?
