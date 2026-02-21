#!/bin/bash
# Generate and apply secrets for CV-Hub
# Run this after cluster setup and before deploying the application

set -e

NAMESPACE="cv-hub"

echo "=== CV-Hub Secrets Generator ==="
echo ""

# Generate random secrets
SESSION_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
JWT_ACCESS_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)
CSRF_SECRET=$(openssl rand -base64 32)
MFA_KEY=$(openssl rand -base64 32)
PG_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)

echo "Generated secure random values for:"
echo "  - Session secret"
echo "  - JWT secret"
echo "  - JWT access secret"
echo "  - JWT refresh secret"
echo "  - CSRF secret"
echo "  - MFA encryption key"
echo "  - PostgreSQL password"
echo ""

# Prompt for API keys
echo "Enter your API keys (or leave blank to skip):"
echo ""

read -p "OpenRouter API Key: " OPENROUTER_KEY
read -p "GitHub OAuth Client ID (optional): " GITHUB_CLIENT_ID
read -p "GitHub OAuth Client Secret (optional): " GITHUB_CLIENT_SECRET
echo ""
echo "S3-compatible object storage (DO Spaces):"
read -p "S3 Endpoint (e.g. https://nyc3.digitaloceanspaces.com): " S3_ENDPOINT
read -p "S3 Bucket: " S3_BUCKET
read -p "S3 Access Key: " S3_ACCESS_KEY
read -p "S3 Secret Key: " S3_SECRET_KEY
read -p "S3 Region (e.g. nyc3): " S3_REGION

# Create the secret
echo ""
echo "=== Creating Kubernetes secret ==="

kubectl -n $NAMESPACE create secret generic cv-hub-secrets \
    --from-literal=session-secret="$SESSION_SECRET" \
    --from-literal=jwt-secret="$JWT_SECRET" \
    --from-literal=jwt-access-secret="$JWT_ACCESS_SECRET" \
    --from-literal=jwt-refresh-secret="$JWT_REFRESH_SECRET" \
    --from-literal=csrf-secret="$CSRF_SECRET" \
    --from-literal=mfa-encryption-key="$MFA_KEY" \
    --from-literal=postgres-user="cvhub" \
    --from-literal=postgres-password="$PG_PASSWORD" \
    --from-literal=database-url="postgresql://cvhub:$PG_PASSWORD@postgres:5432/cvhub" \
    --from-literal=redis-url="redis://redis:6379" \
    --from-literal=falkordb-url="redis://falkordb:6379" \
    --from-literal=qdrant-url="http://qdrant:6333" \
    --from-literal=openrouter-api-key="${OPENROUTER_KEY:-placeholder}" \
    --from-literal=github-client-id="${GITHUB_CLIENT_ID:-}" \
    --from-literal=github-client-secret="${GITHUB_CLIENT_SECRET:-}" \
    --from-literal=s3-endpoint="${S3_ENDPOINT:-}" \
    --from-literal=s3-bucket="${S3_BUCKET:-}" \
    --from-literal=s3-access-key="${S3_ACCESS_KEY:-}" \
    --from-literal=s3-secret-key="${S3_SECRET_KEY:-}" \
    --from-literal=s3-region="${S3_REGION:-}" \
    --dry-run=client -o yaml | kubectl apply -f -

echo ""
echo "=== Secret created successfully ==="
echo ""
echo "To view the secret:"
echo "  kubectl -n $NAMESPACE get secret cv-hub-secrets -o yaml"
echo ""
echo "To update a specific value later:"
echo "  kubectl -n $NAMESPACE patch secret cv-hub-secrets -p '{\"stringData\":{\"key\":\"new-value\"}}'"
