---
id: FEAT-006
title: OAuth token introspection endpoint
priority: low
effort: small
area: api
status: completed
created: 2025-12-28
updated: 2025-12-28
completed: 2025-12-28
depends_on: []
blocks: []
---

# OAuth token introspection endpoint

## Problem

Resource servers need a way to validate OAuth tokens. Currently they must decode JWTs themselves. RFC 7662 defines a standard introspection endpoint for this purpose.

## Solution

Implement `POST /oauth/introspect` endpoint that:
1. Accepts a token and optional token_type_hint
2. Returns token metadata (active, scope, client_id, exp, etc.)
3. Requires client authentication

## Acceptance Criteria

- [x] `POST /oauth/introspect` endpoint implemented
- [x] Supports access_token and refresh_token introspection
- [x] Returns `active: false` for expired/revoked tokens
- [x] Returns token metadata when active
- [x] Requires client authentication (Basic auth)
- [x] OpenID discovery updated with `introspection_endpoint`
- [x] Rate limited to prevent abuse
- [x] Tests pass
- [x] No TypeScript errors

## Implementation Summary

### Service

**oauth.service.ts:** Added `introspectToken` function
- Accepts token and optional token_type_hint
- Checks access_tokens table first (unless hint says refresh_token)
- Checks refresh_tokens table if not found
- Returns `{ active: false }` for expired, revoked, or rotated tokens
- Returns full token metadata when active:
  - `active`, `scope`, `client_id`, `username`, `token_type`
  - `exp`, `iat`, `sub`, `aud`, `iss`

### Route

**oauth.ts:** Added `POST /oauth/introspect` endpoint
- Requires client authentication via Basic auth header
- Rate limited with `strictRateLimiter`
- Accepts form-encoded body with `token` and optional `token_type_hint`
- Returns RFC 7662 compliant response

### Discovery

Updated OpenID discovery documents in:
- `apps/api/src/routes/oauth.ts` (`.well-known/openid-configuration`)
- `apps/api/src/app.ts` (root `.well-known/openid-configuration`)

Added:
- `introspection_endpoint`: `{issuer}/oauth/introspect`
- `introspection_endpoint_auth_methods_supported`: `['client_secret_basic']`

## Technical Notes

**Request format:**
```http
POST /oauth/introspect HTTP/1.1
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

token=<access_token>&token_type_hint=access_token
```

**Response format (RFC 7662):**
```json
{
  "active": true,
  "scope": "openid profile email",
  "client_id": "abc123",
  "username": "user@example.com",
  "token_type": "Bearer",
  "exp": 1234567890,
  "iat": 1234567800,
  "sub": "user-uuid",
  "aud": "abc123",
  "iss": "https://api.example.com"
}
```

For inactive tokens:
```json
{
  "active": false
}
```
