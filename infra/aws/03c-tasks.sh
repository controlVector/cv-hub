#!/bin/bash
# Phase 3c: Create ECS Task Definitions
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Creating ECS task definitions..."

EXECUTION_ROLE_ARN=$(get_output "EXECUTION_ROLE_ARN")
TASK_ROLE_ARN=$(get_output "TASK_ROLE_ARN")
EFS_ID=$(get_output "EFS_ID")
EFS_ACCESS_POINT_ID=$(get_output "EFS_ACCESS_POINT_ID")

if [[ -z "$EXECUTION_ROLE_ARN" ]]; then
  log_error "Missing IAM roles. Run 03-containers.sh first."
  exit 1
fi

# API Task Definition
log_info "Creating API task definition..."
cat > /tmp/api-task.json << EOF
{
  "family": "${PROJECT_NAME}-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "${API_CPU}",
  "memory": "${API_MEMORY}",
  "executionRoleArn": "${EXECUTION_ROLE_ARN}",
  "taskRoleArn": "${TASK_ROLE_ARN}",
  "volumes": [
    {
      "name": "git-storage",
      "efsVolumeConfiguration": {
        "fileSystemId": "${EFS_ID}",
        "transitEncryption": "ENABLED",
        "authorizationConfig": {
          "accessPointId": "${EFS_ACCESS_POINT_ID}",
          "iam": "ENABLED"
        }
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "api",
      "image": "${API_IMAGE}",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "mountPoints": [
        {
          "sourceVolume": "git-storage",
          "containerPath": "/data/git",
          "readOnly": false
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "3000"},
        {"name": "APP_URL", "value": "https://${WEB_DOMAIN}"},
        {"name": "API_URL", "value": "https://${API_DOMAIN}"},
        {"name": "GIT_STORAGE_PATH", "value": "/data/git"},
        {"name": "FALKORDB_URL", "value": "redis://falkordb.${PROJECT_NAME}.local:6379"},
        {"name": "QDRANT_URL", "value": "http://qdrant.${PROJECT_NAME}.local:6333"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:DATABASE_URL::"},
        {"name": "REDIS_URL", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:REDIS_URL::"},
        {"name": "JWT_ACCESS_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:JWT_ACCESS_SECRET::"},
        {"name": "JWT_REFRESH_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:JWT_REFRESH_SECRET::"},
        {"name": "CSRF_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:CSRF_SECRET::"},
        {"name": "MFA_ENCRYPTION_KEY", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:MFA_ENCRYPTION_KEY::"},
        {"name": "GITHUB_CLIENT_ID", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:GITHUB_CLIENT_ID::"},
        {"name": "GITHUB_CLIENT_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:GITHUB_CLIENT_SECRET::"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${PROJECT_NAME}/api",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "api"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "wget -q --spider http://localhost:3000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/api-task.json
log_success "Created API task definition"

# Graph Worker Task Definition
log_info "Creating graph-worker task definition..."
cat > /tmp/graph-worker-task.json << EOF
{
  "family": "${PROJECT_NAME}-graph-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "${WORKER_CPU}",
  "memory": "${WORKER_MEMORY}",
  "executionRoleArn": "${EXECUTION_ROLE_ARN}",
  "taskRoleArn": "${TASK_ROLE_ARN}",
  "volumes": [
    {
      "name": "git-storage",
      "efsVolumeConfiguration": {
        "fileSystemId": "${EFS_ID}",
        "transitEncryption": "ENABLED",
        "authorizationConfig": {
          "accessPointId": "${EFS_ACCESS_POINT_ID}",
          "iam": "ENABLED"
        }
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "graph-worker",
      "image": "${API_IMAGE}",
      "command": ["node", "dist/workers/graph-sync.worker.js"],
      "essential": true,
      "mountPoints": [
        {
          "sourceVolume": "git-storage",
          "containerPath": "/data/git",
          "readOnly": false
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "GIT_STORAGE_PATH", "value": "/data/git"},
        {"name": "FALKORDB_URL", "value": "redis://falkordb.${PROJECT_NAME}.local:6379"},
        {"name": "QDRANT_URL", "value": "http://qdrant.${PROJECT_NAME}.local:6333"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:DATABASE_URL::"},
        {"name": "REDIS_URL", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:REDIS_URL::"},
        {"name": "JWT_ACCESS_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:JWT_ACCESS_SECRET::"},
        {"name": "JWT_REFRESH_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:JWT_REFRESH_SECRET::"},
        {"name": "CSRF_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:CSRF_SECRET::"},
        {"name": "MFA_ENCRYPTION_KEY", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:MFA_ENCRYPTION_KEY::"},
        {"name": "OPENROUTER_API_KEY", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:OPENROUTER_API_KEY::"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${PROJECT_NAME}/graph-worker",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "worker"
        }
      }
    }
  ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/graph-worker-task.json
log_success "Created graph-worker task definition"

# CI/CD Worker Task Definition
log_info "Creating cicd-worker task definition..."
cat > /tmp/cicd-worker-task.json << EOF
{
  "family": "${PROJECT_NAME}-cicd-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "${WORKER_CPU}",
  "memory": "${WORKER_MEMORY}",
  "executionRoleArn": "${EXECUTION_ROLE_ARN}",
  "taskRoleArn": "${TASK_ROLE_ARN}",
  "volumes": [
    {
      "name": "git-storage",
      "efsVolumeConfiguration": {
        "fileSystemId": "${EFS_ID}",
        "transitEncryption": "ENABLED",
        "authorizationConfig": {
          "accessPointId": "${EFS_ACCESS_POINT_ID}",
          "iam": "ENABLED"
        }
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "cicd-worker",
      "image": "${API_IMAGE}",
      "command": ["node", "dist/workers/ci-cd.worker.js"],
      "essential": true,
      "mountPoints": [
        {
          "sourceVolume": "git-storage",
          "containerPath": "/data/git",
          "readOnly": false
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "GIT_STORAGE_PATH", "value": "/data/git"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:DATABASE_URL::"},
        {"name": "REDIS_URL", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:REDIS_URL::"},
        {"name": "JWT_ACCESS_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:JWT_ACCESS_SECRET::"},
        {"name": "JWT_REFRESH_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:JWT_REFRESH_SECRET::"},
        {"name": "CSRF_SECRET", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:CSRF_SECRET::"},
        {"name": "MFA_ENCRYPTION_KEY", "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}:MFA_ENCRYPTION_KEY::"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${PROJECT_NAME}/cicd-worker",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "worker"
        }
      }
    }
  ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/cicd-worker-task.json
log_success "Created cicd-worker task definition"

# FalkorDB Task Definition
log_info "Creating FalkorDB task definition..."
cat > /tmp/falkordb-task.json << EOF
{
  "family": "${PROJECT_NAME}-falkordb",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "${FALKORDB_CPU}",
  "memory": "${FALKORDB_MEMORY}",
  "executionRoleArn": "${EXECUTION_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "falkordb",
      "image": "falkordb/falkordb:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 6379,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "FALKORDB_ARGS", "value": "--requirepass ''"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${PROJECT_NAME}/falkordb",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "falkordb"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "redis-cli ping | grep -q PONG || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 30
      }
    }
  ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/falkordb-task.json
log_success "Created FalkorDB task definition"

# Qdrant Task Definition
log_info "Creating Qdrant task definition..."
cat > /tmp/qdrant-task.json << EOF
{
  "family": "${PROJECT_NAME}-qdrant",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "${QDRANT_CPU}",
  "memory": "${QDRANT_MEMORY}",
  "executionRoleArn": "${EXECUTION_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "qdrant",
      "image": "qdrant/qdrant:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 6333,
          "protocol": "tcp"
        },
        {
          "containerPort": 6334,
          "protocol": "tcp"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${PROJECT_NAME}/qdrant",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "qdrant"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "wget -q --spider http://localhost:6333/readyz || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 30
      }
    }
  ]
}
EOF

aws ecs register-task-definition --cli-input-json file:///tmp/qdrant-task.json
log_success "Created Qdrant task definition"

log_success "Phase 3c complete! All task definitions created."
echo ""
echo "Task definitions created:"
echo "  - ${PROJECT_NAME}-api"
echo "  - ${PROJECT_NAME}-graph-worker"
echo "  - ${PROJECT_NAME}-cicd-worker"
echo "  - ${PROJECT_NAME}-falkordb"
echo "  - ${PROJECT_NAME}-qdrant"
