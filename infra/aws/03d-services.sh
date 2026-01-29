#!/bin/bash
# Phase 3d: Create ECS Services
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Creating ECS services..."

PRIVATE_SUBNET_1=$(get_output "PRIVATE_SUBNET_1")
PRIVATE_SUBNET_2=$(get_output "PRIVATE_SUBNET_2")
SG_API_ID=$(get_output "SG_API_ID")
SG_INTERNAL_ID=$(get_output "SG_INTERNAL_ID")
TG_ARN=$(get_output "TG_ARN")
SD_NAMESPACE_ID=$(get_output "SD_NAMESPACE_ID")
SD_FALKORDB_ID=$(get_output "SD_FALKORDB_ID")
SD_QDRANT_ID=$(get_output "SD_QDRANT_ID")

if [[ -z "$PRIVATE_SUBNET_1" ]]; then
  log_error "Missing VPC resources. Run previous scripts first."
  exit 1
fi

# Create FalkorDB Service (needs to start first for service discovery)
log_info "Creating FalkorDB service..."
aws ecs create-service \
  --cluster "$ECS_CLUSTER_NAME" \
  --service-name "${PROJECT_NAME}-falkordb" \
  --task-definition "${PROJECT_NAME}-falkordb" \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1},${PRIVATE_SUBNET_2}],securityGroups=[${SG_INTERNAL_ID}],assignPublicIp=DISABLED}" \
  --service-registries "registryArn=arn:aws:servicediscovery:${AWS_REGION}:${AWS_ACCOUNT_ID}:service/${SD_FALKORDB_ID}" \
  --tags "key=Name,value=${PROJECT_NAME}-falkordb"
log_success "Created FalkorDB service"

# Create Qdrant Service
log_info "Creating Qdrant service..."
aws ecs create-service \
  --cluster "$ECS_CLUSTER_NAME" \
  --service-name "${PROJECT_NAME}-qdrant" \
  --task-definition "${PROJECT_NAME}-qdrant" \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1},${PRIVATE_SUBNET_2}],securityGroups=[${SG_INTERNAL_ID}],assignPublicIp=DISABLED}" \
  --service-registries "registryArn=arn:aws:servicediscovery:${AWS_REGION}:${AWS_ACCOUNT_ID}:service/${SD_QDRANT_ID}" \
  --tags "key=Name,value=${PROJECT_NAME}-qdrant"
log_success "Created Qdrant service"

# Wait for internal services to be running
log_info "Waiting for internal services to start..."
sleep 30

# Create API Service with ALB
log_info "Creating API service..."
aws ecs create-service \
  --cluster "$ECS_CLUSTER_NAME" \
  --service-name "${PROJECT_NAME}-api" \
  --task-definition "${PROJECT_NAME}-api" \
  --desired-count "$API_DESIRED_COUNT" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1},${PRIVATE_SUBNET_2}],securityGroups=[${SG_API_ID}],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=${TG_ARN},containerName=api,containerPort=3000" \
  --health-check-grace-period-seconds 120 \
  --deployment-configuration "minimumHealthyPercent=50,maximumPercent=200" \
  --tags "key=Name,value=${PROJECT_NAME}-api"
log_success "Created API service"

# Create Graph Worker Service
log_info "Creating graph-worker service..."
aws ecs create-service \
  --cluster "$ECS_CLUSTER_NAME" \
  --service-name "${PROJECT_NAME}-graph-worker" \
  --task-definition "${PROJECT_NAME}-graph-worker" \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1},${PRIVATE_SUBNET_2}],securityGroups=[${SG_API_ID}],assignPublicIp=DISABLED}" \
  --tags "key=Name,value=${PROJECT_NAME}-graph-worker"
log_success "Created graph-worker service"

# Create CI/CD Worker Service
log_info "Creating cicd-worker service..."
aws ecs create-service \
  --cluster "$ECS_CLUSTER_NAME" \
  --service-name "${PROJECT_NAME}-cicd-worker" \
  --task-definition "${PROJECT_NAME}-cicd-worker" \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1},${PRIVATE_SUBNET_2}],securityGroups=[${SG_API_ID}],assignPublicIp=DISABLED}" \
  --tags "key=Name,value=${PROJECT_NAME}-cicd-worker"
log_success "Created cicd-worker service"

log_success "Phase 3d complete! All ECS services created."
echo ""
echo "Services created:"
echo "  - ${PROJECT_NAME}-api (${API_DESIRED_COUNT} replicas)"
echo "  - ${PROJECT_NAME}-graph-worker (1 replica)"
echo "  - ${PROJECT_NAME}-cicd-worker (1 replica)"
echo "  - ${PROJECT_NAME}-falkordb (1 replica)"
echo "  - ${PROJECT_NAME}-qdrant (1 replica)"
echo ""
echo "View services: aws ecs list-services --cluster ${ECS_CLUSTER_NAME}"
echo "View tasks: aws ecs list-tasks --cluster ${ECS_CLUSTER_NAME}"
