#!/bin/bash
# Phase 7: Configure Cloudflare DNS
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Configuring Cloudflare DNS..."

# Check for Cloudflare API token
if [[ -z "$CLOUDFLARE_API_TOKEN" ]]; then
  echo ""
  log_warn "Cloudflare API Token required for DNS configuration."
  echo "Create a token at: https://dash.cloudflare.com/profile/api-tokens"
  echo "Token needs: Zone:DNS:Edit permissions for controlfab.ai"
  echo ""
  read -p "Enter CLOUDFLARE_API_TOKEN: " CLOUDFLARE_API_TOKEN
  export CLOUDFLARE_API_TOKEN
fi

ALB_DNS=$(get_output "ALB_DNS")
CF_DOMAIN=$(get_output "CF_DOMAIN")
CERT_VALIDATION_NAME=$(get_output "CERT_VALIDATION_NAME")
CERT_VALIDATION_VALUE=$(get_output "CERT_VALIDATION_VALUE")
WEB_CERT_VALIDATION_NAME=$(get_output "WEB_CERT_VALIDATION_NAME")
WEB_CERT_VALIDATION_VALUE=$(get_output "WEB_CERT_VALIDATION_VALUE")

if [[ -z "$ALB_DNS" ]] || [[ -z "$CF_DOMAIN" ]]; then
  log_error "Missing ALB or CloudFront domain. Run infrastructure scripts first."
  exit 1
fi

# Function to create/update DNS record
create_dns_record() {
  local type="$1"
  local name="$2"
  local content="$3"
  local proxied="$4"

  # Check if record exists
  EXISTING=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=${type}&name=${name}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" | jq -r '.result[0].id // empty')

  if [[ -n "$EXISTING" ]]; then
    log_info "Updating existing ${type} record for ${name}..."
    curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${EXISTING}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"${type}\",\"name\":\"${name}\",\"content\":\"${content}\",\"proxied\":${proxied}}" | jq '.success'
  else
    log_info "Creating ${type} record for ${name}..."
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"${type}\",\"name\":\"${name}\",\"content\":\"${content}\",\"proxied\":${proxied}}" | jq '.success'
  fi
}

# Create certificate validation records
if [[ -n "$CERT_VALIDATION_NAME" ]] && [[ -n "$CERT_VALIDATION_VALUE" ]]; then
  log_info "Creating API certificate validation record..."
  # Remove trailing dot from validation name
  VALIDATION_NAME_CLEAN="${CERT_VALIDATION_NAME%%.}"
  VALIDATION_VALUE_CLEAN="${CERT_VALIDATION_VALUE%%.}"
  create_dns_record "CNAME" "$VALIDATION_NAME_CLEAN" "$VALIDATION_VALUE_CLEAN" "false"
fi

if [[ -n "$WEB_CERT_VALIDATION_NAME" ]] && [[ -n "$WEB_CERT_VALIDATION_VALUE" ]]; then
  log_info "Creating web certificate validation record..."
  WEB_VALIDATION_NAME_CLEAN="${WEB_CERT_VALIDATION_NAME%%.}"
  WEB_VALIDATION_VALUE_CLEAN="${WEB_CERT_VALIDATION_VALUE%%.}"
  create_dns_record "CNAME" "$WEB_VALIDATION_NAME_CLEAN" "$WEB_VALIDATION_VALUE_CLEAN" "false"
fi

# Create main DNS records
log_info "Creating DNS records for ${WEB_DOMAIN} and ${API_DOMAIN}..."

# Web domain -> CloudFront (proxied OFF for CloudFront)
create_dns_record "CNAME" "${WEB_DOMAIN}" "${CF_DOMAIN}" "false"

# API domain -> ALB (proxied ON for DDoS protection)
create_dns_record "CNAME" "${API_DOMAIN}" "${ALB_DNS}" "true"

log_success "DNS records configured!"
echo ""
echo "DNS Records:"
echo "  ${WEB_DOMAIN}     -> ${CF_DOMAIN} (Proxy: OFF)"
echo "  ${API_DOMAIN} -> ${ALB_DNS} (Proxy: ON)"
echo ""
echo "Certificate validation records also created."
echo ""
log_info "Waiting for DNS propagation..."
log_info "Check certificate status with:"
echo "  aws acm describe-certificate --certificate-arn \$(cat ${SCRIPT_DIR}/.outputs | grep API_CERT_ARN | cut -d'=' -f2)"
echo "  aws acm describe-certificate --region us-east-1 --certificate-arn \$(cat ${SCRIPT_DIR}/.outputs | grep WEB_CERT_ARN | cut -d'=' -f2)"
