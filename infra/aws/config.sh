#!/bin/bash
# AWS Deployment Configuration for Control Fabric AI

# AWS Settings
export AWS_REGION="us-west-2"
export AWS_ACCOUNT_ID="700239047066"

# Project Naming
export PROJECT_NAME="controlfab"
export ENVIRONMENT="production"

# Networking
export VPC_CIDR="10.0.0.0/16"
export PUBLIC_SUBNET_1_CIDR="10.0.1.0/24"
export PUBLIC_SUBNET_2_CIDR="10.0.2.0/24"
export PRIVATE_SUBNET_1_CIDR="10.0.10.0/24"
export PRIVATE_SUBNET_2_CIDR="10.0.11.0/24"

# Domain Configuration
export DOMAIN="controlfab.ai"
export WEB_DOMAIN="hub.controlfab.ai"
export API_DOMAIN="api.hub.controlfab.ai"
export CLOUDFLARE_ZONE_ID="56b61d2ef80ac3d7e9c59e37c995361b"

# Resource Names
export VPC_NAME="${PROJECT_NAME}-vpc"
export ECS_CLUSTER_NAME="${PROJECT_NAME}-cluster"
export ECR_REPO_NAME="${PROJECT_NAME}-api"
export RDS_IDENTIFIER="${PROJECT_NAME}-db"
export REDIS_CLUSTER_ID="${PROJECT_NAME}-cache"
export EFS_NAME="${PROJECT_NAME}-git-storage"
export S3_BUCKET_NAME="${PROJECT_NAME}-web-assets"
export ALB_NAME="${PROJECT_NAME}-alb"
export SECRET_NAME="${PROJECT_NAME}/production"

# Container Settings
export API_IMAGE="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:latest"
export API_CPU="1024"
export API_MEMORY="2048"
export API_DESIRED_COUNT="2"

export WORKER_CPU="512"
export WORKER_MEMORY="1024"

export FALKORDB_CPU="1024"
export FALKORDB_MEMORY="4096"

export QDRANT_CPU="1024"
export QDRANT_MEMORY="4096"

# Database Settings
export RDS_INSTANCE_CLASS="db.t4g.medium"
export RDS_ENGINE_VERSION="16"
export RDS_ALLOCATED_STORAGE="100"
export RDS_MASTER_USERNAME="cvhub_admin"

# Redis Settings
export REDIS_NODE_TYPE="cache.t4g.medium"
export REDIS_NUM_CLUSTERS="2"

# Cloudflare IPs (for security group rules)
# https://www.cloudflare.com/ips-v4
CLOUDFLARE_IPS=(
  "173.245.48.0/20"
  "103.21.244.0/22"
  "103.22.200.0/22"
  "103.31.4.0/22"
  "141.101.64.0/18"
  "108.162.192.0/18"
  "190.93.240.0/20"
  "188.114.96.0/20"
  "197.234.240.0/22"
  "198.41.128.0/17"
  "162.158.0.0/15"
  "104.16.0.0/13"
  "104.24.0.0/14"
  "172.64.0.0/13"
  "131.0.72.0/22"
)

# Helper function to get outputs stored during deployment
get_output() {
  local key="$1"
  local file="/home/schmotz/project/cv-hub/infra/aws/.outputs"
  if [[ -f "$file" ]]; then
    grep "^${key}=" "$file" | cut -d'=' -f2-
  fi
}

# Helper function to save outputs during deployment
save_output() {
  local key="$1"
  local value="$2"
  local file="/home/schmotz/project/cv-hub/infra/aws/.outputs"

  # Remove existing entry if present
  if [[ -f "$file" ]]; then
    grep -v "^${key}=" "$file" > "${file}.tmp" 2>/dev/null || true
    mv "${file}.tmp" "$file"
  fi

  # Add new entry
  echo "${key}=${value}" >> "$file"
}

# Color output helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Wait for resource to be available
wait_for_resource() {
  local description="$1"
  local check_command="$2"
  local max_attempts="${3:-60}"
  local sleep_interval="${4:-10}"

  log_info "Waiting for ${description}..."

  for ((i=1; i<=max_attempts; i++)); do
    if eval "$check_command" 2>/dev/null; then
      log_success "${description} is ready"
      return 0
    fi
    echo -n "."
    sleep "$sleep_interval"
  done

  echo ""
  log_error "${description} did not become ready within expected time"
  return 1
}
