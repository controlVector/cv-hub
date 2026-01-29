#!/bin/bash
# Verify Deployment
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

echo ""
echo "=========================================="
echo "  Control Fabric AI - Deployment Verification"
echo "=========================================="
echo ""

ERRORS=0

# Check DNS resolution
log_info "Checking DNS resolution..."
if host "${WEB_DOMAIN}" > /dev/null 2>&1; then
  log_success "DNS resolves: ${WEB_DOMAIN}"
else
  log_error "DNS not resolving: ${WEB_DOMAIN}"
  ((ERRORS++))
fi

if host "${API_DOMAIN}" > /dev/null 2>&1; then
  log_success "DNS resolves: ${API_DOMAIN}"
else
  log_error "DNS not resolving: ${API_DOMAIN}"
  ((ERRORS++))
fi

# Check API health
log_info "Checking API health..."
API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "https://${API_DOMAIN}/api/health" 2>/dev/null || echo "000")
if [[ "$API_HEALTH" == "200" ]]; then
  log_success "API health check passed (HTTP 200)"
else
  log_error "API health check failed (HTTP ${API_HEALTH})"
  ((ERRORS++))
fi

# Check frontend
log_info "Checking frontend..."
WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://${WEB_DOMAIN}" 2>/dev/null || echo "000")
if [[ "$WEB_STATUS" == "200" ]]; then
  log_success "Frontend accessible (HTTP 200)"
else
  log_error "Frontend not accessible (HTTP ${WEB_STATUS})"
  ((ERRORS++))
fi

# Check ECS services
log_info "Checking ECS services..."
SERVICES=$(aws ecs list-services --cluster "$ECS_CLUSTER_NAME" --query 'serviceArns' --output text 2>/dev/null)
for svc_arn in $SERVICES; do
  svc_name=$(echo "$svc_arn" | rev | cut -d'/' -f1 | rev)
  RUNNING=$(aws ecs describe-services --cluster "$ECS_CLUSTER_NAME" --services "$svc_arn" \
    --query 'services[0].runningCount' --output text 2>/dev/null)
  DESIRED=$(aws ecs describe-services --cluster "$ECS_CLUSTER_NAME" --services "$svc_arn" \
    --query 'services[0].desiredCount' --output text 2>/dev/null)

  if [[ "$RUNNING" == "$DESIRED" ]] && [[ "$RUNNING" != "0" ]]; then
    log_success "ECS Service: ${svc_name} (${RUNNING}/${DESIRED} running)"
  else
    log_warn "ECS Service: ${svc_name} (${RUNNING}/${DESIRED} running)"
  fi
done

# Check RDS
log_info "Checking RDS status..."
RDS_STATUS=$(aws rds describe-db-instances --db-instance-identifier "$RDS_IDENTIFIER" \
  --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null)
if [[ "$RDS_STATUS" == "available" ]]; then
  log_success "RDS PostgreSQL: available"
else
  log_warn "RDS PostgreSQL: ${RDS_STATUS}"
fi

# Check ElastiCache
log_info "Checking ElastiCache status..."
REDIS_STATUS=$(aws elasticache describe-replication-groups --replication-group-id "$REDIS_CLUSTER_ID" \
  --query 'ReplicationGroups[0].Status' --output text 2>/dev/null)
if [[ "$REDIS_STATUS" == "available" ]]; then
  log_success "ElastiCache Redis: available"
else
  log_warn "ElastiCache Redis: ${REDIS_STATUS}"
fi

# Check CloudFront
log_info "Checking CloudFront status..."
CF_DIST_ID=$(get_output "CF_DIST_ID")
if [[ -n "$CF_DIST_ID" ]]; then
  CF_STATUS=$(aws cloudfront get-distribution --id "$CF_DIST_ID" \
    --query 'Distribution.Status' --output text 2>/dev/null)
  if [[ "$CF_STATUS" == "Deployed" ]]; then
    log_success "CloudFront: Deployed"
  else
    log_warn "CloudFront: ${CF_STATUS}"
  fi
fi

echo ""
echo "=========================================="
if [[ $ERRORS -eq 0 ]]; then
  log_success "All checks passed!"
else
  log_error "${ERRORS} check(s) failed"
fi
echo "=========================================="
echo ""
echo "Endpoints:"
echo "  Web:    https://${WEB_DOMAIN}"
echo "  API:    https://${API_DOMAIN}"
echo "  Health: https://${API_DOMAIN}/api/health"
echo ""
