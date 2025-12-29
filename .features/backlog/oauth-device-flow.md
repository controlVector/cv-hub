---
id: FEAT-004
title: OAuth 2.0 Device Authorization Grant
priority: low
effort: large
area: api
status: backlog
created: 2025-12-28
updated: 2025-12-28
depends_on: []
blocks: []
---

# OAuth 2.0 Device Authorization Grant

## Problem

CLI tools and IoT devices can't easily perform browser-based OAuth flows. The Device Authorization Grant (RFC 8628) allows devices without browsers to obtain user authorization.

## Solution

Implement the device authorization flow:
1. Device requests authorization with `POST /oauth/device`
2. Server returns device_code, user_code, and verification_uri
3. User visits verification_uri on another device and enters user_code
4. Device polls `POST /oauth/token` with device_code until authorized

## Acceptance Criteria

- [ ] `POST /oauth/device` returns device_code, user_code, verification_uri
- [ ] User code is short and easy to type (e.g., "ABCD-1234")
- [ ] Device verification page at `/oauth/device/verify`
- [ ] Polling endpoint returns appropriate pending/denied/expired errors
- [ ] Device codes expire after configured interval (default 15 min)
- [ ] Rate limiting prevents polling faster than allowed interval
- [ ] OpenID discovery updated with `device_authorization_endpoint`
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Affected files:**
- `apps/api/src/routes/oauth.ts` - add device endpoints
- `apps/api/src/services/oauth.service.ts` - device code logic
- `apps/api/src/db/schema/oauth.ts` - device_codes table
- `apps/web/src/pages/oauth/DeviceVerifyPage.tsx` - verification UI

**Key considerations:**
- Store device codes in Redis with TTL for automatic expiry
- User code should be case-insensitive
- Polling interval should be enforced (429 if too fast)
- Consider QR code for verification_uri_complete

## Open Questions

- [ ] Should we support both user_code entry and QR scanning?
- [ ] What should the default device code lifetime be?
