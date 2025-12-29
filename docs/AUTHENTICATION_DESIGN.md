# CV-Hub Identity Provider & Authentication System Design

## Executive Summary

This document outlines the design for cv-hub's authentication system, positioning it as a **competitive identity provider** comparable to GitHub's OAuth capabilities. The system will support:

- **Multi-factor authentication** (TOTP, WebAuthn/Passkeys, backup codes)
- **OAuth 2.0 / OpenID Connect provider** capabilities for third-party integration
- **API Token Wallet** for secure LLM API key management
- **Passwordless authentication** via FIDO2/Passkeys

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CV-Hub Identity Platform                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │   Auth Gateway   │  │  Token Service   │  │  Session Manager │          │
│  │   (API Routes)   │  │  (JWT/Refresh)   │  │  (Redis/Memory)  │          │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘          │
│           │                     │                     │                     │
│  ┌────────┴─────────────────────┴─────────────────────┴─────────┐          │
│  │                    Identity Core Service                      │          │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────┐│          │
│  │  │ User Mgmt   │ │ Credential  │ │ MFA Engine  │ │ OAuth    ││          │
│  │  │             │ │ Store       │ │             │ │ Provider ││          │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └──────────┘│          │
│  └───────────────────────────────────────────────────────────────┘          │
│           │                                                                 │
│  ┌────────┴─────────────────────────────────────────────────────┐          │
│  │                    API Token Wallet                           │          │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │          │
│  │  │ Token Vault │ │ Usage       │ │ Rotation    │             │          │
│  │  │ (Encrypted) │ │ Tracking    │ │ Scheduler   │             │          │
│  │  └─────────────┘ └─────────────┘ └─────────────┘             │          │
│  └───────────────────────────────────────────────────────────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │  PostgreSQL │ │    Redis    │ │   HSM/KMS   │
            │  (Primary)  │ │  (Sessions) │ │  (Secrets)  │
            └─────────────┘ └─────────────┘ └─────────────┘
```

### 1.2 Design Principles

1. **Security-First**: All sensitive data encrypted at rest and in transit
2. **Zero-Trust**: Verify every request, assume breach
3. **Minimal Privilege**: Request only necessary scopes/permissions
4. **User Control**: Users own their data and credentials
5. **Phishing Resistance**: Prioritize WebAuthn/Passkeys over phishable methods
6. **Standards Compliance**: OAuth 2.1, OpenID Connect, FIDO2, RFC 6238

---

## 2. Authentication Methods

### 2.1 Primary Authentication Options

#### 2.1.1 Password-Based (Legacy Support)

```typescript
interface PasswordCredential {
  // Never store plaintext - use Argon2id
  passwordHash: string;  // Argon2id hash
  salt: string;          // Unique per-user
  hashVersion: number;   // For upgrade path
  lastChanged: Date;
  requiresReset: boolean;
}
```

**Password Requirements:**
- Minimum 12 characters (encourage passphrases)
- Check against HaveIBeenPwned API (k-anonymity)
- No composition rules (per NIST 800-63B)
- Argon2id with tuned parameters:
  - Memory: 64MB
  - Iterations: 3
  - Parallelism: 4

#### 2.1.2 Passkeys/WebAuthn (Recommended Primary)

```typescript
interface PasskeyCredential {
  credentialId: string;        // Base64URL encoded
  publicKey: string;           // COSE key format
  signCount: number;           // Replay protection
  transports: AuthenticatorTransport[];
  userVerification: 'required' | 'preferred' | 'discouraged';
  attestation?: string;        // For enterprise validation
  deviceName: string;          // User-friendly identifier
  createdAt: Date;
  lastUsed: Date;
  isSynced: boolean;           // Synced vs device-bound
}
```

**Implementation Notes:**
- Support both synced passkeys (convenience) and device-bound (high security)
- Relying Party ID: `controlvector.io`
- User Verification: Required for sensitive operations
- Attestation: Direct for enterprise, none for consumer

#### 2.1.3 OAuth/Social Login (Federated)

Support login via trusted identity providers:
- GitHub (primary - developer audience)
- Google (broad reach)
- Microsoft/Azure AD (enterprise)

```typescript
interface FederatedIdentity {
  provider: 'github' | 'google' | 'microsoft';
  providerUserId: string;
  email: string;
  linkedAt: Date;
  lastUsed: Date;
  accessToken?: string;  // Encrypted, for API access
  refreshToken?: string; // Encrypted
}
```

### 2.2 Authentication Flow Comparison

| Method | Phishing Resistant | Convenience | Enterprise Ready |
|--------|-------------------|-------------|------------------|
| Passkeys | Yes | High | Yes |
| Password + TOTP | Partial | Medium | Yes |
| Password + WebAuthn | Yes | Medium | Yes |
| Social OAuth | Depends on IdP | High | Partial |

---

## 3. Multi-Factor Authentication (MFA)

### 3.1 MFA Methods Supported

#### 3.1.1 TOTP (Time-Based One-Time Password)

Per RFC 6238:

```typescript
interface TOTPCredential {
  secret: string;           // Base32 encoded, 160-bit minimum
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: 6 | 8;
  period: 30;               // seconds
  verified: boolean;        // User confirmed working
  createdAt: Date;
  lastUsed: Date;
}

