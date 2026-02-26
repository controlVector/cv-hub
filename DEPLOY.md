# CV-Hub Deployment Runbook

## CRITICAL: Read This First

This codebase deploys to **two separate brands on two separate infrastructures**.
Deploying with the wrong brand configuration is a **production incident**.

| Brand | Domain | Infrastructure | Color | Blog | Research |
|-------|--------|---------------|-------|------|----------|
| **ControlVector** | `controlvector.io` | DigitalOcean Kubernetes | Orange `#f97316` | Enabled | Enabled |
| **ControlFab** | `controlfab.ai` | AWS ECS + S3/CloudFront | Purple `#8b5cf6` | Disabled | Disabled |

**Before deploying, always confirm which brand you are targeting.**

---

## Brand Configuration Reference

### ControlFab (controlfab.ai) — AWS

```bash
# API-side (runtime env vars on ECS)
BRAND_APP_NAME="Control Fabric Hub"
BRAND_SHORT_NAME="Control Fabric"
BRAND_COMPANY_NAME="Control Fabric"
BRAND_DOMAIN="controlfab.ai"
BRAND_NOREPLY_EMAIL="noreply@controlfab.ai"

# Web-side (build-time Vite env vars)
VITE_BRAND_APP_NAME="AI Control Fabric"
VITE_BRAND_SHORT_NAME="Control Fabric"
VITE_BRAND_COMPANY_NAME="Control Fabric"
VITE_BRAND_TAGLINE="The AI Development Platform"
VITE_BRAND_DOMAIN="controlfab.ai"
VITE_BRAND_CONTACT_EMAIL="sales@controlfab.ai"
VITE_BRAND_LOGO_PATH="/branding/controlfabric/logo.png"
VITE_BRAND_LOGO_FULL_PATH="/branding/controlfabric/logo.png"
VITE_BRAND_FAVICON_PATH="/branding/controlfabric/favicon.png"
VITE_BRAND_COLOR_PRIMARY="#8b5cf6"
VITE_BRAND_COLOR_SECONDARY="#06b6d4"
VITE_BRAND_COLOR_ACCENT="#a855f7"
VITE_BRAND_COLOR_BG="#0f172a"
VITE_BRAND_COLOR_BG_LIGHT="#1e293b"
VITE_BRAND_ENABLE_BLOG="false"
VITE_BRAND_ENABLE_RESEARCH="false"

# API URLs for web build
VITE_API_URL="https://api.hub.controlfab.ai/api"
VITE_APP_URL="https://hub.controlfab.ai"
```

### ControlVector (controlvector.io) — DigitalOcean

```bash
# API-side (runtime env vars in K8s ConfigMap/Secrets)
BRAND_APP_NAME="ControlVector Hub"
BRAND_SHORT_NAME="ControlVector"
BRAND_COMPANY_NAME="ControlVector"
BRAND_DOMAIN="controlvector.io"
BRAND_NOREPLY_EMAIL="noreply@controlvector.io"

# Web-side (build-time Vite env vars)
VITE_BRAND_APP_NAME="ControlVector Hub"
VITE_BRAND_SHORT_NAME="ControlVector"
VITE_BRAND_COMPANY_NAME="ControlVector"
VITE_BRAND_TAGLINE="AI-Native Git Platform"
VITE_BRAND_DOMAIN="controlvector.io"
VITE_BRAND_CONTACT_EMAIL="sales@controlvector.io"
VITE_BRAND_LOGO_PATH="/branding/controlvector/logo.png"
VITE_BRAND_LOGO_FULL_PATH="/branding/controlvector/logo-full.png"
VITE_BRAND_FAVICON_PATH="/branding/controlvector/favicon.png"
VITE_BRAND_COLOR_PRIMARY="#f97316"
VITE_BRAND_COLOR_SECONDARY="#06b6d4"
VITE_BRAND_COLOR_ACCENT="#fb923c"
VITE_BRAND_COLOR_BG="#0f172a"
VITE_BRAND_COLOR_BG_LIGHT="#1e293b"
VITE_BRAND_ENABLE_BLOG="true"
VITE_BRAND_ENABLE_RESEARCH="true"

# API URLs for web build
VITE_API_URL="https://api.hub.controlvector.io/api"
VITE_APP_URL="https://hub.controlvector.io"
```

