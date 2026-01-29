#!/bin/bash
# Build and Push Docker Images to ECR
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Building and pushing Docker images to ECR..."

cd "$PROJECT_ROOT"

# Login to ECR
log_info "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Build API image
log_info "Building API image..."
docker build -f Dockerfile.api -t "${ECR_REPO_NAME}:latest" .

# Tag for ECR
docker tag "${ECR_REPO_NAME}:latest" "${API_IMAGE}"

# Also tag with git commit
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
docker tag "${ECR_REPO_NAME}:latest" "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:${GIT_SHA}"

# Push to ECR
log_info "Pushing to ECR..."
docker push "${API_IMAGE}"
docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:${GIT_SHA}"

log_success "Docker image pushed successfully!"
echo ""
echo "Image: ${API_IMAGE}"
echo "Also tagged: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:${GIT_SHA}"
