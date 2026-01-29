#!/bin/bash
# Phase 1: VPC Infrastructure Setup
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Creating VPC infrastructure for Control Fabric AI..."

# Create VPC
log_info "Creating VPC..."
VPC_ID=$(aws ec2 create-vpc \
  --cidr-block "$VPC_CIDR" \
  --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${VPC_NAME}}]" \
  --query 'Vpc.VpcId' \
  --output text)
log_success "Created VPC: $VPC_ID"
save_output "VPC_ID" "$VPC_ID"

# Enable DNS hostnames
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}'
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support '{"Value":true}'

# Get availability zones
AZ1="${AWS_REGION}a"
AZ2="${AWS_REGION}b"

# Create Internet Gateway
log_info "Creating Internet Gateway..."
IGW_ID=$(aws ec2 create-internet-gateway \
  --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${PROJECT_NAME}-igw}]" \
  --query 'InternetGateway.InternetGatewayId' \
  --output text)
aws ec2 attach-internet-gateway --vpc-id "$VPC_ID" --internet-gateway-id "$IGW_ID"
log_success "Created and attached Internet Gateway: $IGW_ID"
save_output "IGW_ID" "$IGW_ID"

# Create public subnets
log_info "Creating public subnets..."
PUBLIC_SUBNET_1=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block "$PUBLIC_SUBNET_1_CIDR" \
  --availability-zone "$AZ1" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJECT_NAME}-public-1}]" \
  --query 'Subnet.SubnetId' \
  --output text)
aws ec2 modify-subnet-attribute --subnet-id "$PUBLIC_SUBNET_1" --map-public-ip-on-launch
log_success "Created public subnet 1: $PUBLIC_SUBNET_1"
save_output "PUBLIC_SUBNET_1" "$PUBLIC_SUBNET_1"

PUBLIC_SUBNET_2=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block "$PUBLIC_SUBNET_2_CIDR" \
  --availability-zone "$AZ2" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJECT_NAME}-public-2}]" \
  --query 'Subnet.SubnetId' \
  --output text)
aws ec2 modify-subnet-attribute --subnet-id "$PUBLIC_SUBNET_2" --map-public-ip-on-launch
log_success "Created public subnet 2: $PUBLIC_SUBNET_2"
save_output "PUBLIC_SUBNET_2" "$PUBLIC_SUBNET_2"

# Create private subnets
log_info "Creating private subnets..."
PRIVATE_SUBNET_1=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block "$PRIVATE_SUBNET_1_CIDR" \
  --availability-zone "$AZ1" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJECT_NAME}-private-1}]" \
  --query 'Subnet.SubnetId' \
  --output text)
log_success "Created private subnet 1: $PRIVATE_SUBNET_1"
save_output "PRIVATE_SUBNET_1" "$PRIVATE_SUBNET_1"

PRIVATE_SUBNET_2=$(aws ec2 create-subnet \
  --vpc-id "$VPC_ID" \
  --cidr-block "$PRIVATE_SUBNET_2_CIDR" \
  --availability-zone "$AZ2" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJECT_NAME}-private-2}]" \
  --query 'Subnet.SubnetId' \
  --output text)
log_success "Created private subnet 2: $PRIVATE_SUBNET_2"
save_output "PRIVATE_SUBNET_2" "$PRIVATE_SUBNET_2"

# Create Elastic IP for NAT Gateway
log_info "Creating Elastic IP for NAT Gateway..."
EIP_ALLOC_ID=$(aws ec2 allocate-address \
  --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${PROJECT_NAME}-nat-eip}]" \
  --query 'AllocationId' \
  --output text)
log_success "Created Elastic IP: $EIP_ALLOC_ID"
save_output "EIP_ALLOC_ID" "$EIP_ALLOC_ID"

# Create NAT Gateway in public subnet
log_info "Creating NAT Gateway..."
NAT_GW_ID=$(aws ec2 create-nat-gateway \
  --subnet-id "$PUBLIC_SUBNET_1" \
  --allocation-id "$EIP_ALLOC_ID" \
  --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${PROJECT_NAME}-nat}]" \
  --query 'NatGateway.NatGatewayId' \
  --output text)
log_success "Created NAT Gateway: $NAT_GW_ID (waiting for it to become available...)"
save_output "NAT_GW_ID" "$NAT_GW_ID"

# Wait for NAT Gateway to be available
wait_for_resource "NAT Gateway" \
  "aws ec2 describe-nat-gateways --nat-gateway-ids $NAT_GW_ID --query 'NatGateways[0].State' --output text | grep -q 'available'" \
  60 10

# Create route tables
log_info "Creating route tables..."

# Public route table
PUBLIC_RT_ID=$(aws ec2 create-route-table \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PROJECT_NAME}-public-rt}]" \
  --query 'RouteTable.RouteTableId' \
  --output text)
aws ec2 create-route --route-table-id "$PUBLIC_RT_ID" --destination-cidr-block "0.0.0.0/0" --gateway-id "$IGW_ID"
aws ec2 associate-route-table --subnet-id "$PUBLIC_SUBNET_1" --route-table-id "$PUBLIC_RT_ID"
aws ec2 associate-route-table --subnet-id "$PUBLIC_SUBNET_2" --route-table-id "$PUBLIC_RT_ID"
log_success "Created public route table: $PUBLIC_RT_ID"
save_output "PUBLIC_RT_ID" "$PUBLIC_RT_ID"

# Private route table
PRIVATE_RT_ID=$(aws ec2 create-route-table \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PROJECT_NAME}-private-rt}]" \
  --query 'RouteTable.RouteTableId' \
  --output text)
