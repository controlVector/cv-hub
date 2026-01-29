#!/bin/bash
# Main Deployment Script for Control Fabric AI
# Orchestrates the complete AWS deployment
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo ""
echo "=========================================="
echo "  Control Fabric AI - AWS Deployment"
echo "=========================================="
echo ""
echo "Target:"
echo "  Web:  https://${WEB_DOMAIN}"
echo "  API:  https://${API_DOMAIN}"
echo ""
echo "AWS Account: ${AWS_ACCOUNT_ID}"
echo "Region:      ${AWS_REGION}"
echo ""

# Check prerequisites
log_info "Checking prerequisites..."

if ! command -v aws &> /dev/null; then
  log_error "AWS CLI is not installed"
  exit 1
fi

if ! command -v docker &> /dev/null; then
  log_error "Docker is not installed"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  log_error "jq is not installed"
  exit 1
fi

# Verify AWS credentials
AWS_IDENTITY=$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null)
if [[ "$AWS_IDENTITY" != "$AWS_ACCOUNT_ID" ]]; then
  log_error "AWS credentials not configured for account $AWS_ACCOUNT_ID"
  log_info "Current account: $AWS_IDENTITY"
  exit 1
fi
log_success "AWS credentials verified"

echo ""
echo "This script will deploy the following:"
echo "  1. VPC, subnets, security groups"
echo "  2. RDS PostgreSQL, ElastiCache Redis, EFS"
echo "  3. ECR, ECS cluster, ALB"
echo "  4. S3, CloudFront distribution"
echo "  5. Secrets Manager configuration"
echo "  6. Database migrations"
echo "  7. Cloudflare DNS records"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  log_info "Deployment cancelled"
  exit 0
fi

# Phase 1: VPC
log_info "========== Phase 1: VPC Infrastructure =========="
if [[ -n "$(get_output 'VPC_ID')" ]]; then
  log_warn "VPC already exists, skipping..."
else
  bash "${SCRIPT_DIR}/01-vpc.sh"
fi

# Phase 2: Databases
log_info "========== Phase 2: Database Infrastructure =========="
if [[ -n "$(get_output 'RDS_ENDPOINT')" ]]; then
  log_warn "Databases already exist, skipping..."
else
  bash "${SCRIPT_DIR}/02-databases.sh"
fi

# Phase 3: Container Infrastructure
log_info "========== Phase 3: Container Infrastructure =========="
if [[ -z "$(get_output 'ALB_ARN')" ]]; then
  bash "${SCRIPT_DIR}/03-containers.sh"
fi

# Build and push Docker image
log_info "========== Building Docker Image =========="
bash "${SCRIPT_DIR}/build-push.sh"

# Phase 5: Secrets
log_info "========== Phase 5: Secrets Configuration =========="
bash "${SCRIPT_DIR}/05-secrets.sh"

# Phase 4: Frontend (S3)
log_info "========== Phase 4: Frontend Infrastructure =========="
if [[ -z "$(get_output 'CF_DIST_ID')" ]]; then
  bash "${SCRIPT_DIR}/04-frontend.sh"
fi

# Phase 7: DNS Configuration
log_info "========== Phase 7: DNS Configuration =========="
bash "${SCRIPT_DIR}/07-dns.sh"

# Wait for certificates to be validated
log_info "Waiting for certificate validation..."
API_CERT_ARN=$(get_output "API_CERT_ARN")
WEB_CERT_ARN=$(get_output "WEB_CERT_ARN")

if [[ -n "$API_CERT_ARN" ]]; then
  log_info "Waiting for API certificate..."
  aws acm wait certificate-validated --certificate-arn "$API_CERT_ARN" --region "$AWS_REGION" 2>/dev/null || true
fi

if [[ -n "$WEB_CERT_ARN" ]]; then
  log_info "Waiting for web certificate..."
  aws acm wait certificate-validated --certificate-arn "$WEB_CERT_ARN" --region us-east-1 2>/dev/null || true
fi

# Create HTTPS listener if not exists
if [[ -z "$(get_output 'HTTPS_LISTENER_ARN')" ]]; then
  log_info "Creating HTTPS listener..."
  bash "${SCRIPT_DIR}/03b-listeners.sh" || log_warn "HTTPS listener creation failed - may need manual intervention"
fi

# Create CloudFront distribution if not exists
if [[ -z "$(get_output 'CF_DIST_ID')" ]]; then
  log_info "Creating CloudFront distribution..."
  bash "${SCRIPT_DIR}/04b-cloudfront.sh" || log_warn "CloudFront creation failed - may need manual intervention"
fi

# Create task definitions
log_info "========== Creating Task Definitions =========="
bash "${SCRIPT_DIR}/03c-tasks.sh"

# Create ECS services
log_info "========== Creating ECS Services =========="
bash "${SCRIPT_DIR}/03d-services.sh"

# Phase 6: Database migrations
log_info "========== Phase 6: Database Migrations =========="
bash "${SCRIPT_DIR}/06-migrate.sh"

# Deploy frontend
log_info "========== Deploying Frontend =========="
bash "${SCRIPT_DIR}/04c-deploy-frontend.sh"

# Verify deployment
log_info "========== Verifying Deployment =========="
bash "${SCRIPT_DIR}/verify.sh"

echo ""
echo "=========================================="
log_success "Deployment Complete!"
echo "=========================================="
echo ""
echo "  Web:  https://${WEB_DOMAIN}"
echo "  API:  https://${API_DOMAIN}"
echo ""
echo "View ECS services:"
echo "  aws ecs list-services --cluster ${ECS_CLUSTER_NAME}"
echo ""
echo "View logs:"
echo "  aws logs tail /ecs/${PROJECT_NAME}/api --follow"
echo ""
