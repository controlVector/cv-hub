#!/bin/bash
# Phase 3: Container Infrastructure (ECR, ECS, ALB, Services)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Creating container infrastructure for Control Fabric AI..."

# Get VPC resources from outputs
VPC_ID=$(get_output "VPC_ID")
PUBLIC_SUBNET_1=$(get_output "PUBLIC_SUBNET_1")
PUBLIC_SUBNET_2=$(get_output "PUBLIC_SUBNET_2")
PRIVATE_SUBNET_1=$(get_output "PRIVATE_SUBNET_1")
PRIVATE_SUBNET_2=$(get_output "PRIVATE_SUBNET_2")
SG_ALB_ID=$(get_output "SG_ALB_ID")
SG_API_ID=$(get_output "SG_API_ID")
SG_INTERNAL_ID=$(get_output "SG_INTERNAL_ID")
EFS_ID=$(get_output "EFS_ID")
EFS_ACCESS_POINT_ID=$(get_output "EFS_ACCESS_POINT_ID")

if [[ -z "$VPC_ID" ]]; then
  log_error "VPC not found. Run 01-vpc.sh first."
  exit 1
fi

# Create ECR Repository
log_info "Creating ECR repository..."
aws ecr create-repository \
  --repository-name "$ECR_REPO_NAME" \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256 \
  --tags "Key=Name,Value=${ECR_REPO_NAME}" 2>/dev/null || log_warn "ECR repository may already exist"
log_success "ECR repository ready"

# Create ECS Cluster
log_info "Creating ECS cluster..."
aws ecs create-cluster \
  --cluster-name "$ECS_CLUSTER_NAME" \
  --capacity-providers FARGATE FARGATE_SPOT \
  --default-capacity-provider-strategy "capacityProvider=FARGATE,weight=1,base=1" \
  --settings "name=containerInsights,value=enabled" \
  --tags "key=Name,value=${ECS_CLUSTER_NAME}" 2>/dev/null || log_warn "ECS cluster may already exist"
log_success "ECS cluster ready"

# Create CloudWatch Log Groups
log_info "Creating CloudWatch log groups..."
for service in api graph-worker cicd-worker falkordb qdrant; do
  aws logs create-log-group --log-group-name "/ecs/${PROJECT_NAME}/${service}" 2>/dev/null || true
  aws logs put-retention-policy --log-group-name "/ecs/${PROJECT_NAME}/${service}" --retention-in-days 30
done
log_success "CloudWatch log groups created"

# Create ECS Task Execution Role
log_info "Creating IAM roles..."
cat > /tmp/ecs-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create execution role
aws iam create-role \
  --role-name "${PROJECT_NAME}-ecs-execution-role" \
  --assume-role-policy-document file:///tmp/ecs-trust-policy.json \
  --tags "Key=Name,Value=${PROJECT_NAME}-ecs-execution-role" 2>/dev/null || log_warn "Execution role may already exist"

aws iam attach-role-policy \
  --role-name "${PROJECT_NAME}-ecs-execution-role" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>/dev/null || true

# Add Secrets Manager access to execution role
cat > /tmp/secrets-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name "${PROJECT_NAME}-ecs-execution-role" \
  --policy-name "SecretsManagerAccess" \
  --policy-document file:///tmp/secrets-policy.json

EXECUTION_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${PROJECT_NAME}-ecs-execution-role"
save_output "EXECUTION_ROLE_ARN" "$EXECUTION_ROLE_ARN"

# Create task role (for application permissions)
aws iam create-role \
  --role-name "${PROJECT_NAME}-ecs-task-role" \
  --assume-role-policy-document file:///tmp/ecs-trust-policy.json \
  --tags "Key=Name,Value=${PROJECT_NAME}-ecs-task-role" 2>/dev/null || log_warn "Task role may already exist"

# Add EFS access to task role
cat > /tmp/efs-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientWrite"
      ],
      "Resource": "arn:aws:elasticfilesystem:${AWS_REGION}:${AWS_ACCOUNT_ID}:file-system/${EFS_ID}",
      "Condition": {
        "StringEquals": {
          "elasticfilesystem:AccessPointArn": "arn:aws:elasticfilesystem:${AWS_REGION}:${AWS_ACCOUNT_ID}:access-point/${EFS_ACCESS_POINT_ID}"
        }
      }
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name "${PROJECT_NAME}-ecs-task-role" \
  --policy-name "EFSAccess" \
  --policy-document file:///tmp/efs-policy.json

TASK_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${PROJECT_NAME}-ecs-task-role"
save_output "TASK_ROLE_ARN" "$TASK_ROLE_ARN"

log_success "IAM roles created"

# Create Application Load Balancer
log_info "Creating Application Load Balancer..."
ALB_ARN=$(aws elbv2 create-load-balancer \
  --name "$ALB_NAME" \
  --type application \
  --scheme internet-facing \
  --subnets "$PUBLIC_SUBNET_1" "$PUBLIC_SUBNET_2" \
  --security-groups "$SG_ALB_ID" \
  --tags "Key=Name,Value=${ALB_NAME}" \
  --query 'LoadBalancers[0].LoadBalancerArn' \
  --output text)
