#!/usr/bin/env bash
set -euo pipefail

# Manual deployment script for cv-hub
# Bypasses GitHub Actions for direct AWS deployment

usage() {
  cat <<EOF
Usage: $0 [OPTIONS]

Deploy cv-hub to AWS ECS and S3 manually.

Options:
  -e, --environment ENV   Target environment: dev or production (default: dev)
  -s, --skip-build        Skip Docker build, use existing image
  -w, --skip-web          Skip web build and S3 deploy
  -a, --skip-api          Skip API/worker ECS deploy
  --no-wait               Don't wait for ECS service stability
  -h, --help              Show this help message

Environment variables:
  VITE_SENTRY_DSN         Sentry DSN for web frontend (optional)
  SENTRY_DSN              Sentry DSN for API/worker (optional)
  AWS_REGION              AWS region (default: us-west-2)

Examples:
  $0 --environment dev
  $0 --environment production --skip-web
  SENTRY_DSN=https://... VITE_SENTRY_DSN=https://... $0 -e production
EOF
  exit 0
}

# Defaults
ENVIRONMENT="dev"
SKIP_BUILD=false
SKIP_WEB=false
SKIP_API=false
WAIT_FOR_STABILITY=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -e|--environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    -s|--skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -w|--skip-web)
      SKIP_WEB=true
      shift
      ;;
    -a|--skip-api)
      SKIP_API=true
      shift
      ;;
    --no-wait)
      WAIT_FOR_STABILITY=false
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

# Validate environment
if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "production" ]]; then
  echo "Error: environment must be 'dev' or 'production'"
  exit 1
fi

# AWS settings
AWS_REGION="${AWS_REGION:-us-west-2}"
ECR_REGISTRY="700239047066.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_REPOSITORY="controlfab-api"
ECS_CLUSTER="controlfab-cluster"
IMAGE_TAG=$(git rev-parse HEAD)

# Environment-specific settings
if [[ "$ENVIRONMENT" == "dev" ]]; then
  VITE_API_URL="https://api-dev.controlfab.ai/api"
  VITE_APP_URL="https://hub-dev.controlfab.ai"
  TASK_DEFINITION="controlfab-api-dev"
  ECS_SERVICE="controlfab-api-dev"
  S3_BUCKET="controlfab-web-assets-dev"
  CLOUDFRONT_DISTRIBUTION=""
else
  VITE_API_URL="https://api.hub.controlfab.ai/api"
  VITE_APP_URL="https://hub.controlfab.ai"
  TASK_DEFINITION="controlfab-api"
  ECS_SERVICE="controlfab-api"
  S3_BUCKET="controlfab-web-assets"
  CLOUDFRONT_DISTRIBUTION="E1D32I9T5NEP6A"
fi

echo "=== cv-hub Manual Deploy ==="
echo "Environment: $ENVIRONMENT"
echo "Image tag: $IMAGE_TAG"
echo "Sentry DSN (API): ${SENTRY_DSN:-(not set)}"
echo "Sentry DSN (Web): ${VITE_SENTRY_DSN:-(not set)}"
echo ""

# Change to repo root
cd "$(dirname "$0")/.."

# Login to ECR
echo "==> Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

# Build and push Docker image
if [[ "$SKIP_BUILD" == false && "$SKIP_API" == false ]]; then
  echo "==> Building Docker image..."
  docker build -f Dockerfile.api -t "$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" .
  docker tag "$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" "$ECR_REGISTRY/$ECR_REPOSITORY:${ENVIRONMENT/production/latest}"

  echo "==> Pushing Docker image..."
  docker push "$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG"
  docker push "$ECR_REGISTRY/$ECR_REPOSITORY:${ENVIRONMENT/production/latest}"
fi

# Deploy API to ECS
if [[ "$SKIP_API" == false ]]; then
  echo "==> Updating ECS task definition..."

  # Get current task definition
  aws ecs describe-task-definition --task-definition "$TASK_DEFINITION" \
    --query 'taskDefinition' | \
    jq 'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)' \
    > /tmp/task-definition.json

  # Update image and add SENTRY_DSN if set
  if [[ -n "${SENTRY_DSN:-}" ]]; then
    jq --arg img "$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" --arg dsn "$SENTRY_DSN" '
      .containerDefinitions |= map(
        .image = $img |
        .environment = ([.environment[] | select(.name != "SENTRY_DSN")] + [{"name": "SENTRY_DSN", "value": $dsn}])
      )
    ' /tmp/task-definition.json > /tmp/task-definition-updated.json
  else
    jq --arg img "$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" '
      .containerDefinitions |= map(.image = $img)
    ' /tmp/task-definition.json > /tmp/task-definition-updated.json
  fi

  # Register new task definition
  echo "==> Registering new task definition..."
  aws ecs register-task-definition --cli-input-json file:///tmp/task-definition-updated.json > /dev/null

  # Update service
  echo "==> Deploying to ECS service: $ECS_SERVICE..."
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$ECS_SERVICE" \
    --task-definition "$TASK_DEFINITION" \
    --force-new-deployment > /dev/null

  if [[ "$WAIT_FOR_STABILITY" == true ]]; then
    echo "==> Waiting for service stability (this may take a few minutes)..."
    aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE"
    echo "==> ECS deployment complete!"
  fi
fi

# Build and deploy web
if [[ "$SKIP_WEB" == false ]]; then
  echo "==> Installing dependencies..."
  pnpm install --frozen-lockfile

  echo "==> Building web app..."
  VITE_API_URL="$VITE_API_URL" \
  VITE_APP_URL="$VITE_APP_URL" \
  VITE_SENTRY_DSN="${VITE_SENTRY_DSN:-}" \
  pnpm --filter web build

  echo "==> Deploying to S3: $S3_BUCKET..."
  # Sync assets with long cache
  aws s3 sync apps/web/dist/ "s3://$S3_BUCKET/" \
    --delete \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "index.html" \
    --exclude "*.json"

  # Upload index.html with no-cache
  aws s3 cp apps/web/dist/index.html "s3://$S3_BUCKET/index.html" \
    --cache-control "no-cache, no-store, must-revalidate"

  # Upload JSON files with no-cache
  find apps/web/dist -name "*.json" -exec aws s3 cp {} "s3://$S3_BUCKET/" \
    --cache-control "no-cache, no-store, must-revalidate" \;

  # Invalidate CloudFront if production
  if [[ -n "$CLOUDFRONT_DISTRIBUTION" ]]; then
    echo "==> Invalidating CloudFront distribution..."
    aws cloudfront create-invalidation \
      --distribution-id "$CLOUDFRONT_DISTRIBUTION" \
      --paths "/*" > /dev/null
  fi

  echo "==> Web deployment complete!"
fi

echo ""
echo "=== Deployment Summary ==="
echo "Environment: $ENVIRONMENT"
echo "API URL: $VITE_API_URL"
echo "App URL: $VITE_APP_URL"
echo "Image: $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG"