// TOTP URI format for authenticator apps:
// otpauth://totp/CV-Hub:username?secret=BASE32SECRET&issuer=CV-Hub&algorithm=SHA256&digits=6&period=30
```

**Implementation:**
- Default: SHA256, 6 digits, 30-second period
- Allow ±1 time step for clock drift
- Rate limit: 5 attempts per 30 seconds
- Support all major authenticator apps (Google Authenticator, Authy, 1Password, etc.)

#### 3.1.2 WebAuthn Security Keys

```typescript
interface SecurityKeyCredential extends PasskeyCredential {
  aaguid: string;           // Authenticator model identifier
  isBackupKey: boolean;     // Designated recovery key
}
```

- FIDO2 security keys (YubiKey, etc.)
- Can serve as both primary auth and MFA
- Highest security for enterprise users

#### 3.1.3 Backup Codes

```typescript
interface BackupCodes {
  codes: string[];          // 10 codes, Argon2id hashed
  generatedAt: Date;
  usedCodes: number[];      // Indices of used codes
  remainingCount: number;
}

// Code format: XXXX-XXXX-XXXX (12 chars, alphanumeric, no ambiguous chars)
// Exclude: 0, O, 1, I, L to avoid confusion
```

### 3.2 MFA Enforcement Policies

```typescript
interface MFAPolicy {
  required: boolean;
  allowedMethods: MFAMethod[];
  gracePeriodDays: number;      // Time to set up after requirement
  trustedDeviceDays: number;    // How long to remember device
  highRiskActions: string[];    // Actions requiring MFA even if trusted
}

// High-risk actions always requiring MFA:
const HIGH_RISK_ACTIONS = [
  'change_password',
  'change_email',
  'add_mfa_method',
  'remove_mfa_method',
  'generate_api_token',
  'delete_account',
  'oauth_app_create',
  'oauth_app_delete',
];
```

---

## 4. OAuth 2.0 / OpenID Connect Provider

CV-Hub will act as an **identity provider** allowing third-party applications to authenticate users via CV-Hub credentials.

### 4.1 Supported Grant Types

| Grant Type | Use Case | PKCE Required |
|------------|----------|---------------|
| Authorization Code | Web apps, SPAs | Yes (mandatory) |
| Authorization Code + PKCE | Mobile, desktop, CLI | Yes |
| Refresh Token | Token renewal | N/A |
| Device Code | Headless/IoT devices | N/A |

**Not Supported (Security):**
- Implicit Flow (deprecated, insecure)
- Resource Owner Password Grant (deprecated)

### 4.2 OAuth Application Registration

```typescript
interface OAuthApplication {
  id: string;                    // UUID
  clientId: string;              // Public identifier
  clientSecretHash?: string;     // Argon2id, only for confidential clients

  name: string;
  description: string;
  logoUrl?: string;
  homepageUrl: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;

  // Security configuration
  clientType: 'confidential' | 'public';
  redirectUris: string[];        // Exact match required
  allowedScopes: OAuthScope[];
  tokenLifetime: number;         // Access token TTL in seconds
  refreshTokenLifetime: number;
  requirePKCE: boolean;          // Always true for public clients

  // Ownership
  ownerId: string;
  organizationId?: string;

