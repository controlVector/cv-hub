#!/bin/bash
# Phase 4c: Build and Deploy Frontend to S3
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Building and deploying frontend..."

CF_DIST_ID=$(get_output "CF_DIST_ID")

if [[ -z "$CF_DIST_ID" ]]; then
  log_error "CloudFront distribution not found. Run 04b-cloudfront.sh first."
  exit 1
fi

# Build frontend
log_info "Building frontend with production environment..."
cd "$PROJECT_ROOT"

VITE_API_URL="https://${API_DOMAIN}/api" \
VITE_APP_URL="https://${WEB_DOMAIN}" \
pnpm --filter @cv-hub/web build

log_success "Frontend built successfully"

# Sync to S3
log_info "Uploading to S3..."

# Upload assets with long cache
aws s3 sync apps/web/dist/assets/ "s3://${S3_BUCKET_NAME}/assets/" \
  --cache-control "public, max-age=31536000, immutable" \
  --delete

# Upload index.html with no-cache
aws s3 cp apps/web/dist/index.html "s3://${S3_BUCKET_NAME}/index.html" \
  --cache-control "no-cache, no-store, must-revalidate"

# Upload other root files
for file in apps/web/dist/*; do
  if [[ -f "$file" ]] && [[ "$(basename "$file")" != "index.html" ]]; then
    aws s3 cp "$file" "s3://${S3_BUCKET_NAME}/$(basename "$file")" \
      --cache-control "public, max-age=3600"
  fi
done

log_success "Files uploaded to S3"

# Invalidate CloudFront cache
log_info "Invalidating CloudFront cache..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

log_success "Cache invalidation started: $INVALIDATION_ID"

log_success "Frontend deployment complete!"
echo ""
echo "Frontend deployed to: https://${WEB_DOMAIN}"
echo "CloudFront invalidation in progress (may take a few minutes)"
