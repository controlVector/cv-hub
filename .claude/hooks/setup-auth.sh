#!/usr/bin/env bash
# One-time setup: store CV-Hub PAT for Claude Code hooks.
# Usage: bash .claude/hooks/setup-auth.sh
set -euo pipefail

CRED_DIR="${HOME}/.config/cv-hub"
CRED_FILE="${CRED_DIR}/credentials"
API_DEFAULT="https://api.hub.controlvector.io"

echo "=== CV-Hub Claude Code Auth Setup ==="
echo ""

# Prompt for API base (allow override for local dev)
read -rp "CV-Hub API base URL [${API_DEFAULT}]: " api_url
api_url="${api_url:-$API_DEFAULT}"

# Prompt for PAT
read -rp "Personal Access Token (cv_pat_...): " pat
if [[ -z "$pat" ]]; then
  echo "Error: PAT is required" >&2
  exit 1
fi

# Validate token against the API
echo "Validating token..."
resp=$(curl -sf -H "Authorization: Bearer ${pat}" "${api_url}/api/v1/auth/whoami" 2>&1) || {
  echo "Error: Token validation failed. Check your PAT and API URL." >&2
  exit 1
}

username=$(echo "$resp" | grep -o '"username":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Authenticated as: ${username:-unknown}"

# Write credentials
mkdir -p "$CRED_DIR"
cat > "$CRED_FILE" <<EOF
CV_HUB_PAT=${pat}
CV_HUB_API=${api_url}
EOF
chmod 600 "$CRED_FILE"

echo ""
echo "Credentials saved to ${CRED_FILE}"
echo "Claude Code hooks will use these automatically."