  // Audit
  createdAt: Date;
  updatedAt: Date;
  lastUsed?: Date;
}
```

### 4.3 OAuth Scopes

```typescript
type OAuthScope =
  // Identity scopes (OpenID Connect)
  | 'openid'              // Required for OIDC
  | 'profile'             // name, username, avatar
  | 'email'               // email, email_verified

  // CV-Hub specific scopes
  | 'user:read'           // Read user profile
  | 'user:write'          // Update user profile
  | 'repos:read'          // List and read repositories
  | 'repos:write'         // Create, update repositories
  | 'repos:delete'        // Delete repositories
  | 'ai:read'             // Read AI analysis results
  | 'ai:write'            // Trigger AI analysis
  | 'tokens:read'         // List API tokens (metadata only)
  | 'tokens:write'        // Create/delete API tokens
  | 'tokens:use'          // Actually use stored tokens (high privilege)
  | 'org:read'            // Read organization info
  | 'org:write'           // Manage organization
  | 'org:admin';          // Full org admin access
```

### 4.4 Authorization Flow

```
┌──────────┐                              ┌──────────┐                              ┌──────────┐
│  Client  │                              │  CV-Hub  │                              │   User   │
│   App    │                              │  AuthZ   │                              │          │
└────┬─────┘                              └────┬─────┘                              └────┬─────┘
     │                                         │                                         │
     │ 1. Authorization Request                │                                         │
     │    (client_id, redirect_uri,           │                                         │
     │     scope, state, code_challenge)       │                                         │
     │────────────────────────────────────────>│                                         │
     │                                         │                                         │
     │                                         │ 2. Authenticate User                    │
     │                                         │────────────────────────────────────────>│
     │                                         │                                         │
     │                                         │ 3. User Approves Scopes                 │
     │                                         │<────────────────────────────────────────│
     │                                         │                                         │
     │ 4. Authorization Code                   │                                         │
     │    (via redirect_uri + state)           │                                         │
     │<────────────────────────────────────────│                                         │
     │                                         │                                         │
     │ 5. Token Request                        │                                         │
     │    (code, code_verifier, client_id)     │                                         │
     │────────────────────────────────────────>│                                         │
     │                                         │                                         │
     │ 6. Token Response                       │                                         │
     │    (access_token, refresh_token,        │                                         │
     │     id_token, expires_in)               │                                         │
     │<────────────────────────────────────────│                                         │
     │                                         │                                         │
```

### 4.5 Token Formats

#### Access Token (JWT)

```json
{
  "iss": "https://controlvector.io",
  "sub": "user_abc123",
  "aud": "client_xyz789",
  "exp": 1735456800,
  "iat": 1735453200,
  "nbf": 1735453200,
  "jti": "token_unique_id",
  "scope": "openid profile repos:read",
  "client_id": "client_xyz789",
  "cvhub:org_id": "org_456",
  "cvhub:permissions": ["read:repos", "read:profile"]
}
```

#### ID Token (OpenID Connect)

```json
{
  "iss": "https://controlvector.io",
  "sub": "user_abc123",
  "aud": "client_xyz789",
  "exp": 1735456800,
  "iat": 1735453200,
  "auth_time": 1735453100,
  "nonce": "random_nonce_from_client",
  "acr": "urn:cvhub:mfa",
  "amr": ["pwd", "otp"],

  // Profile claims
  "name": "Jane Developer",
  "preferred_username": "janedev",
  "picture": "https://controlvector.io/avatars/abc123.png",
  "email": "jane@example.com",
  "email_verified": true
}
```

### 4.6 OpenID Connect Discovery

Endpoint: `/.well-known/openid-configuration`

```json
{
  "issuer": "https://controlvector.io",
  "authorization_endpoint": "https://controlvector.io/oauth/authorize",
  "token_endpoint": "https://controlvector.io/oauth/token",
  "userinfo_endpoint": "https://controlvector.io/oauth/userinfo",
  "jwks_uri": "https://controlvector.io/.well-known/jwks.json",
  "registration_endpoint": "https://controlvector.io/oauth/register",
  "revocation_endpoint": "https://controlvector.io/oauth/revoke",
  "introspection_endpoint": "https://controlvector.io/oauth/introspect",
  "device_authorization_endpoint": "https://controlvector.io/oauth/device",

  "scopes_supported": ["openid", "profile", "email", "repos:read", "..."],
  "response_types_supported": ["code"],
  "response_modes_supported": ["query", "fragment", "form_post"],
  "grant_types_supported": ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
  "code_challenge_methods_supported": ["S256"],

  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256", "ES256"],
  "claims_supported": ["sub", "name", "email", "email_verified", "picture", "preferred_username"]
}
```

---

## 5. API Token Wallet

A secure vault for storing and managing API tokens, specifically designed for LLM API keys.

### 5.1 Token Wallet Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Token Wallet Service                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │  Token Registry  │  │  Usage Tracker   │                     │
│  │  (Metadata)      │  │  (Costs/Limits)  │                     │
│  └────────┬─────────┘  └────────┬─────────┘                     │
│           │                     │                                │
│  ┌────────┴─────────────────────┴─────────────────┐             │
│  │              Encryption Layer                   │             │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │             │
│  │  │ Key Wrap    │ │ Envelope    │ │ HSM/KMS   │ │             │
│  │  │ (AES-256)   │ │ Encryption  │ │ Integration│ │             │
│  │  └─────────────┘ └─────────────┘ └───────────┘ │             │
│  └────────────────────────────────────────────────┘             │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐           │
│  │              Token Proxy Service                  │           │
│  │  (Never exposes raw tokens to client)            │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Stored Token Types

```typescript
interface StoredAPIToken {
  id: string;                    // UUID
  userId: string;
  name: string;                  // User-defined label

