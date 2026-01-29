#!/bin/bash
# Phase 5: Create Secrets in AWS Secrets Manager
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

log_info "Setting up secrets in AWS Secrets Manager..."

DATABASE_URL=$(get_output "DATABASE_URL")
REDIS_URL=$(get_output "REDIS_URL")

if [[ -z "$DATABASE_URL" ]]; then
  log_error "Database URL not found. Run 02-databases.sh first."
  exit 1
fi

# Generate secure secrets
log_info "Generating secure secrets..."
JWT_ACCESS_SECRET=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 48)
CSRF_SECRET=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 48)
MFA_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 48)

# Prompt for GitHub OAuth credentials if not provided
if [[ -z "$GITHUB_CLIENT_ID_VALUE" ]]; then
  echo ""
  log_warn "GitHub OAuth credentials needed for user repository connections."
  echo "Create a GitHub OAuth App at: https://github.com/settings/developers"
  echo "  - Homepage URL: https://${WEB_DOMAIN}"
  echo "  - Callback URL: https://${WEB_DOMAIN}/dashboard/settings/connections"
  echo ""
  read -p "Enter GITHUB_CLIENT_ID (or press Enter to skip): " GITHUB_CLIENT_ID_VALUE
  read -p "Enter GITHUB_CLIENT_SECRET (or press Enter to skip): " GITHUB_CLIENT_SECRET_VALUE
fi

# Prompt for OpenRouter API key (for embeddings)
if [[ -z "$OPENROUTER_API_KEY_VALUE" ]]; then
  echo ""
  log_warn "OpenRouter API key needed for semantic search embeddings."
  echo "Get an API key at: https://openrouter.ai/"
  echo ""
  read -p "Enter OPENROUTER_API_KEY (or press Enter to skip): " OPENROUTER_API_KEY_VALUE
fi

# Create secret JSON
log_info "Creating secrets in Secrets Manager..."
cat > /tmp/secrets.json << EOF
{
  "DATABASE_URL": "${DATABASE_URL}",
  "REDIS_URL": "${REDIS_URL}",
  "JWT_ACCESS_SECRET": "${JWT_ACCESS_SECRET}",
  "JWT_REFRESH_SECRET": "${JWT_REFRESH_SECRET}",
  "CSRF_SECRET": "${CSRF_SECRET}",
  "MFA_ENCRYPTION_KEY": "${MFA_ENCRYPTION_KEY}",
  "GITHUB_CLIENT_ID": "${GITHUB_CLIENT_ID_VALUE:-placeholder}",
  "GITHUB_CLIENT_SECRET": "${GITHUB_CLIENT_SECRET_VALUE:-placeholder}",
  "OPENROUTER_API_KEY": "${OPENROUTER_API_KEY_VALUE:-placeholder}"
}
EOF

# Create or update secret
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" 2>/dev/null; then
  log_info "Updating existing secret..."
  aws secretsmanager update-secret \
    --secret-id "$SECRET_NAME" \
    --secret-string file:///tmp/secrets.json
else
  log_info "Creating new secret..."
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --description "Control Fabric production secrets" \
    --secret-string file:///tmp/secrets.json \
    --tags "Key=Name,Value=${PROJECT_NAME}-secrets"
fi

# Clean up temp file
rm -f /tmp/secrets.json

log_success "Secrets configured in AWS Secrets Manager"
echo ""
echo "Secret ARN: arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_NAME}"
echo ""
echo "To update secrets later:"
echo "  aws secretsmanager update-secret --secret-id ${SECRET_NAME} --secret-string '{\"KEY\": \"value\"}'"