aws ec2 create-route --route-table-id "$PRIVATE_RT_ID" --destination-cidr-block "0.0.0.0/0" --nat-gateway-id "$NAT_GW_ID"
aws ec2 associate-route-table --subnet-id "$PRIVATE_SUBNET_1" --route-table-id "$PRIVATE_RT_ID"
aws ec2 associate-route-table --subnet-id "$PRIVATE_SUBNET_2" --route-table-id "$PRIVATE_RT_ID"
log_success "Created private route table: $PRIVATE_RT_ID"
save_output "PRIVATE_RT_ID" "$PRIVATE_RT_ID"

# Create Security Groups
log_info "Creating security groups..."

# ALB Security Group - Allow HTTPS from Cloudflare IPs
SG_ALB_ID=$(aws ec2 create-security-group \
  --group-name "${PROJECT_NAME}-sg-alb" \
  --description "ALB security group - allows HTTPS from Cloudflare" \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PROJECT_NAME}-sg-alb}]" \
  --query 'GroupId' \
  --output text)
log_success "Created ALB security group: $SG_ALB_ID"
save_output "SG_ALB_ID" "$SG_ALB_ID"

# Add Cloudflare IP rules to ALB security group
log_info "Adding Cloudflare IP rules to ALB security group..."
for ip in "${CLOUDFLARE_IPS[@]}"; do
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ALB_ID" \
    --protocol tcp \
    --port 443 \
    --cidr "$ip" 2>/dev/null || true
done

# Also allow HTTP for redirect (optional)
for ip in "${CLOUDFLARE_IPS[@]}"; do
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ALB_ID" \
    --protocol tcp \
    --port 80 \
    --cidr "$ip" 2>/dev/null || true
done

# API/ECS Security Group - Allow from ALB
SG_API_ID=$(aws ec2 create-security-group \
  --group-name "${PROJECT_NAME}-sg-api" \
  --description "API security group - allows traffic from ALB" \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PROJECT_NAME}-sg-api}]" \
  --query 'GroupId' \
  --output text)
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_API_ID" \
  --protocol tcp \
  --port 3000 \
  --source-group "$SG_ALB_ID"
log_success "Created API security group: $SG_API_ID"
save_output "SG_API_ID" "$SG_API_ID"

# RDS Security Group - Allow from API/workers
SG_RDS_ID=$(aws ec2 create-security-group \
  --group-name "${PROJECT_NAME}-sg-rds" \
  --description "RDS security group - allows PostgreSQL from API" \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PROJECT_NAME}-sg-rds}]" \
  --query 'GroupId' \
  --output text)
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_RDS_ID" \
  --protocol tcp \
  --port 5432 \
  --source-group "$SG_API_ID"
log_success "Created RDS security group: $SG_RDS_ID"
save_output "SG_RDS_ID" "$SG_RDS_ID"

# Redis Security Group - Allow from API/workers
SG_REDIS_ID=$(aws ec2 create-security-group \
  --group-name "${PROJECT_NAME}-sg-redis" \
  --description "Redis security group - allows from API" \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PROJECT_NAME}-sg-redis}]" \
  --query 'GroupId' \
  --output text)
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_REDIS_ID" \
  --protocol tcp \
  --port 6379 \
  --source-group "$SG_API_ID"
log_success "Created Redis security group: $SG_REDIS_ID"
save_output "SG_REDIS_ID" "$SG_REDIS_ID"

# EFS Security Group - Allow NFS from API/workers
SG_EFS_ID=$(aws ec2 create-security-group \
  --group-name "${PROJECT_NAME}-sg-efs" \
  --description "EFS security group - allows NFS from API" \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PROJECT_NAME}-sg-efs}]" \
  --query 'GroupId' \
  --output text)
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_EFS_ID" \
  --protocol tcp \
  --port 2049 \
  --source-group "$SG_API_ID"
log_success "Created EFS security group: $SG_EFS_ID"
save_output "SG_EFS_ID" "$SG_EFS_ID"

# Internal services security group (FalkorDB, Qdrant)
SG_INTERNAL_ID=$(aws ec2 create-security-group \
  --group-name "${PROJECT_NAME}-sg-internal" \
  --description "Internal services security group" \
  --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PROJECT_NAME}-sg-internal}]" \
  --query 'GroupId' \
  --output text)
# FalkorDB port (Redis protocol)
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_INTERNAL_ID" \
  --protocol tcp \
  --port 6379 \
  --source-group "$SG_API_ID"
# Qdrant HTTP port
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_INTERNAL_ID" \
  --protocol tcp \
  --port 6333 \
  --source-group "$SG_API_ID"
# Qdrant gRPC port
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_INTERNAL_ID" \
  --protocol tcp \
  --port 6334 \
  --source-group "$SG_API_ID"
log_success "Created internal services security group: $SG_INTERNAL_ID"
save_output "SG_INTERNAL_ID" "$SG_INTERNAL_ID"

log_success "Phase 1 complete! VPC infrastructure created."
echo ""
echo "Resources created:"
echo "  VPC:              $VPC_ID"
echo "  Internet Gateway: $IGW_ID"
echo "  NAT Gateway:      $NAT_GW_ID"
echo "  Public Subnets:   $PUBLIC_SUBNET_1, $PUBLIC_SUBNET_2"
echo "  Private Subnets:  $PRIVATE_SUBNET_1, $PRIVATE_SUBNET_2"
echo "  Security Groups:"
echo "    ALB:      $SG_ALB_ID"
echo "    API:      $SG_API_ID"
echo "    RDS:      $SG_RDS_ID"
echo "    Redis:    $SG_REDIS_ID"
echo "    EFS:      $SG_EFS_ID"
echo "    Internal: $SG_INTERNAL_ID"