  // Provider information
  provider: LLMProvider;
  providerAccountId?: string;    // For linking to provider account

  // The actual token (encrypted)
  encryptedToken: string;        // AES-256-GCM encrypted
  keyVersion: number;            // For key rotation

  // Metadata (not encrypted)
  prefix: string;                // First 4 chars for identification
  lastFourChars: string;         // Last 4 chars for verification

  // Usage tracking
  usageThisMonth: number;        // API calls or tokens
  costThisMonth: number;         // Estimated cost in USD
  monthlyLimit?: number;         // User-set spending limit

  // Security
  allowedOrigins?: string[];     // CORS-like restrictions
  allowedModels?: string[];      // Restrict to specific models
  expiresAt?: Date;

  // Audit
  createdAt: Date;
  lastUsed?: Date;
  lastRotated?: Date;
}

type LLMProvider =
  | 'openai'
  | 'anthropic'
  | 'google_ai'
  | 'cohere'
  | 'mistral'
  | 'groq'
  | 'together'
  | 'azure_openai'
  | 'aws_bedrock'
  | 'custom';
```

### 5.3 Token Operations

#### Adding a Token

```typescript
// Client sends token securely (TLS + optional client-side encryption)
POST /api/wallet/tokens
{
  "name": "OpenAI Production",
  "provider": "openai",
  "token": "sk-...",           // Transmitted once, never returned
  "monthlyLimit": 100.00
}

