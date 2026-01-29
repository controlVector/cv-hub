#!/bin/bash
# Phase 3b: Create HTTPS Listener (after certificate validation)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Creating HTTPS listener..."

ALB_ARN=$(get_output "ALB_ARN")
TG_ARN=$(get_output "TG_ARN")
CERT_ARN=$(get_output "API_CERT_ARN")

if [[ -z "$ALB_ARN" ]] || [[ -z "$TG_ARN" ]] || [[ -z "$CERT_ARN" ]]; then
  log_error "Missing required outputs. Run 03-containers.sh first."
  exit 1
fi

# Check certificate status
CERT_STATUS=$(aws acm describe-certificate \
  --certificate-arn "$CERT_ARN" \
  --query 'Certificate.Status' \
  --output text)

if [[ "$CERT_STATUS" != "ISSUED" ]]; then
  log_error "Certificate is not yet validated. Status: $CERT_STATUS"
  log_info "Add the DNS validation record to Cloudflare and wait for validation."
  log_info "You can check status with: aws acm describe-certificate --certificate-arn $CERT_ARN"
  exit 1
fi

# Create HTTPS listener
log_info "Creating HTTPS listener with certificate..."
HTTPS_LISTENER_ARN=$(aws elbv2 create-listener \
  --load-balancer-arn "$ALB_ARN" \
  --protocol HTTPS \
  --port 443 \
  --certificates "CertificateArn=${CERT_ARN}" \
  --ssl-policy "ELBSecurityPolicy-TLS13-1-2-2021-06" \
  --default-actions "Type=forward,TargetGroupArn=${TG_ARN}" \
  --query 'Listeners[0].ListenerArn' \
  --output text)

log_success "Created HTTPS listener: $HTTPS_LISTENER_ARN"
save_output "HTTPS_LISTENER_ARN" "$HTTPS_LISTENER_ARN"

echo ""
echo "HTTPS listener is ready!"
echo "API will be accessible at: https://${API_DOMAIN}"
