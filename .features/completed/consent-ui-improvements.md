---
id: FEAT-002
title: Improve OAuth consent UI
priority: medium
effort: medium
area: web
status: completed
created: 2025-12-28
updated: 2025-12-28
completed: 2025-12-28
depends_on: []
blocks: []
---

# Improve OAuth consent UI

## Problem

The current OAuth consent page is functional but basic. Users would benefit from seeing more information about the app requesting access, and having more control over their consent.

## Solution

Enhance the consent page with:
- App logo display
- App creation/registration date
- "Remember this decision" checkbox
- Better scope explanations

## Acceptance Criteria

- [x] Consent page shows app logo if available (already implemented)
- [x] Consent page shows when the app was registered
- [x] "Remember my decision" checkbox that auto-approves future requests
- [x] Scope descriptions are user-friendly (already implemented with SCOPE_LABELS)
- [x] Mobile-responsive design (using MUI Container/Paper)
- [x] Tests pass
- [x] No TypeScript errors

## Implementation Summary

### Backend Changes

**Schema:** `apps/api/src/db/schema/oauth.ts`
- Added `rememberConsent` boolean field to `oauthAuthorizationCodes` table

**Service:** `apps/api/src/services/oauth.service.ts`
- Updated `createAuthorizationCode` to accept `rememberConsent` parameter
- Updated `exchangeAuthorizationCode` to only save consent when `rememberConsent` is true

**Routes:** `apps/api/src/routes/oauth.ts`
- Added `remember` field to POST /oauth/authorize schema (default: true)
- Added `createdAt` to client info response for `/oauth/clients/:clientId`

### Frontend Changes

**ConsentPage.tsx:**
- Added `rememberConsent` state (default true)
- Added "Remember my decision" checkbox using MUI FormControlLabel
- Shows app registration date as a Chip below the description
- Sends `remember` flag with authorization request

### Migration

- `drizzle/0005_consent-remember.sql` - adds `remember_consent` column

## Technical Notes

**Consent behavior:**
- By default, "Remember my decision" is checked (current behavior preserved)
- If unchecked, authorization is granted but no consent record is saved
- Next authorization request will show consent screen again
- User has control over whether to remember or do one-time authorization

**Key considerations:**
- App logo URL is already stored in `oauth_clients.logo_url` and displayed
- Consent stored in `oauth_consents` table when remember=true
- Security: Users can explicitly choose not to remember, useful for shared devices