---

## Deploy to ControlFab (AWS)

### AWS Infrastructure IDs

| Resource | Value |
|----------|-------|
| AWS Account | `700239047066` |
| Region | `us-west-2` |
| ECR Repository | `controlfab-api` |
| ECS Cluster | `controlfab-cluster` |
| ECS Service (API) | `controlfab-api` |
| S3 Bucket (Web) | `controlfab-web-assets` |
| CloudFront Distribution | `E1D32I9T5NEP6A` |
| Web Domain | `hub.controlfab.ai` |
| API Domain | `api.hub.controlfab.ai` |
| ALLOWED_ORIGINS | `https://hub.controlfab.ai` |

### Step 1: Build and Push API Image to ECR

```bash
# Authenticate with ECR
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 700239047066.dkr.ecr.us-west-2.amazonaws.com

# Build API image (no brand args needed — API reads brand at runtime)
docker build -t controlfab-api:latest -f Dockerfile.api .

# Tag and push
docker tag controlfab-api:latest 700239047066.dkr.ecr.us-west-2.amazonaws.com/controlfab-api:latest
docker tag controlfab-api:latest 700239047066.dkr.ecr.us-west-2.amazonaws.com/controlfab-api:$(git rev-parse HEAD)
docker push 700239047066.dkr.ecr.us-west-2.amazonaws.com/controlfab-api:latest
docker push 700239047066.dkr.ecr.us-west-2.amazonaws.com/controlfab-api:$(git rev-parse HEAD)
```

### Step 2: Update ECS Task Definition and Deploy

```bash
# Download current task definition
aws ecs describe-task-definition --task-definition controlfab-api \
  --query 'taskDefinition' --output json | \
  jq 'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)' \
  > /tmp/task-def.json

# Update image tag in task definition (update ALL containers)
IMAGE="700239047066.dkr.ecr.us-west-2.amazonaws.com/controlfab-api:$(git rev-parse HEAD)"
jq --arg img "$IMAGE" '
  .containerDefinitions |= map(
    if .name == "api" or .name == "ci-cd-worker" then .image = $img else . end
  )
' /tmp/task-def.json > /tmp/task-def-updated.json

# Register new task definition
aws ecs register-task-definition --cli-input-json file:///tmp/task-def-updated.json

# Update service to use new task definition
aws ecs update-service \
  --cluster controlfab-cluster \
  --service controlfab-api \
  --task-definition controlfab-api \
  --force-new-deployment

# Wait for deployment to stabilize
aws ecs wait services-stable --cluster controlfab-cluster --services controlfab-api
```

### Step 3: Build and Deploy Web to S3

**THIS IS WHERE BRANDING MATTERS MOST.** The web build bakes in all `VITE_*` vars at compile time.

