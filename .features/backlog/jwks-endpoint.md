---
id: FEAT-003
title: Add JWKS endpoint for public key distribution
priority: low
effort: medium
area: api
status: backlog
created: 2025-12-28
updated: 2025-12-28
depends_on: []
blocks: []
---

# Add JWKS endpoint for public key distribution

## Problem

Currently ID tokens are signed with HS256 (symmetric). For better security and interoperability with third-party services, we should support RS256 (asymmetric) signing and publish public keys via JWKS.

## Solution

1. Generate RSA key pair for token signing
2. Store private key securely (env var or secrets manager)
3. Implement `/.well-known/jwks.json` endpoint
4. Update ID token signing to use RS256
5. Update OpenID discovery document

## Acceptance Criteria

- [ ] RSA key pair generation script exists
- [ ] `/.well-known/jwks.json` returns public key in JWK format
- [ ] ID tokens are signed with RS256
- [ ] OpenID discovery `id_token_signing_alg_values_supported` updated
- [ ] Key rotation mechanism documented
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Affected files:**
- `apps/api/src/app.ts` - add jwks route
- `apps/api/src/services/oauth.service.ts` - update generateIdToken
- `apps/api/src/config/env.ts` - add RSA key config
- `scripts/generate-keys.ts` - new script

**Key considerations:**
- Use `jose` library for JWK handling
- Store key ID (kid) to support key rotation
- Consider key rotation strategy (monthly? on-demand?)
