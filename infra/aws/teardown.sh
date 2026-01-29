#!/bin/bash
# Teardown Script - Remove all AWS resources
# USE WITH CAUTION - This will delete all resources!
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo ""
echo "=========================================="
echo "  Control Fabric AI - TEARDOWN"
echo "=========================================="
echo ""
log_warn "This will DELETE ALL AWS resources for Control Fabric AI!"
echo ""
echo "Resources to be deleted:"
echo "  - ECS services and cluster"
echo "  - ECR repository and images"
echo "  - ALB and target groups"
echo "  - CloudFront distribution"
echo "  - S3 bucket and contents"
echo "  - RDS database (DATA WILL BE LOST)"
echo "  - ElastiCache Redis cluster"
echo "  - EFS file system"
echo "  - VPC and all networking"
echo "  - Secrets Manager secrets"
echo "  - ACM certificates"
echo "  - IAM roles"
echo ""
read -p "Type 'DELETE' to confirm: " CONFIRM
if [[ "$CONFIRM" != "DELETE" ]]; then
  log_info "Teardown cancelled"
  exit 0
fi

# Delete ECS Services
log_info "Deleting ECS services..."
for svc in api graph-worker cicd-worker falkordb qdrant; do
  aws ecs update-service --cluster "$ECS_CLUSTER_NAME" --service "${PROJECT_NAME}-${svc}" --desired-count 0 2>/dev/null || true
  aws ecs delete-service --cluster "$ECS_CLUSTER_NAME" --service "${PROJECT_NAME}-${svc}" --force 2>/dev/null || true
done

# Delete ECS Task Definitions
log_info "Deregistering task definitions..."
for family in api graph-worker cicd-worker falkordb qdrant migrate; do
  TASK_DEFS=$(aws ecs list-task-definitions --family-prefix "${PROJECT_NAME}-${family}" --query 'taskDefinitionArns' --output text 2>/dev/null)
  for td in $TASK_DEFS; do
    aws ecs deregister-task-definition --task-definition "$td" 2>/dev/null || true
  done
done

# Delete ECS Cluster
log_info "Deleting ECS cluster..."
aws ecs delete-cluster --cluster "$ECS_CLUSTER_NAME" 2>/dev/null || true

# Delete Service Discovery
log_info "Deleting service discovery..."
SD_NAMESPACE_ID=$(get_output "SD_NAMESPACE_ID")
if [[ -n "$SD_NAMESPACE_ID" ]]; then
  for svc in falkordb qdrant; do
    SD_SVC_ID=$(aws servicediscovery list-services --query "Services[?Name=='${svc}'].Id" --output text 2>/dev/null)
    if [[ -n "$SD_SVC_ID" ]]; then
      aws servicediscovery delete-service --id "$SD_SVC_ID" 2>/dev/null || true
    fi
  done
  sleep 5
  aws servicediscovery delete-namespace --id "$SD_NAMESPACE_ID" 2>/dev/null || true
fi

# Delete ALB
log_info "Deleting ALB..."
ALB_ARN=$(get_output "ALB_ARN")
TG_ARN=$(get_output "TG_ARN")
if [[ -n "$ALB_ARN" ]]; then
  # Delete listeners first
  LISTENERS=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[*].ListenerArn' --output text 2>/dev/null)
  for listener in $LISTENERS; do
    aws elbv2 delete-listener --listener-arn "$listener" 2>/dev/null || true
  done
  aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN" 2>/dev/null || true
fi
if [[ -n "$TG_ARN" ]]; then
  aws elbv2 delete-target-group --target-group-arn "$TG_ARN" 2>/dev/null || true
fi