```bash
# Install dependencies
pnpm install

# Build with ControlFab branding — EVERY variable must be set
VITE_API_URL="https://api.hub.controlfab.ai/api" \
VITE_APP_URL="https://hub.controlfab.ai" \
VITE_BRAND_APP_NAME="AI Control Fabric" \
VITE_BRAND_SHORT_NAME="Control Fabric" \
VITE_BRAND_COMPANY_NAME="Control Fabric" \
VITE_BRAND_TAGLINE="The AI Development Platform" \
VITE_BRAND_DOMAIN="controlfab.ai" \
VITE_BRAND_CONTACT_EMAIL="sales@controlfab.ai" \
VITE_BRAND_LOGO_PATH="/branding/controlfabric/logo.png" \
VITE_BRAND_LOGO_FULL_PATH="/branding/controlfabric/logo.png" \
VITE_BRAND_FAVICON_PATH="/branding/controlfabric/favicon.png" \
VITE_BRAND_COLOR_PRIMARY="#8b5cf6" \
VITE_BRAND_COLOR_SECONDARY="#06b6d4" \
VITE_BRAND_COLOR_ACCENT="#a855f7" \
VITE_BRAND_COLOR_BG="#0f172a" \
VITE_BRAND_COLOR_BG_LIGHT="#1e293b" \
VITE_BRAND_ENABLE_BLOG="false" \
VITE_BRAND_ENABLE_RESEARCH="false" \
pnpm --filter web build

# Verify branding before pushing (ALWAYS CHECK)
grep -o 'ControlVector\|controlvector\|#f97316' apps/web/dist/assets/*.js && \
  echo "ERROR: ControlVector branding detected in build!" && exit 1 || \
  echo "OK: No ControlVector branding found"

# Sync to S3
aws s3 sync apps/web/dist/ s3://controlfab-web-assets/ \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" \
  --exclude "*.json"

aws s3 cp apps/web/dist/index.html s3://controlfab-web-assets/index.html \
  --cache-control "no-cache, no-store, must-revalidate"

# Upload any JSON files with no-cache
find apps/web/dist -name "*.json" -exec aws s3 cp {} s3://controlfab-web-assets/ \
  --cache-control "no-cache, no-store, must-revalidate" \;

# Invalidate CloudFront
aws cloudfront create-invalidation \
  --distribution-id E1D32I9T5NEP6A \
  --paths "/*"
```

### Step 4: Verify Deployment

```bash
# Check HTML title and favicon
curl -s https://hub.controlfab.ai | grep -oE 'title>.*</title|favicon.*\.png'
# Expected: "AI Control Fabric" and "controlfabric/favicon.png"

# Check API health
curl -s https://api.hub.controlfab.ai/health
# Expected: {"status":"ok",...}

# Confirm no ControlVector branding
curl -s https://hub.controlfab.ai | grep -c 'ControlVector'
# Expected: 0
```

---

## Deploy to ControlVector (DigitalOcean Kubernetes)

### Infrastructure IDs

| Resource | Value |
|----------|-------|
| Registry | `registry.digitalocean.com/cv-hub-registry` |
| K8s Namespace | `cv-hub` |
| Web Domain | `hub.controlvector.io` |
| API Domain | `api.hub.controlvector.io` |
| Git Domain | `git.hub.controlvector.io` |

### Step 1: Build and Push Images to DO Registry

```bash
# Authenticate with DO registry
doctl registry login

# Build API
docker build -t registry.digitalocean.com/cv-hub-registry/api:latest -f Dockerfile.api .
docker push registry.digitalocean.com/cv-hub-registry/api:latest

# Build Web with ControlVector branding
docker build -t registry.digitalocean.com/cv-hub-registry/web:latest \
  --build-arg VITE_API_URL="https://api.hub.controlvector.io/api" \
  --build-arg VITE_APP_URL="https://hub.controlvector.io" \
  --build-arg VITE_BRAND_APP_NAME="ControlVector Hub" \
  --build-arg VITE_BRAND_SHORT_NAME="ControlVector" \
  --build-arg VITE_BRAND_COMPANY_NAME="ControlVector" \
  --build-arg VITE_BRAND_TAGLINE="AI-Native Git Platform" \
  --build-arg VITE_BRAND_DOMAIN="controlvector.io" \
  --build-arg VITE_BRAND_CONTACT_EMAIL="sales@controlvector.io" \
  --build-arg VITE_BRAND_LOGO_PATH="/branding/controlvector/logo.png" \
  --build-arg VITE_BRAND_LOGO_FULL_PATH="/branding/controlvector/logo-full.png" \
  --build-arg VITE_BRAND_FAVICON_PATH="/branding/controlvector/favicon.png" \
  --build-arg VITE_BRAND_COLOR_PRIMARY="#f97316" \
  --build-arg VITE_BRAND_COLOR_SECONDARY="#06b6d4" \
  --build-arg VITE_BRAND_COLOR_ACCENT="#fb923c" \
  --build-arg VITE_BRAND_COLOR_BG="#0f172a" \
  --build-arg VITE_BRAND_COLOR_BG_LIGHT="#1e293b" \
  --build-arg VITE_BRAND_ENABLE_BLOG="true" \
  --build-arg VITE_BRAND_ENABLE_RESEARCH="true" \
  -f Dockerfile.web .
docker push registry.digitalocean.com/cv-hub-registry/web:latest
```

