#!/bin/bash
# Phase 2: Database Infrastructure (RDS, ElastiCache, EFS)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Creating database infrastructure for Control Fabric AI..."

# Get VPC resources from outputs
VPC_ID=$(get_output "VPC_ID")
PRIVATE_SUBNET_1=$(get_output "PRIVATE_SUBNET_1")
PRIVATE_SUBNET_2=$(get_output "PRIVATE_SUBNET_2")
SG_RDS_ID=$(get_output "SG_RDS_ID")
SG_REDIS_ID=$(get_output "SG_REDIS_ID")
SG_EFS_ID=$(get_output "SG_EFS_ID")

if [[ -z "$VPC_ID" ]]; then
  log_error "VPC not found. Run 01-vpc.sh first."
  exit 1
fi

# Generate secure passwords
log_info "Generating secure passwords..."
RDS_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)
save_output "RDS_PASSWORD" "$RDS_PASSWORD"

# Create DB Subnet Group
log_info "Creating RDS subnet group..."
aws rds create-db-subnet-group \
  --db-subnet-group-name "${PROJECT_NAME}-db-subnet" \
  --db-subnet-group-description "Subnet group for Control Fabric RDS" \
  --subnet-ids "$PRIVATE_SUBNET_1" "$PRIVATE_SUBNET_2" \
  --tags "Key=Name,Value=${PROJECT_NAME}-db-subnet"
log_success "Created RDS subnet group"

# Create RDS PostgreSQL instance
log_info "Creating RDS PostgreSQL instance (this may take 10-15 minutes)..."
aws rds create-db-instance \
  --db-instance-identifier "$RDS_IDENTIFIER" \
  --db-instance-class "$RDS_INSTANCE_CLASS" \
  --engine postgres \
  --engine-version "$RDS_ENGINE_VERSION" \
  --master-username "$RDS_MASTER_USERNAME" \
  --master-user-password "$RDS_PASSWORD" \
  --allocated-storage "$RDS_ALLOCATED_STORAGE" \
  --storage-type gp3 \
  --db-subnet-group-name "${PROJECT_NAME}-db-subnet" \
  --vpc-security-group-ids "$SG_RDS_ID" \
  --multi-az \
  --no-publicly-accessible \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --preferred-maintenance-window "sun:04:00-sun:05:00" \
  --storage-encrypted \
  --copy-tags-to-snapshot \
  --tags "Key=Name,Value=${PROJECT_NAME}-db"
log_success "RDS instance creation initiated"

# Create ElastiCache Subnet Group
log_info "Creating ElastiCache subnet group..."
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name "${PROJECT_NAME}-cache-subnet" \
  --cache-subnet-group-description "Subnet group for Control Fabric Redis" \
  --subnet-ids "$PRIVATE_SUBNET_1" "$PRIVATE_SUBNET_2"
log_success "Created ElastiCache subnet group"

# Create ElastiCache Redis Replication Group
log_info "Creating ElastiCache Redis cluster (this may take 5-10 minutes)..."
aws elasticache create-replication-group \
  --replication-group-id "$REDIS_CLUSTER_ID" \
  --replication-group-description "Control Fabric Redis cache" \
  --engine redis \
  --engine-version "7.1" \
  --cache-node-type "$REDIS_NODE_TYPE" \
  --num-cache-clusters "$REDIS_NUM_CLUSTERS" \
  --cache-subnet-group-name "${PROJECT_NAME}-cache-subnet" \
  --security-group-ids "$SG_REDIS_ID" \
  --automatic-failover-enabled \
  --at-rest-encryption-enabled \
  --transit-encryption-enabled \
  --tags "Key=Name,Value=${PROJECT_NAME}-cache"
log_success "ElastiCache Redis creation initiated"

# Create EFS File System
log_info "Creating EFS file system..."
EFS_ID=$(aws efs create-file-system \
  --creation-token "${PROJECT_NAME}-git" \
  --performance-mode generalPurpose \
  --throughput-mode bursting \
  --encrypted \
  --tags "Key=Name,Value=${EFS_NAME}" \
  --query 'FileSystemId' \
  --output text)