# Delete CloudFront
log_info "Deleting CloudFront distribution..."
CF_DIST_ID=$(get_output "CF_DIST_ID")
if [[ -n "$CF_DIST_ID" ]]; then
  # Disable distribution first
  ETAG=$(aws cloudfront get-distribution-config --id "$CF_DIST_ID" --query 'ETag' --output text)
  aws cloudfront get-distribution-config --id "$CF_DIST_ID" --query 'DistributionConfig' | \
    jq '.Enabled = false' > /tmp/cf-disable.json
  aws cloudfront update-distribution --id "$CF_DIST_ID" --distribution-config file:///tmp/cf-disable.json --if-match "$ETAG" 2>/dev/null || true
  log_info "Waiting for CloudFront to disable..."
  sleep 60
  NEW_ETAG=$(aws cloudfront get-distribution --id "$CF_DIST_ID" --query 'ETag' --output text)
  aws cloudfront delete-distribution --id "$CF_DIST_ID" --if-match "$NEW_ETAG" 2>/dev/null || true
fi

# Delete S3 bucket
log_info "Deleting S3 bucket..."
aws s3 rm "s3://${S3_BUCKET_NAME}" --recursive 2>/dev/null || true
aws s3api delete-bucket --bucket "$S3_BUCKET_NAME" 2>/dev/null || true

# Delete ECR
log_info "Deleting ECR repository..."
aws ecr delete-repository --repository-name "$ECR_REPO_NAME" --force 2>/dev/null || true

# Delete RDS
log_info "Deleting RDS instance..."
aws rds delete-db-instance --db-instance-identifier "$RDS_IDENTIFIER" --skip-final-snapshot --delete-automated-backups 2>/dev/null || true
log_info "Waiting for RDS deletion..."
aws rds wait db-instance-deleted --db-instance-identifier "$RDS_IDENTIFIER" 2>/dev/null || true
aws rds delete-db-subnet-group --db-subnet-group-name "${PROJECT_NAME}-db-subnet" 2>/dev/null || true

# Delete ElastiCache
log_info "Deleting ElastiCache..."
aws elasticache delete-replication-group --replication-group-id "$REDIS_CLUSTER_ID" --no-retain-primary-cluster 2>/dev/null || true
log_info "Waiting for ElastiCache deletion..."
sleep 120
aws elasticache delete-cache-subnet-group --cache-subnet-group-name "${PROJECT_NAME}-cache-subnet" 2>/dev/null || true

# Delete EFS
log_info "Deleting EFS..."
EFS_ID=$(get_output "EFS_ID")
if [[ -n "$EFS_ID" ]]; then
  # Delete mount targets first
  MOUNT_TARGETS=$(aws efs describe-mount-targets --file-system-id "$EFS_ID" --query 'MountTargets[*].MountTargetId' --output text 2>/dev/null)
  for mt in $MOUNT_TARGETS; do
    aws efs delete-mount-target --mount-target-id "$mt" 2>/dev/null || true
  done
  sleep 30
  # Delete access points
  ACCESS_POINTS=$(aws efs describe-access-points --file-system-id "$EFS_ID" --query 'AccessPoints[*].AccessPointId' --output text 2>/dev/null)
  for ap in $ACCESS_POINTS; do
    aws efs delete-access-point --access-point-id "$ap" 2>/dev/null || true
  done
  aws efs delete-file-system --file-system-id "$EFS_ID" 2>/dev/null || true
fi

# Delete Secrets
log_info "Deleting secrets..."
aws secretsmanager delete-secret --secret-id "$SECRET_NAME" --force-delete-without-recovery 2>/dev/null || true

# Delete ACM certificates
log_info "Deleting ACM certificates..."
API_CERT_ARN=$(get_output "API_CERT_ARN")
WEB_CERT_ARN=$(get_output "WEB_CERT_ARN")
if [[ -n "$API_CERT_ARN" ]]; then
  aws acm delete-certificate --certificate-arn "$API_CERT_ARN" 2>/dev/null || true
fi
if [[ -n "$WEB_CERT_ARN" ]]; then
  aws acm delete-certificate --region us-east-1 --certificate-arn "$WEB_CERT_ARN" 2>/dev/null || true
fi