### Step 2: Deploy to Kubernetes

```bash
# Apply kustomize overlay
kubectl apply -k deploy/kubernetes/overlays/digitalocean

# Restart deployments to pull new images
kubectl rollout restart deployment cv-hub-api -n cv-hub
kubectl rollout restart deployment cv-hub-web -n cv-hub
kubectl rollout restart deployment cv-hub-worker -n cv-hub

# Wait for rollout
kubectl rollout status deployment cv-hub-api -n cv-hub
kubectl rollout status deployment cv-hub-web -n cv-hub
```

### Step 3: Verify

```bash
curl -s https://hub.controlvector.io | grep -oE 'title>.*</title'
# Expected: "ControlVector Hub"

curl -s https://api.hub.controlvector.io/health
```

---

## Quick Reference: Brand Verification Commands

Always run these AFTER any deployment:

```bash
# ControlFab verification
curl -s https://hub.controlfab.ai | grep -oE 'title>.*</title'
# Must show: "AI Control Fabric"
curl -s https://hub.controlfab.ai | grep -c 'ControlVector'
# Must be: 0
curl -s https://hub.controlfab.ai | grep -c 'controlvector'
# Must be: 0

# ControlVector verification
curl -s https://hub.controlvector.io | grep -oE 'title>.*</title'
# Must show: "ControlVector Hub"
```

---

## ECS Task Definition: Required Environment Variables

When updating the ECS task definition for ControlFab, ensure these env vars are set
on the `api` container:

```json
[
  {"name": "NODE_ENV", "value": "production"},
  {"name": "PORT", "value": "3000"},
  {"name": "APP_URL", "value": "https://hub.controlfab.ai"},
  {"name": "API_URL", "value": "https://api.hub.controlfab.ai"},
  {"name": "ALLOWED_ORIGINS", "value": "https://hub.controlfab.ai"},
  {"name": "GIT_STORAGE_PATH", "value": "/data/git"},
  {"name": "BRAND_APP_NAME", "value": "Control Fabric Hub"},
  {"name": "BRAND_SHORT_NAME", "value": "Control Fabric"},
  {"name": "BRAND_COMPANY_NAME", "value": "Control Fabric"},
  {"name": "BRAND_DOMAIN", "value": "controlfab.ai"},
  {"name": "BRAND_NOREPLY_EMAIL", "value": "noreply@controlfab.ai"},
  {"name": "FALKORDB_URL", "value": "redis://falkordb.controlfab.local:6379"},
  {"name": "QDRANT_URL", "value": "http://qdrant.controlfab.local:6333"}
]
```

Database URL and secrets are stored in AWS Secrets Manager (`controlfab/production`).

---

## Common Mistakes to Avoid

1. **Building web without VITE_BRAND_* vars** — all defaults are ControlVector. You MUST export every variable.
2. **Forgetting VITE_BRAND_ENABLE_BLOG/RESEARCH** — ControlFab must have these set to `false`.
3. **Not invalidating CloudFront** — old assets will serve from cache for up to a year.
4. **Wrong ALLOWED_ORIGINS** — must match the web domain for that brand, not the other brand.
5. **Assuming CI/CD handles branding** — the GitHub Actions CI/CD has no repo variables set. Until that's fixed, branding must be set manually in every deploy.

---

## Architecture Notes

- **Web branding is baked at build time** via Vite. You cannot change it at runtime.
- **API branding is read at runtime** from environment variables. Changing ECS env vars + restarting tasks is sufficient.
- **Blog/Research visibility** is controlled by `VITE_BRAND_ENABLE_BLOG` and `VITE_BRAND_ENABLE_RESEARCH` (build-time only).
- **Both brands share the same codebase and git history.** There are no separate branches per brand.
- **Databases are fully independent** — DO PostgreSQL for ControlVector, AWS RDS for ControlFab.
- **The `.env.controlfabric` and `.env.controlvector` files** are presets for reference. They are NOT automatically loaded.