// Response - token is stored, only metadata returned
{
  "id": "tok_abc123",
  "name": "OpenAI Production",
  "provider": "openai",
  "prefix": "sk-p",
  "lastFourChars": "Yx9a",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

#### Using a Token (Proxy Pattern)

**Critical: Raw tokens never leave the server**

```typescript
// Option 1: Server-side proxy (recommended for web apps)
POST /api/wallet/tokens/{tokenId}/proxy
{
  "targetUrl": "https://api.openai.com/v1/chat/completions",
  "method": "POST",
  "body": {
    "model": "gpt-4",
    "messages": [...]
  }
}

// Option 2: Temporary scoped token (for trusted environments)
POST /api/wallet/tokens/{tokenId}/delegate
{
  "ttlSeconds": 300,           // 5 minute max
  "allowedEndpoints": ["/v1/chat/completions"],
  "allowedModels": ["gpt-4"],
  "maxCalls": 10
}
// Returns a short-lived, scoped wrapper token
```

### 5.4 Encryption Strategy

```typescript
// Envelope encryption with key hierarchy
interface TokenEncryption {
  // Level 1: Master Key (in HSM/KMS)
  masterKeyId: string;          // AWS KMS, GCP KMS, or HashiCorp Vault

  // Level 2: User Data Key (encrypted by master key)
  encryptedDataKey: string;     // Unique per user

  // Level 3: Token encryption (using data key)
  // AES-256-GCM with random IV per token
  encryptedValue: string;
  iv: string;
  authTag: string;
}

// Key rotation
// - Master key: Annual rotation via KMS
// - User data keys: Rotated on password change or security event
// - Automatic re-encryption on key rotation
```

### 5.5 Token Wallet UI Features

```typescript
interface TokenWalletUI {
  // Dashboard
  totalTokens: number;
  monthlySpend: number;
  monthlyBudget: number;

  // Per-token views
  tokens: Array<{
    id: string;
    name: string;
    provider: LLMProvider;
    status: 'active' | 'expired' | 'revoked' | 'limit_reached';
    usageChart: UsageDataPoint[];      // Last 30 days
    lastUsed: Date;
  }>;

  // Alerts
  alerts: Array<{
    type: 'approaching_limit' | 'unusual_usage' | 'expiring_soon';
    tokenId: string;
    message: string;
  }>;
}
```

---

## 6. Security Considerations

### 6.1 Defense in Depth

```
┌─────────────────────────────────────────────────────────────────┐
│                        Security Layers                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: Network                                                │
│  ├── TLS 1.3 only                                               │
│  ├── HSTS with preload                                          │
│  ├── Certificate pinning for mobile                             │
│  └── DDoS protection (Cloudflare/AWS Shield)                    │
│                                                                  │
│  Layer 2: Application                                            │
│  ├── CSRF protection (double-submit cookie + SameSite)          │
│  ├── Content Security Policy                                     │
│  ├── Input validation & sanitization                            │
│  └── Rate limiting (per-user, per-IP, per-endpoint)             │
│                                                                  │
│  Layer 3: Authentication                                         │
│  ├── Argon2id password hashing                                  │
│  ├── WebAuthn/FIDO2 for phishing resistance                     │
│  ├── MFA enforcement for sensitive operations                   │
│  └── Session binding (fingerprint + IP range)                   │
│                                                                  │
│  Layer 4: Authorization                                          │
│  ├── Principle of least privilege                               │
│  ├── Scope-based access control                                 │
│  ├── Organization-level permissions                             │
│  └── Audit logging for all access                               │
│                                                                  │
│  Layer 5: Data Protection                                        │
│  ├── Encryption at rest (AES-256)                               │
│  ├── Envelope encryption for secrets                            │
│  ├── HSM-backed key management                                  │
│  └── Secure deletion procedures                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Rate Limiting Strategy

```typescript
interface RateLimits {
  // Authentication endpoints
  login: {
    perIP: '5/minute',
    perUsername: '10/hour',
    global: '1000/minute'
  };

  // MFA
  totpVerify: {
    perUser: '5/30seconds',
    lockoutAfter: 5,
    lockoutDuration: '15minutes'
  };

  // OAuth
  tokenEndpoint: {
    perClient: '100/minute',
    perUser: '50/minute'
  };

  // Token Wallet
  tokenProxy: {
    perToken: '60/minute',
    perUser: '200/minute'
  };
}
```

### 6.3 Session Management

```typescript
interface Session {
  id: string;                    // Cryptographically random
  userId: string;

  // Security metadata
  createdAt: Date;
  expiresAt: Date;
  lastActivity: Date;

  // Device binding
  deviceFingerprint: string;     // Hashed browser fingerprint
  ipAddress: string;
  userAgent: string;

  // Authentication level
  authMethods: ('password' | 'passkey' | 'oauth' | 'totp' | 'webauthn')[];
  mfaVerified: boolean;
  mfaVerifiedAt?: Date;

  // Revocation
  revokedAt?: Date;
  revokedReason?: string;
}

// Session policies
const SESSION_POLICY = {
  maxAge: '7 days',              // Absolute maximum
  idleTimeout: '2 hours',        // Require re-auth after idle
  mfaTimeout: '1 hour',          // Re-verify MFA for sensitive ops
  maxConcurrentSessions: 10,
  requireMFAForNewDevice: true,
};
```

### 6.4 Audit Logging

```typescript
interface AuditLog {
  id: string;
  timestamp: Date;

  // Actor
  userId?: string;
  clientId?: string;             // For OAuth apps
  ipAddress: string;
  userAgent: string;

  // Action
  action: AuditAction;
  resource: string;
  resourceId?: string;

  // Context
  success: boolean;
  failureReason?: string;
  metadata: Record<string, unknown>;

  // Integrity
  previousHash: string;          // Chain integrity
  hash: string;
}

type AuditAction =
  | 'login_success' | 'login_failure'
  | 'logout' | 'session_revoked'
  | 'mfa_enabled' | 'mfa_disabled' | 'mfa_verified'
  | 'password_changed' | 'email_changed'
  | 'passkey_registered' | 'passkey_removed'
  | 'oauth_app_created' | 'oauth_app_deleted'
  | 'oauth_authorized' | 'oauth_revoked'
  | 'token_created' | 'token_used' | 'token_revoked'
  | 'api_key_created' | 'api_key_rotated' | 'api_key_deleted';
```

---

## 7. Database Schema

### 7.1 Core Tables

```sql
-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(39) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    display_name VARCHAR(255),
    avatar_url TEXT,

    -- Account status
    status VARCHAR(20) DEFAULT 'active', -- active, suspended, deleted
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    -- Security settings
    mfa_required BOOLEAN DEFAULT FALSE,
    password_changed_at TIMESTAMPTZ
);