# Delete IAM roles
log_info "Deleting IAM roles..."
aws iam delete-role-policy --role-name "${PROJECT_NAME}-ecs-execution-role" --policy-name "SecretsManagerAccess" 2>/dev/null || true
aws iam detach-role-policy --role-name "${PROJECT_NAME}-ecs-execution-role" --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>/dev/null || true
aws iam delete-role --role-name "${PROJECT_NAME}-ecs-execution-role" 2>/dev/null || true
aws iam delete-role-policy --role-name "${PROJECT_NAME}-ecs-task-role" --policy-name "EFSAccess" 2>/dev/null || true
aws iam delete-role --role-name "${PROJECT_NAME}-ecs-task-role" 2>/dev/null || true

# Delete CloudWatch Log Groups
log_info "Deleting CloudWatch log groups..."
for service in api graph-worker cicd-worker falkordb qdrant; do
  aws logs delete-log-group --log-group-name "/ecs/${PROJECT_NAME}/${service}" 2>/dev/null || true
done

# Delete VPC resources
log_info "Deleting VPC resources..."
VPC_ID=$(get_output "VPC_ID")
if [[ -n "$VPC_ID" ]]; then
  # Delete NAT Gateway
  NAT_GW_ID=$(get_output "NAT_GW_ID")
  if [[ -n "$NAT_GW_ID" ]]; then
    aws ec2 delete-nat-gateway --nat-gateway-id "$NAT_GW_ID" 2>/dev/null || true
    log_info "Waiting for NAT Gateway deletion..."
    sleep 60
  fi

  # Release Elastic IP
  EIP_ALLOC_ID=$(get_output "EIP_ALLOC_ID")
  if [[ -n "$EIP_ALLOC_ID" ]]; then
    aws ec2 release-address --allocation-id "$EIP_ALLOC_ID" 2>/dev/null || true
  fi

  # Delete security groups
  for sg in SG_ALB_ID SG_API_ID SG_RDS_ID SG_REDIS_ID SG_EFS_ID SG_INTERNAL_ID; do
    SG_ID=$(get_output "$sg")
    if [[ -n "$SG_ID" ]]; then
      aws ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null || true
    fi
  done

  # Delete subnets
  for subnet in PUBLIC_SUBNET_1 PUBLIC_SUBNET_2 PRIVATE_SUBNET_1 PRIVATE_SUBNET_2; do
    SUBNET_ID=$(get_output "$subnet")
    if [[ -n "$SUBNET_ID" ]]; then
      aws ec2 delete-subnet --subnet-id "$SUBNET_ID" 2>/dev/null || true
    fi
  done

  # Delete route tables
  for rt in PUBLIC_RT_ID PRIVATE_RT_ID; do
    RT_ID=$(get_output "$rt")
    if [[ -n "$RT_ID" ]]; then
      # Disassociate route tables first
      ASSOCS=$(aws ec2 describe-route-tables --route-table-ids "$RT_ID" --query 'RouteTables[0].Associations[?!Main].RouteTableAssociationId' --output text 2>/dev/null)
      for assoc in $ASSOCS; do
        aws ec2 disassociate-route-table --association-id "$assoc" 2>/dev/null || true
      done
      aws ec2 delete-route-table --route-table-id "$RT_ID" 2>/dev/null || true
    fi
  done

  # Detach and delete internet gateway
  IGW_ID=$(get_output "IGW_ID")
  if [[ -n "$IGW_ID" ]]; then
    aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" 2>/dev/null || true
    aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID" 2>/dev/null || true
  fi

  # Delete VPC
  aws ec2 delete-vpc --vpc-id "$VPC_ID" 2>/dev/null || true
fi

# Clean up outputs file
rm -f "${SCRIPT_DIR}/.outputs"

log_success "Teardown complete!"
echo ""
echo "All AWS resources for Control Fabric AI have been deleted."
echo "Note: Some resources may take a few minutes to fully delete."
