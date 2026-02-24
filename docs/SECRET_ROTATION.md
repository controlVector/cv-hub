# CV-Hub Secret Rotation Guide

All secrets are stored in the `cv-hub-secrets` Kubernetes secret in the `cv-hub` namespace.

## How to update any secret

```bash
# 1. Patch the secret with the new value
kubectl patch secret cv-hub-secrets -n cv-hub --type merge -p \
  '{"stringData":{"KEY_NAME":"NEW_VALUE"}}'

# 2. Restart the service(s) that use it
kubectl rollout restart deployment/cv-hub-api -n cv-hub
kubectl rollout restart deployment/cv-hub-worker -n cv-hub  # if worker uses it

# 3. Verify the rollout succeeded
kubectl rollout status deployment/cv-hub-api -n cv-hub --timeout=90s
```

## Secret inventory

### Stripe (used by: api)

| Secret key | What it is | Where to get a new one |
|------------|-----------|------------------------|
| `stripe-secret-key` | API secret key (`sk_live_...`) | Stripe Dashboard → Developers → API Keys → Roll key |
| `stripe-publishable-key` | Public key (`pk_live_...`) | Same page — rolls together with secret key |
| `stripe-webhook-secret` | Webhook signing secret (`whsec_...`) | Stripe Dashboard → Developers → Webhooks → your endpoint → Roll secret |
| `stripe-price-pro-monthly` | Price ID for Pro monthly | Stripe Dashboard → Products → CV-Hub Pro → Monthly price → Copy ID |
| `stripe-price-pro-annual` | Price ID for Pro annual | Same product → Annual price → Copy ID |
| `stripe-price-cvsafe-pro-annual` | Price ID for CV-Safe annual | Products → CV-Safe Pro → Annual price → Copy ID |
| `stripe-price-mcp-gateway-monthly` | Price ID for MCP Gateway | Products → MCP Gateway → Monthly price → Copy ID |
| `stripe-portal-config-id` | Customer portal config (optional) | Stripe Dashboard → Settings → Customer portal → Configuration ID |

**After rolling Stripe keys:** Restart api only. No data migration needed — existing subscriptions continue to work.

### Auth & Sessions (used by: api)

| Secret key | What it is | Impact of rotation |
|------------|-----------|-------------------|
| `jwt-access-secret` | Signs access tokens | All users logged out immediately |
| `jwt-refresh-secret` | Signs refresh tokens | All users logged out on next refresh |
| `jwt-secret` | Legacy/fallback JWT secret | Same as above |
| `csrf-secret` | CSRF token signing | Active forms will fail, users re-submit |
| `session-secret` | Express session signing | All sessions invalidated |
| `mfa-encryption-key` | Encrypts MFA TOTP secrets | Users must re-enroll MFA |

**To rotate:** Generate a new random value (`openssl rand -hex 32`), patch the secret, restart api + worker.

### Database (used by: api, worker)

| Secret key | What it is | Impact of rotation |
|------------|-----------|-------------------|
| `postgres-password` | Postgres user password | **MUST update Postgres first** |
| `postgres-user` | Postgres username | Same |
| `database-url` | Full connection string | Must match user/password/host |
| `redis-url` | Redis connection string | Sessions lost if Redis restarts |
| `falkordb-url` | FalkorDB connection string | Graph queries fail until reconnect |
| `qdrant-url` | Qdrant connection string | Vector search fails until reconnect |

**To rotate Postgres password:**
```bash
# 1. Connect to postgres and change the password
kubectl exec -it postgres-0 -n cv-hub -- psql -U cvhub -c "ALTER USER cvhub WITH PASSWORD 'NEW_PASSWORD';"

# 2. Update both secret keys
kubectl patch secret cv-hub-secrets -n cv-hub --type merge -p \
  '{"stringData":{"postgres-password":"NEW_PASSWORD","database-url":"postgresql://cvhub:NEW_PASSWORD@postgres:5432/cvhub"}}'

# 3. Restart api + worker
kubectl rollout restart deployment/cv-hub-api deployment/cv-hub-worker -n cv-hub
```

### OAuth & External APIs (used by: api)

| Secret key | What it is | Where to get a new one |
|------------|-----------|------------------------|
| `github-client-id` | GitHub OAuth app client ID | GitHub → Settings → Developer Settings → OAuth Apps |
| `github-client-secret` | GitHub OAuth app secret | Same page → Generate new client secret |
| `openrouter-api-key` | OpenRouter AI API key | openrouter.ai → Dashboard → API Keys |

### Object Storage (used by: api, backups)

| Secret key | What it is | Where to get a new one |
|------------|-----------|------------------------|
| `s3-access-key` | DO Spaces access key | DO Console → API → Spaces Keys |
| `s3-secret-key` | DO Spaces secret key | Same page |
| `s3-bucket` | Bucket name (`cv-hub-storage`) | Doesn't change |
| `s3-endpoint` | Spaces endpoint URL | Doesn't change |
| `s3-region` | Spaces region | Doesn't change |

## Current values that need attention

| Secret | Status | Action needed |
|--------|--------|---------------|
| `postgres-password` | `CHANGE_ME_IN_PRODUCTION` | **Change immediately** (see Postgres rotation steps above) |
| `stripe-portal-config-id` | Empty | Optional — set if you customize the Stripe billing portal |

## Verifying secrets are loaded

```bash
# Check what env vars a pod sees (redacted)
kubectl exec deployment/cv-hub-api -n cv-hub -- env | grep STRIPE | sed 's/=.\{10\}/=**REDACTED**/'

# Check a specific secret key exists
kubectl get secret cv-hub-secrets -n cv-hub -o jsonpath='{.data.stripe-secret-key}' | base64 -d | head -c 10; echo "..."
```
