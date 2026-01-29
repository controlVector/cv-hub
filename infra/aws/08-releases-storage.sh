#!/bin/bash
# Phase 8: Create S3 bucket and CloudFront for release assets
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Creating releases storage infrastructure..."

RELEASES_BUCKET="${PROJECT_NAME}-releases"
RELEASES_DOMAIN="releases.hub.controlfab.ai"

# Create S3 bucket for releases
log_info "Creating S3 bucket for releases..."
if aws s3api head-bucket --bucket "${RELEASES_BUCKET}" 2>/dev/null; then
  log_info "Bucket ${RELEASES_BUCKET} already exists"
else
  aws s3api create-bucket \
    --bucket "${RELEASES_BUCKET}" \
    --region "${AWS_REGION}" \
    --create-bucket-configuration LocationConstraint="${AWS_REGION}"
  log_success "Created bucket ${RELEASES_BUCKET}"
fi

# Enable versioning for safety
aws s3api put-bucket-versioning \
  --bucket "${RELEASES_BUCKET}" \
  --versioning-configuration Status=Enabled

# Block public access (CloudFront will handle public access)
aws s3api put-public-access-block \
  --bucket "${RELEASES_BUCKET}" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Create CloudFront OAC for releases bucket
log_info "Creating CloudFront OAC..."
OAC_NAME="${PROJECT_NAME}-releases-oac"
EXISTING_OAC=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='${OAC_NAME}'].Id" --output text 2>/dev/null)

if [[ -n "$EXISTING_OAC" && "$EXISTING_OAC" != "None" ]]; then
  RELEASES_OAC_ID="$EXISTING_OAC"
  log_info "Using existing OAC: ${RELEASES_OAC_ID}"
else
  RELEASES_OAC_ID=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "Name=${OAC_NAME},Description=OAC for releases bucket,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query 'OriginAccessControl.Id' --output text)
  log_success "Created OAC: ${RELEASES_OAC_ID}"
fi

save_output "RELEASES_OAC_ID" "$RELEASES_OAC_ID"

# Get or request ACM certificate for releases subdomain
log_info "Checking ACM certificate for ${RELEASES_DOMAIN}..."
# Use the existing wildcard cert or create one
RELEASES_CERT_ARN=$(aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='${RELEASES_DOMAIN}'].CertificateArn" --output text 2>/dev/null)

if [[ -z "$RELEASES_CERT_ARN" || "$RELEASES_CERT_ARN" == "None" ]]; then
  log_info "Requesting certificate for ${RELEASES_DOMAIN}..."
  RELEASES_CERT_ARN=$(aws acm request-certificate \
    --region us-east-1 \
    --domain-name "${RELEASES_DOMAIN}" \
    --validation-method DNS \
    --query 'CertificateArn' --output text)
  log_success "Certificate requested: ${RELEASES_CERT_ARN}"

  # Wait for DNS validation details
  sleep 10

  # Get DNS validation records
  VALIDATION_OPTIONS=$(aws acm describe-certificate \
    --region us-east-1 \
    --certificate-arn "${RELEASES_CERT_ARN}" \
    --query 'Certificate.DomainValidationOptions[0]')

  DNS_NAME=$(echo "$VALIDATION_OPTIONS" | jq -r '.ResourceRecord.Name')
  DNS_VALUE=$(echo "$VALIDATION_OPTIONS" | jq -r '.ResourceRecord.Value')

  log_info "Add this DNS record in Cloudflare:"
  log_info "  Type: CNAME"
  log_info "  Name: ${DNS_NAME}"
  log_info "  Value: ${DNS_VALUE}"

  # Add validation record to Cloudflare
  CLOUDFLARE_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
  ZONE_ID="56b61d2ef80ac3d7e9c59e37c995361b"

  if [[ -n "$CLOUDFLARE_TOKEN" ]]; then
    # Clean up the DNS name (remove trailing dot and domain)
    CLEAN_NAME=$(echo "$DNS_NAME" | sed 's/\.controlfab\.ai\.$//')

    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"CNAME\",\"name\":\"${CLEAN_NAME}\",\"content\":\"${DNS_VALUE}\",\"ttl\":1,\"proxied\":false}"

    log_success "Added DNS validation record to Cloudflare"
  fi

  log_info "Waiting for certificate validation..."
  aws acm wait certificate-validated --region us-east-1 --certificate-arn "${RELEASES_CERT_ARN}" || {
    log_info "Certificate validation taking time. Please ensure DNS record is set."
  }
fi

save_output "RELEASES_CERT_ARN" "$RELEASES_CERT_ARN"

# Create CloudFront distribution for releases
log_info "Creating CloudFront distribution for releases..."
EXISTING_DIST=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items[0]=='${RELEASES_DOMAIN}'].Id" --output text 2>/dev/null)

