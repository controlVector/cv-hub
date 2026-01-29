#!/bin/bash
# Phase 4b: Create CloudFront Distribution
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Creating CloudFront distribution..."

OAC_ID=$(get_output "OAC_ID")
CF_CERT_ARN=$(get_output "WEB_CERT_ARN")

if [[ -z "$OAC_ID" ]] || [[ -z "$CF_CERT_ARN" ]]; then
  log_error "Missing OAC or certificate. Run 04-frontend.sh first."
  exit 1
fi

# Check certificate status
CF_CERT_STATUS=$(aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn "$CF_CERT_ARN" \
  --query 'Certificate.Status' \
  --output text)

if [[ "$CF_CERT_STATUS" != "ISSUED" ]]; then
  log_error "Certificate is not yet validated. Status: $CF_CERT_STATUS"
  log_info "Add the DNS validation record to Cloudflare and wait for validation."
  exit 1
fi

# Create CloudFront distribution
log_info "Creating CloudFront distribution..."
cat > /tmp/cloudfront-config.json << EOF
{
  "CallerReference": "${PROJECT_NAME}-$(date +%s)",
  "Aliases": {
    "Quantity": 1,
    "Items": ["${WEB_DOMAIN}"]
  },
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3Origin",
        "DomainName": "${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_ID}",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3Origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"],
      "CachedMethods": {
        "Quantity": 2,
        "Items": ["GET", "HEAD"]
      }
    },
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true
  },
  "CacheBehaviors": {
    "Quantity": 1,
    "Items": [
      {
        "PathPattern": "/assets/*",
        "TargetOriginId": "S3Origin",
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
          "Quantity": 2,
          "Items": ["GET", "HEAD"],
          "CachedMethods": {
            "Quantity": 2,
            "Items": ["GET", "HEAD"]
          }
        },
        "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
        "Compress": true
      }
    ]
  },
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      {
        "ErrorCode": 403,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 10
      },
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 10
      }
    ]
  },
  "Comment": "Control Fabric Web Distribution",
  "Enabled": true,
  "ViewerCertificate": {
    "ACMCertificateArn": "${CF_CERT_ARN}",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  },
  "HttpVersion": "http2and3",
  "PriceClass": "PriceClass_100"
}
EOF

CF_DIST_ID=$(aws cloudfront create-distribution \
  --distribution-config file:///tmp/cloudfront-config.json \
  --query 'Distribution.Id' \
  --output text)

CF_DOMAIN=$(aws cloudfront get-distribution \
  --id "$CF_DIST_ID" \
  --query 'Distribution.DomainName' \
  --output text)

log_success "Created CloudFront distribution: $CF_DIST_ID"
log_success "CloudFront domain: $CF_DOMAIN"
save_output "CF_DIST_ID" "$CF_DIST_ID"
save_output "CF_DOMAIN" "$CF_DOMAIN"

# Update S3 bucket policy for CloudFront OAC
log_info "Updating S3 bucket policy for CloudFront access..."
cat > /tmp/s3-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${S3_BUCKET_NAME}/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${CF_DIST_ID}"
        }
      }
    }
  ]
}
EOF

aws s3api put-bucket-policy \
  --bucket "$S3_BUCKET_NAME" \
  --policy file:///tmp/s3-policy.json

log_success "S3 bucket policy updated"

log_success "Phase 4b complete! CloudFront distribution created."
echo ""
echo "CloudFront Distribution:"
echo "  ID:     $CF_DIST_ID"
echo "  Domain: $CF_DOMAIN"
echo ""
echo "Next steps:"
echo "  1. Add CNAME record in Cloudflare: ${WEB_DOMAIN} -> ${CF_DOMAIN}"
echo "  2. Build and deploy frontend with: bash 04c-deploy-frontend.sh"