-- Password credentials (separate for security)
CREATE TABLE password_credentials (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,  -- Argon2id
    hash_version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Passkeys/WebAuthn credentials
CREATE TABLE passkey_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA UNIQUE NOT NULL,
    public_key BYTEA NOT NULL,
    sign_count INTEGER DEFAULT 0,
    transports TEXT[],
    device_name VARCHAR(255),
    aaguid BYTEA,
    is_synced BOOLEAN DEFAULT FALSE,
    is_backup BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- TOTP credentials
CREATE TABLE totp_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_secret BYTEA NOT NULL,
    key_version INTEGER NOT NULL,
    algorithm VARCHAR(10) DEFAULT 'SHA256',
    digits INTEGER DEFAULT 6,
    period INTEGER DEFAULT 30,
    verified BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,

    UNIQUE(user_id)  -- One TOTP per user
);

-- Backup codes
CREATE TABLE backup_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash VARCHAR(255) NOT NULL,  -- Argon2id hashed
    used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Federated identities (OAuth logins)
CREATE TABLE federated_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255),

    encrypted_access_token BYTEA,
    encrypted_refresh_token BYTEA,
    token_key_version INTEGER,
    token_expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,

    UNIQUE(provider, provider_user_id)
);

-- Sessions
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    token_hash VARCHAR(255) NOT NULL,  -- Hashed session token

    device_fingerprint VARCHAR(255),
    ip_address INET,
    user_agent TEXT,

    auth_methods TEXT[] NOT NULL,
    mfa_verified BOOLEAN DEFAULT FALSE,
    mfa_verified_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT
);

-- OAuth Applications (CV-Hub as provider)
CREATE TABLE oauth_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id VARCHAR(64) UNIQUE NOT NULL,
    client_secret_hash VARCHAR(255),  -- NULL for public clients

    name VARCHAR(255) NOT NULL,
    description TEXT,
    logo_url TEXT,
    homepage_url TEXT NOT NULL,
    privacy_policy_url TEXT,
    terms_of_service_url TEXT,

    client_type VARCHAR(20) NOT NULL, -- confidential, public
    redirect_uris TEXT[] NOT NULL,
    allowed_scopes TEXT[] NOT NULL,

    token_lifetime INTEGER DEFAULT 3600,
    refresh_token_lifetime INTEGER DEFAULT 2592000,
    require_pkce BOOLEAN DEFAULT TRUE,

    owner_id UUID NOT NULL REFERENCES users(id),
    organization_id UUID,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- OAuth Authorization Codes
CREATE TABLE oauth_authorization_codes (
    code_hash VARCHAR(255) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),

    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    code_challenge VARCHAR(128),
    code_challenge_method VARCHAR(10),
    nonce VARCHAR(255),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

-- OAuth Access Tokens (for revocation tracking)
CREATE TABLE oauth_access_tokens (
    jti VARCHAR(255) PRIMARY KEY,  -- JWT ID
    client_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),

    scope TEXT NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