if [[ -n "$EXISTING_DIST" && "$EXISTING_DIST" != "None" ]]; then
  RELEASES_CF_ID="$EXISTING_DIST"
  log_info "Using existing CloudFront distribution: ${RELEASES_CF_ID}"
else
  RELEASES_CF_ID=$(aws cloudfront create-distribution \
    --distribution-config "{
      \"CallerReference\": \"${RELEASES_BUCKET}-$(date +%s)\",
      \"Comment\": \"Control Fabric releases storage\",
      \"DefaultCacheBehavior\": {
        \"TargetOriginId\": \"S3-${RELEASES_BUCKET}\",
        \"ViewerProtocolPolicy\": \"redirect-to-https\",
        \"AllowedMethods\": {
          \"Quantity\": 2,
          \"Items\": [\"GET\", \"HEAD\"],
          \"CachedMethods\": {\"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"]}
        },
        \"Compress\": true,
        \"CachePolicyId\": \"658327ea-f89d-4fab-a63d-7e88639e58f6\",
        \"OriginRequestPolicyId\": \"88a5eaf4-2fd4-4709-b370-b4c650ea3fcf\"
      },
      \"Enabled\": true,
      \"Origins\": {
        \"Quantity\": 1,
        \"Items\": [{
          \"Id\": \"S3-${RELEASES_BUCKET}\",
          \"DomainName\": \"${RELEASES_BUCKET}.s3.${AWS_REGION}.amazonaws.com\",
          \"S3OriginConfig\": {\"OriginAccessIdentity\": \"\"},
          \"OriginAccessControlId\": \"${RELEASES_OAC_ID}\"
        }]
      },
      \"Aliases\": {
        \"Quantity\": 1,
        \"Items\": [\"${RELEASES_DOMAIN}\"]
      },
      \"ViewerCertificate\": {
        \"ACMCertificateArn\": \"${RELEASES_CERT_ARN}\",
        \"SSLSupportMethod\": \"sni-only\",
        \"MinimumProtocolVersion\": \"TLSv1.2_2021\"
      },
      \"HttpVersion\": \"http2\",
      \"IsIPV6Enabled\": true,
      \"DefaultRootObject\": \"\"
    }" --query 'Distribution.Id' --output text)
  log_success "Created CloudFront distribution: ${RELEASES_CF_ID}"
fi

save_output "RELEASES_CF_ID" "$RELEASES_CF_ID"

# Get CloudFront domain name
RELEASES_CF_DOMAIN=$(aws cloudfront get-distribution --id "${RELEASES_CF_ID}" \
  --query 'Distribution.DomainName' --output text)
save_output "RELEASES_CF_DOMAIN" "$RELEASES_CF_DOMAIN"

# Update S3 bucket policy to allow CloudFront access
log_info "Updating S3 bucket policy..."
RELEASES_CF_ARN="arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${RELEASES_CF_ID}"

aws s3api put-bucket-policy --bucket "${RELEASES_BUCKET}" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Sid\": \"AllowCloudFrontServicePrincipal\",
      \"Effect\": \"Allow\",
      \"Principal\": {
        \"Service\": \"cloudfront.amazonaws.com\"
      },
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${RELEASES_BUCKET}/*\",
      \"Condition\": {
        \"StringEquals\": {
          \"AWS:SourceArn\": \"${RELEASES_CF_ARN}\"
        }
      }
    }
  ]
}"

log_success "Updated bucket policy"

# Add DNS record to Cloudflare
CLOUDFLARE_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
ZONE_ID="56b61d2ef80ac3d7e9c59e37c995361b"

if [[ -n "$CLOUDFLARE_TOKEN" ]]; then
  log_info "Adding releases DNS record to Cloudflare..."

  # Check if record exists
  EXISTING_RECORD=$(curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=${RELEASES_DOMAIN}" \
    -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" | jq -r '.result[0].id // empty')

  if [[ -n "$EXISTING_RECORD" ]]; then
    # Update existing record
    curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${EXISTING_RECORD}" \
      -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"CNAME\",\"name\":\"releases.hub\",\"content\":\"${RELEASES_CF_DOMAIN}\",\"ttl\":1,\"proxied\":false}"
  else
    # Create new record
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"CNAME\",\"name\":\"releases.hub\",\"content\":\"${RELEASES_CF_DOMAIN}\",\"ttl\":1,\"proxied\":false}"
  fi

  log_success "DNS record configured"
fi

log_success "Phase 8 complete! Releases storage infrastructure created."
echo ""
echo "Summary:"
echo "  Bucket: ${RELEASES_BUCKET}"
echo "  CloudFront ID: ${RELEASES_CF_ID}"
echo "  CloudFront Domain: ${RELEASES_CF_DOMAIN}"
echo "  Custom Domain: ${RELEASES_DOMAIN}"
echo ""
echo "Upload releases with:"
echo "  aws s3 cp file.exe s3://${RELEASES_BUCKET}/releases/cv-git/0.5.0/"
echo ""
