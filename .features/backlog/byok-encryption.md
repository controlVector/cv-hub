---
id: FEAT-028
title: BYOK API Key Encryption
priority: medium
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# BYOK API Key Encryption

## Problem

The embeddings service supports Bring-Your-Own-Key (BYOK) where organizations provide their own OpenRouter/OpenAI API keys. However, the encryption implementation has TODO comments and keys may not be properly encrypted at rest.

## Solution

Implement proper encryption for stored API keys using AES-256-GCM with a key derived from the platform's MFA encryption key.

## Acceptance Criteria

- [ ] Service: `encryptApiKey(plaintext)` - encrypt with AES-256-GCM
- [ ] Service: `decryptApiKey(ciphertext)` - decrypt for use
- [ ] Encryption key derived from `MFA_ENCRYPTION_KEY` env var via HKDF
- [ ] Each key uses a unique IV/nonce
- [ ] Stored format: `{iv}:{authTag}:{ciphertext}` (base64)
- [ ] Migrate existing plaintext keys to encrypted format
- [ ] Key rotation support (re-encrypt with new master key)
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Files to modify:**
- `apps/api/src/services/embeddings.service.ts` - Replace TODO encryption stubs

**Key considerations:**
- Use Node.js `crypto.createCipheriv('aes-256-gcm', ...)`
- HKDF to derive encryption key from master secret
- Auth tag prevents tampering
- Consider using AWS KMS for production key management
