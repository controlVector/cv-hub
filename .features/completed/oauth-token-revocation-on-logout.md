---
id: FEAT-001
title: Revoke OAuth tokens on user logout
priority: high
effort: small
area: api
status: completed
created: 2025-12-28
updated: 2025-12-28
depends_on: []
blocks: []
---

# Revoke OAuth tokens on user logout

## Problem

When a user logs out from cv-hub, their OAuth access tokens for connected third-party apps remain valid. This is a security concern - if a user wants to "log out everywhere", they expect all their authorized sessions to be terminated.

## Solution

When a user logs out or revokes all sessions, also revoke all their OAuth access tokens and refresh tokens.

## Acceptance Criteria

- [x] Logout endpoint revokes all OAuth access tokens for the user
- [x] Logout endpoint revokes all OAuth refresh tokens for the user
- [x] "Revoke all sessions" also revokes OAuth tokens
- [x] Audit log records OAuth token revocations
- [x] Tests pass
- [x] No TypeScript errors

## Technical Notes

**Affected files:**
- `apps/api/src/routes/auth.ts` - logout endpoint (lines 342-369, 468-498)
- `apps/api/src/services/oauth.service.ts` - added `revokeAllUserOAuthTokens` function (lines 462-487)

**Implementation:**
- Added `revokeAllUserOAuthTokens(userId)` function that revokes all active access and refresh tokens for a user
- Returns count of revoked tokens for audit logging
- Both `/logout` and `DELETE /sessions` endpoints now call this function
- Token counts are included in audit log details
