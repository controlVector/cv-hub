#!/bin/bash
# Phase 6: Run Database Migrations
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Running database migrations..."

DATABASE_URL=$(get_output "DATABASE_URL")

if [[ -z "$DATABASE_URL" ]]; then
  log_error "Database URL not found. Run 02-databases.sh first."
  exit 1
fi

# Check if we can connect to the database
log_info "Testing database connection..."

# We need to run this from within the VPC or use a bastion
# For now, we'll run a one-off ECS task

EXECUTION_ROLE_ARN=$(get_output "EXECUTION_ROLE_ARN")
TASK_ROLE_ARN=$(get_output "TASK_ROLE_ARN")
PRIVATE_SUBNET_1=$(get_output "PRIVATE_SUBNET_1")
PRIVATE_SUBNET_2=$(get_output "PRIVATE_SUBNET_2")
SG_API_ID=$(get_output "SG_API_ID")

# Create a migration task definition
log_info "Creating migration task definition..."
cat > /tmp/migrate-task.json << EOF
{
  "family": "${PROJECT_NAME}-migrate",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "${EXECUTION_ROLE_ARN}",
  "taskRoleArn": "${TASK_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "migrate",
      "image": "${API_IMAGE}",
      "essential": true,
      "command": ["node", "dist/db/migrate.js"],
      "environment": [
        {"name": "NODE_ENV", "value": "production"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:DATABASE_URL::"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${PROJECT_NAME}/api",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "migrate"
        }
      }
    }
  ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/migrate-task.json
log_success "Migration task definition created"

# Run the migration task
log_info "Running migration task..."
TASK_ARN=$(aws ecs run-task \
  --cluster "$ECS_CLUSTER_NAME" \
  --task-definition "${PROJECT_NAME}-migrate" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_1},${PRIVATE_SUBNET_2}],securityGroups=[${SG_API_ID}],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' \
  --output text)

log_success "Migration task started: $TASK_ARN"
log_info "Waiting for migration to complete..."

# Wait for task to complete
aws ecs wait tasks-stopped \
  --cluster "$ECS_CLUSTER_NAME" \
  --tasks "$TASK_ARN"

# Check exit code
EXIT_CODE=$(aws ecs describe-tasks \
  --cluster "$ECS_CLUSTER_NAME" \
  --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)

if [[ "$EXIT_CODE" == "0" ]]; then
  log_success "Database migrations completed successfully!"
else
  log_error "Migration failed with exit code: $EXIT_CODE"
  log_info "Check logs: aws logs get-log-events --log-group-name /ecs/${PROJECT_NAME}/api --log-stream-name migrate/..."
  exit 1
fi