-- OAuth Refresh Tokens
CREATE TABLE oauth_refresh_tokens (
    token_hash VARCHAR(255) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    access_token_jti VARCHAR(255),

    scope TEXT NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    rotated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

-- API Token Wallet
CREATE TABLE wallet_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    provider_account_id VARCHAR(255),

    -- Encrypted token data
    encrypted_token BYTEA NOT NULL,
    iv BYTEA NOT NULL,
    auth_tag BYTEA NOT NULL,
    key_version INTEGER NOT NULL,

    -- Identifiable metadata (not encrypted)
    token_prefix VARCHAR(10),
    token_suffix VARCHAR(10),

    -- Usage tracking
    monthly_limit DECIMAL(10, 2),

    -- Restrictions
    allowed_origins TEXT[],
    allowed_models TEXT[],
    expires_at TIMESTAMPTZ,

    -- Status
    status VARCHAR(20) DEFAULT 'active',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    last_rotated_at TIMESTAMPTZ
);

-- Token usage tracking
CREATE TABLE wallet_token_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id UUID NOT NULL REFERENCES wallet_tokens(id) ON DELETE CASCADE,

    usage_date DATE NOT NULL,
    request_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,  -- LLM tokens
    estimated_cost DECIMAL(10, 4) DEFAULT 0,

    UNIQUE(token_id, usage_date)
);

-- Audit log
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),

    user_id UUID REFERENCES users(id),
    client_id VARCHAR(64),
    ip_address INET,
    user_agent TEXT,

    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100),
    resource_id VARCHAR(255),

    success BOOLEAN NOT NULL,
    failure_reason TEXT,
    metadata JSONB,

    previous_hash VARCHAR(64),
    hash VARCHAR(64) NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_sessions_user_id ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_expires ON sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_passkeys_user_id ON passkey_credentials(user_id);
