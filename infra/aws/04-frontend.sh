#!/bin/bash
# Phase 4: Frontend Deployment (S3 + CloudFront)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Setting up frontend infrastructure..."

# Create S3 bucket
log_info "Creating S3 bucket for web assets..."
aws s3api create-bucket \
  --bucket "$S3_BUCKET_NAME" \
  --region "$AWS_REGION" \
  --create-bucket-configuration "LocationConstraint=${AWS_REGION}" 2>/dev/null || log_warn "S3 bucket may already exist"

# Block public access (CloudFront will use OAC)
aws s3api put-public-access-block \
  --bucket "$S3_BUCKET_NAME" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

log_success "S3 bucket configured: $S3_BUCKET_NAME"
save_output "S3_BUCKET_NAME" "$S3_BUCKET_NAME"

# Request ACM certificate for CloudFront (must be in us-east-1)
log_info "Requesting ACM certificate for ${WEB_DOMAIN} in us-east-1..."
CF_CERT_ARN=$(aws acm request-certificate \
  --region us-east-1 \
  --domain-name "$WEB_DOMAIN" \
  --validation-method DNS \
  --tags "Key=Name,Value=${PROJECT_NAME}-web-cert" \
  --query 'CertificateArn' \
  --output text)
log_success "Certificate requested: $CF_CERT_ARN"
save_output "WEB_CERT_ARN" "$CF_CERT_ARN"

# Get DNS validation record for web certificate
sleep 5
CF_VALIDATION_RECORD=$(aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn "$CF_CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord' \
  --output json)

CF_VALIDATION_NAME=$(echo "$CF_VALIDATION_RECORD" | jq -r '.Name')
CF_VALIDATION_VALUE=$(echo "$CF_VALIDATION_RECORD" | jq -r '.Value')

log_warn "IMPORTANT: Add the following DNS record to Cloudflare for certificate validation:"
echo ""
echo "  Type:  CNAME"
echo "  Name:  ${CF_VALIDATION_NAME%%.}"
echo "  Value: ${CF_VALIDATION_VALUE%%.}"
echo ""
save_output "WEB_CERT_VALIDATION_NAME" "$CF_VALIDATION_NAME"
save_output "WEB_CERT_VALIDATION_VALUE" "$CF_VALIDATION_VALUE"

# Create CloudFront Origin Access Control
log_info "Creating CloudFront Origin Access Control..."
OAC_ID=$(aws cloudfront create-origin-access-control \
  --origin-access-control-config "Name=${PROJECT_NAME}-oac,Description=OAC for ${S3_BUCKET_NAME},SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
  --query 'OriginAccessControl.Id' \
  --output text)
log_success "Created OAC: $OAC_ID"
save_output "OAC_ID" "$OAC_ID"

# Create CloudFront cache policies
log_info "Creating cache policies..."

# Check if the certificate is validated before creating CloudFront distribution
log_info "Checking certificate validation status..."
CF_CERT_STATUS=$(aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn "$CF_CERT_ARN" \
  --query 'Certificate.Status' \
  --output text)

if [[ "$CF_CERT_STATUS" != "ISSUED" ]]; then
  log_warn "Certificate not yet validated. Status: $CF_CERT_STATUS"
  log_info "Add the DNS validation record to Cloudflare, then run 04b-cloudfront.sh"
  exit 0
fi

# If certificate is already validated, continue with CloudFront
bash "${SCRIPT_DIR}/04b-cloudfront.sh"