log_success "Created ALB: $ALB_ARN"
save_output "ALB_ARN" "$ALB_ARN"

ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' \
  --output text)
log_success "ALB DNS: $ALB_DNS"
save_output "ALB_DNS" "$ALB_DNS"

ALB_HOSTED_ZONE=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].CanonicalHostedZoneId' \
  --output text)
save_output "ALB_HOSTED_ZONE" "$ALB_HOSTED_ZONE"

# Create Target Group
log_info "Creating target group..."
TG_ARN=$(aws elbv2 create-target-group \
  --name "${PROJECT_NAME}-api-tg" \
  --protocol HTTP \
  --port 3000 \
  --vpc-id "$VPC_ID" \
  --target-type ip \
  --health-check-enabled \
  --health-check-path "/api/health" \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text)
log_success "Created target group: $TG_ARN"
save_output "TG_ARN" "$TG_ARN"

# Request ACM certificate for API domain
log_info "Requesting ACM certificate for ${API_DOMAIN}..."
CERT_ARN=$(aws acm request-certificate \
  --domain-name "$API_DOMAIN" \
  --validation-method DNS \
  --tags "Key=Name,Value=${PROJECT_NAME}-api-cert" \
  --query 'CertificateArn' \
  --output text)
log_success "Certificate requested: $CERT_ARN"
save_output "API_CERT_ARN" "$CERT_ARN"

# Get DNS validation record
sleep 5
VALIDATION_RECORD=$(aws acm describe-certificate \
  --certificate-arn "$CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord' \
  --output json)

VALIDATION_NAME=$(echo "$VALIDATION_RECORD" | jq -r '.Name')
VALIDATION_VALUE=$(echo "$VALIDATION_RECORD" | jq -r '.Value')

log_warn "IMPORTANT: Add the following DNS record to Cloudflare for certificate validation:"
echo ""
echo "  Type:  CNAME"
echo "  Name:  ${VALIDATION_NAME%%.}"
echo "  Value: ${VALIDATION_VALUE%%.}"
echo ""
save_output "CERT_VALIDATION_NAME" "$VALIDATION_NAME"
save_output "CERT_VALIDATION_VALUE" "$VALIDATION_VALUE"

# Create HTTP listener (redirect to HTTPS)
log_info "Creating HTTP listener (redirect)..."
aws elbv2 create-listener \
  --load-balancer-arn "$ALB_ARN" \
  --protocol HTTP \
  --port 80 \
  --default-actions "Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}"

log_warn "HTTPS listener will be created after certificate validation"
log_info "Run: aws acm wait certificate-validated --certificate-arn $CERT_ARN"
log_info "Then run 03b-listeners.sh to create HTTPS listener"

# Create Service Discovery Namespace
log_info "Creating service discovery namespace..."
NAMESPACE_ID=$(aws servicediscovery create-private-dns-namespace \
  --name "${PROJECT_NAME}.local" \
  --vpc "$VPC_ID" \
  --query 'OperationId' \
  --output text)

# Wait for namespace creation
sleep 10
NAMESPACE_ARN=$(aws servicediscovery list-namespaces \
  --query "Namespaces[?Name=='${PROJECT_NAME}.local'].Arn" \
  --output text)
NAMESPACE_ID=$(aws servicediscovery list-namespaces \
  --query "Namespaces[?Name=='${PROJECT_NAME}.local'].Id" \
  --output text)
log_success "Created service discovery namespace: $NAMESPACE_ID"
save_output "SD_NAMESPACE_ID" "$NAMESPACE_ID"
save_output "SD_NAMESPACE_ARN" "$NAMESPACE_ARN"

# Create service discovery services for internal services
log_info "Creating service discovery services..."

for svc in falkordb qdrant; do
  SD_SVC_ID=$(aws servicediscovery create-service \
    --name "$svc" \
    --namespace-id "$NAMESPACE_ID" \
    --dns-config "NamespaceId=${NAMESPACE_ID},DnsRecords=[{Type=A,TTL=10}]" \
    --health-check-custom-config "FailureThreshold=1" \
    --query 'Service.Id' \
    --output text)
  save_output "SD_${svc^^}_ID" "$SD_SVC_ID"
  log_success "Created service discovery for $svc: $SD_SVC_ID"
done

log_success "Phase 3 (Part 1) complete! Core container infrastructure created."
echo ""
echo "Resources created:"
echo "  ECR Repository: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"
echo "  ECS Cluster:    $ECS_CLUSTER_NAME"
echo "  ALB:            $ALB_DNS"
echo "  Target Group:   $TG_ARN"
echo ""
echo "Next steps:"
echo "  1. Add DNS validation record to Cloudflare"
echo "  2. Wait for certificate validation"
echo "  3. Run 03b-listeners.sh to create HTTPS listener"
echo "  4. Run 03c-tasks.sh to create task definitions"
echo "  5. Run 03d-services.sh to create ECS services"