log_success "Created EFS file system: $EFS_ID"
save_output "EFS_ID" "$EFS_ID"

# Wait for EFS to be available
wait_for_resource "EFS file system" \
  "aws efs describe-file-systems --file-system-id $EFS_ID --query 'FileSystems[0].LifeCycleState' --output text | grep -q 'available'" \
  30 5

# Create EFS mount targets in private subnets
log_info "Creating EFS mount targets..."
aws efs create-mount-target \
  --file-system-id "$EFS_ID" \
  --subnet-id "$PRIVATE_SUBNET_1" \
  --security-groups "$SG_EFS_ID"
aws efs create-mount-target \
  --file-system-id "$EFS_ID" \
  --subnet-id "$PRIVATE_SUBNET_2" \
  --security-groups "$SG_EFS_ID"
log_success "Created EFS mount targets"

# Create EFS Access Point for git repos
log_info "Creating EFS access point..."
EFS_ACCESS_POINT_ID=$(aws efs create-access-point \
  --file-system-id "$EFS_ID" \
  --posix-user "Uid=1001,Gid=1001" \
  --root-directory "Path=/git-repos,CreationInfo={OwnerUid=1001,OwnerGid=1001,Permissions=755}" \
  --tags "Key=Name,Value=${PROJECT_NAME}-git-ap" \
  --query 'AccessPointId' \
  --output text)
log_success "Created EFS access point: $EFS_ACCESS_POINT_ID"
save_output "EFS_ACCESS_POINT_ID" "$EFS_ACCESS_POINT_ID"

# Wait for RDS to be available (in background while we continue)
log_info "Waiting for RDS instance to be available..."
wait_for_resource "RDS instance" \
  "aws rds describe-db-instances --db-instance-identifier $RDS_IDENTIFIER --query 'DBInstances[0].DBInstanceStatus' --output text | grep -q 'available'" \
  90 20

# Get RDS endpoint
RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier "$RDS_IDENTIFIER" \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)
log_success "RDS endpoint: $RDS_ENDPOINT"
save_output "RDS_ENDPOINT" "$RDS_ENDPOINT"

DATABASE_URL="postgresql://${RDS_MASTER_USERNAME}:${RDS_PASSWORD}@${RDS_ENDPOINT}:5432/cvhub"
save_output "DATABASE_URL" "$DATABASE_URL"

# Wait for ElastiCache to be available
log_info "Waiting for ElastiCache Redis to be available..."
wait_for_resource "ElastiCache Redis" \
  "aws elasticache describe-replication-groups --replication-group-id $REDIS_CLUSTER_ID --query 'ReplicationGroups[0].Status' --output text | grep -q 'available'" \
  60 15

# Get Redis endpoint
REDIS_ENDPOINT=$(aws elasticache describe-replication-groups \
  --replication-group-id "$REDIS_CLUSTER_ID" \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
  --output text)
REDIS_PORT=$(aws elasticache describe-replication-groups \
  --replication-group-id "$REDIS_CLUSTER_ID" \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Port' \
  --output text)
log_success "Redis endpoint: $REDIS_ENDPOINT:$REDIS_PORT"
save_output "REDIS_ENDPOINT" "$REDIS_ENDPOINT"
save_output "REDIS_PORT" "$REDIS_PORT"

REDIS_URL="rediss://${REDIS_ENDPOINT}:${REDIS_PORT}"
save_output "REDIS_URL" "$REDIS_URL"

log_success "Phase 2 complete! Database infrastructure created."
echo ""
echo "Resources created:"
echo "  RDS PostgreSQL:"
echo "    Identifier: $RDS_IDENTIFIER"
echo "    Endpoint:   $RDS_ENDPOINT"
echo "    Username:   $RDS_MASTER_USERNAME"
echo ""
echo "  ElastiCache Redis:"
echo "    Cluster ID: $REDIS_CLUSTER_ID"
echo "    Endpoint:   $REDIS_ENDPOINT:$REDIS_PORT"
echo ""
echo "  EFS:"
echo "    File System ID:   $EFS_ID"
echo "    Access Point ID:  $EFS_ACCESS_POINT_ID"
echo ""
echo "Connection strings saved to .outputs file"