CREATE INDEX idx_oauth_tokens_user ON oauth_access_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_wallet_tokens_user ON wallet_tokens(user_id) WHERE status = 'active';
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, timestamp DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, timestamp DESC);
```

---

## 8. Implementation Roadmap

### Phase 1: Core Authentication (Foundation)

**Goal:** Basic user authentication with modern security

1. **User Registration & Login**
   - Email/password registration with Argon2id
   - Email verification flow
   - Password reset via secure token

2. **Session Management**
   - JWT access tokens (short-lived: 15 min)
   - Refresh tokens (secure httpOnly cookies)
   - Session listing and revocation

3. **Basic Security**
   - Rate limiting
   - CSRF protection
   - Audit logging

### Phase 2: Multi-Factor Authentication

**Goal:** Strong MFA options for all users

1. **TOTP Implementation**
   - Setup flow with QR code
   - Verification during login
   - Backup code generation

2. **WebAuthn/Passkeys**
   - Passkey registration flow
   - Login with passkey
   - Cross-device authentication

3. **Recovery Options**
   - Backup codes
   - Account recovery flow

### Phase 3: OAuth Provider

**Goal:** CV-Hub as trusted identity provider

1. **OAuth 2.0 Implementation**
   - Authorization code flow with PKCE
   - Token endpoint
   - Refresh token rotation

2. **OpenID Connect**
   - ID token generation
   - UserInfo endpoint
   - Discovery document

3. **Developer Portal**
   - OAuth app registration UI
   - Client credentials management
   - Scope documentation

### Phase 4: API Token Wallet

**Goal:** Secure LLM API key management

1. **Token Storage**
   - Encrypted vault with envelope encryption
   - Provider-specific validation
   - Token metadata management

2. **Token Proxy Service**
   - Server-side API proxying
   - Usage tracking
   - Cost estimation

3. **Wallet UI**
   - Dashboard with usage analytics
   - Budget alerts
   - Token rotation reminders

### Phase 5: Enterprise Features

**Goal:** Organization and team support

1. **Organizations**
   - Team management
   - Role-based access control
   - SSO integration (SAML)

2. **Advanced Security**
   - IP allowlisting
   - Device trust policies
   - Security event notifications

---

## 9. API Endpoints Summary

### Authentication

```
POST   /api/auth/register          # Create account
POST   /api/auth/login             # Password login
POST   /api/auth/login/passkey     # Passkey login
POST   /api/auth/logout            # End session
POST   /api/auth/refresh           # Refresh tokens
POST   /api/auth/verify-email      # Verify email address
POST   /api/auth/forgot-password   # Request password reset
POST   /api/auth/reset-password    # Complete password reset
```

### MFA

```
POST   /api/auth/mfa/totp/setup    # Begin TOTP setup
POST   /api/auth/mfa/totp/verify   # Verify TOTP code
DELETE /api/auth/mfa/totp          # Remove TOTP
POST   /api/auth/mfa/passkey/register  # Register passkey
DELETE /api/auth/mfa/passkey/:id   # Remove passkey
POST   /api/auth/mfa/backup-codes  # Generate backup codes
POST   /api/auth/mfa/verify        # Verify any MFA method
```

### Sessions

```
GET    /api/auth/sessions          # List active sessions
DELETE /api/auth/sessions/:id      # Revoke session
DELETE /api/auth/sessions          # Revoke all sessions
```

### OAuth Provider

```
GET    /oauth/authorize            # Authorization endpoint
POST   /oauth/token                # Token endpoint
POST   /oauth/revoke               # Token revocation
POST   /oauth/introspect           # Token introspection
GET    /oauth/userinfo             # UserInfo endpoint
POST   /oauth/device               # Device authorization
GET    /.well-known/openid-configuration
GET    /.well-known/jwks.json
```

### OAuth App Management

```
GET    /api/oauth/apps             # List my apps
POST   /api/oauth/apps             # Create app
GET    /api/oauth/apps/:id         # Get app details
PATCH  /api/oauth/apps/:id         # Update app
DELETE /api/oauth/apps/:id         # Delete app
POST   /api/oauth/apps/:id/rotate-secret  # Rotate client secret
```

### Token Wallet

```
GET    /api/wallet/tokens          # List tokens
POST   /api/wallet/tokens          # Add token
GET    /api/wallet/tokens/:id      # Get token metadata
PATCH  /api/wallet/tokens/:id      # Update token
DELETE /api/wallet/tokens/:id      # Remove token
POST   /api/wallet/tokens/:id/verify  # Verify token is valid
POST   /api/wallet/tokens/:id/proxy   # Proxy API request
POST   /api/wallet/tokens/:id/delegate # Get temporary token
GET    /api/wallet/usage           # Usage summary
GET    /api/wallet/tokens/:id/usage   # Per-token usage
```

---

## 10. Technology Recommendations

### Backend

| Component | Recommendation | Rationale |
|-----------|---------------|-----------|
| Runtime | Node.js 20+ or Bun | TypeScript ecosystem, async performance |
| Framework | Hono or Fastify | Fast, type-safe, modern |
| Database | PostgreSQL 16 | Robust, JSONB support, proven |
| Cache/Sessions | Redis 7+ | Fast, pub/sub for real-time |
| Secret Management | HashiCorp Vault or AWS KMS | Enterprise-grade encryption |

### Libraries

| Purpose | Library | Notes |
|---------|---------|-------|
| Password Hashing | `argon2` | Native bindings, OWASP recommended |
| WebAuthn | `@simplewebauthn/server` | Well-maintained, FIDO2 certified |
| TOTP | `otpauth` | RFC 6238 compliant |
| JWT | `jose` | Modern, supports all algorithms |
| OAuth | `oauth4webapi` | Standards-compliant |
| Validation | `zod` | TypeScript-first validation |
| Rate Limiting | `@upstash/ratelimit` | Redis-backed, distributed |

### Frontend

| Component | Recommendation |
|-----------|---------------|
| WebAuthn Client | `@simplewebauthn/browser` |
| QR Codes | `qrcode` (for TOTP setup) |
| Form Handling | React Hook Form + Zod |

---

## 11. Competitive Advantages Over GitHub

| Feature | GitHub | CV-Hub (Proposed) |
|---------|--------|-------------------|
| Passkey Support | Yes | Yes + advanced management |
| TOTP | Yes | Yes + multiple devices |
| API Token Wallet | No | Yes - LLM key management |
| Token Proxy | No | Yes - never expose keys |
| Usage Tracking | Limited | Comprehensive + cost estimation |
| OAuth Scopes | Fixed set | AI-focused scopes |
| Token Budgets | No | Yes - per-token limits |
| Batch Token Management | No | Yes - import/export |

---

## References

- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [RFC 6238 - TOTP](https://datatracker.ietf.org/doc/html/rfc6238)
- [WebAuthn Spec](https://www.w3.org/TR/webauthn-2/)
- [FIDO Alliance Passkeys](https://fidoalliance.org/passkeys/)
- [NIST 800-63B Digital Identity Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [GitHub OAuth Best Practices](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- [Google OAuth 2.0 Best Practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
