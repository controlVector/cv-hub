#!/bin/bash
# Phase 9: Download cv-git release from GitHub and upload to S3
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

RELEASES_BUCKET="${PROJECT_NAME}-releases"
RELEASE_VERSION="0.5.0"
GITHUB_RELEASE_URL="https://github.com/controlVector/cv-git/releases/download/v${RELEASE_VERSION}"

TEMP_DIR="/tmp/cv-git-releases"
mkdir -p "${TEMP_DIR}"

log_info "Downloading cv-git v${RELEASE_VERSION} release assets from GitHub..."

# Define the assets to download
declare -A ASSETS=(
  ["cv-windows-x64.exe"]="cv-windows-x64.exe"
  ["cv-macos-x64"]="cv-macos-x64"
  ["cv-macos-arm64"]="cv-macos-arm64"
  ["cv-git_${RELEASE_VERSION}_amd64.deb"]="cv-git_${RELEASE_VERSION}_amd64.deb"
)

# Download each asset
for asset in "${!ASSETS[@]}"; do
  target="${ASSETS[$asset]}"
  local_path="${TEMP_DIR}/${target}"

  if [[ -f "${local_path}" ]]; then
    log_info "  ✓ ${asset} already downloaded"
  else
    log_info "  Downloading ${asset}..."
    curl -L -o "${local_path}" "${GITHUB_RELEASE_URL}/${asset}" || {
      log_info "    Warning: Failed to download ${asset}"
      continue
    }
    log_success "  ✓ Downloaded ${asset}"
  fi
done

log_info "Uploading assets to S3..."

S3_PREFIX="releases/cv-git/${RELEASE_VERSION}"

for asset in "${!ASSETS[@]}"; do
  target="${ASSETS[$asset]}"
  local_path="${TEMP_DIR}/${target}"

  if [[ -f "${local_path}" ]]; then
    # Determine content type
    case "${target}" in
      *.exe) CONTENT_TYPE="application/octet-stream" ;;
      *.deb) CONTENT_TYPE="application/vnd.debian.binary-package" ;;
      *) CONTENT_TYPE="application/octet-stream" ;;
    esac

    log_info "  Uploading ${target}..."
    aws s3 cp "${local_path}" "s3://${RELEASES_BUCKET}/${S3_PREFIX}/${target}" \
      --content-type "${CONTENT_TYPE}" \
      --metadata "version=${RELEASE_VERSION},source=github"

    # Get file size and hash
    FILE_SIZE=$(stat -c%s "${local_path}" 2>/dev/null || stat -f%z "${local_path}")
    FILE_HASH=$(sha256sum "${local_path}" | cut -d' ' -f1)

    log_success "    ✓ ${target} (${FILE_SIZE} bytes, sha256: ${FILE_HASH:0:16}...)"
  fi
done

# Also create an install.sh script for easy installation
log_info "Creating install.sh script..."

cat > "${TEMP_DIR}/install.sh" << 'INSTALL_SCRIPT'
#!/bin/bash
# CV-Git Installation Script
# https://hub.controlfab.ai/apps/cv-git

set -e

RELEASE_VERSION="0.5.0"
BASE_URL="https://releases.hub.controlfab.ai/releases/cv-git/${RELEASE_VERSION}"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "${OS}" in
  linux)
    case "${ARCH}" in
      x86_64) BINARY="cv-git_${RELEASE_VERSION}_amd64.deb" ;;
      *) echo "Unsupported architecture: ${ARCH}"; exit 1 ;;
    esac
    ;;
  darwin)
    case "${ARCH}" in
      x86_64) BINARY="cv-macos-x64" ;;
      arm64) BINARY="cv-macos-arm64" ;;
      *) echo "Unsupported architecture: ${ARCH}"; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: ${OS}"
    echo "Please download manually from https://hub.controlfab.ai/apps/cv-git"
    exit 1
    ;;
esac

echo "CV-Git Installer v${RELEASE_VERSION}"
echo "================================"
echo ""
echo "Detected: ${OS} ${ARCH}"
echo "Downloading: ${BINARY}"
echo ""

# Create installation directory
INSTALL_DIR="${HOME}/cv-hub"
BIN_DIR="${INSTALL_DIR}/bin"
mkdir -p "${BIN_DIR}"

# Download binary
DOWNLOAD_URL="${BASE_URL}/${BINARY}"
echo "Downloading from ${DOWNLOAD_URL}..."

if [[ "${BINARY}" == *.deb ]]; then
  # For .deb packages, download and extract
  TEMP_DEB="/tmp/cv-git.deb"
  curl -fsSL -o "${TEMP_DEB}" "${DOWNLOAD_URL}"

  # Check if we can use dpkg
  if command -v dpkg &> /dev/null && [[ $EUID -eq 0 ]]; then
    dpkg -i "${TEMP_DEB}"
  else
    # Extract without root
    echo "Extracting to ${INSTALL_DIR}..."
    dpkg-deb -x "${TEMP_DEB}" "${INSTALL_DIR}"
    # Move binary to bin
    find "${INSTALL_DIR}" -name "cv" -type f -exec mv {} "${BIN_DIR}/cv" \;
  fi
  rm -f "${TEMP_DEB}"
else
  # Direct binary download
  curl -fsSL -o "${BIN_DIR}/cv" "${DOWNLOAD_URL}"
  chmod +x "${BIN_DIR}/cv"
fi

echo ""
echo "Installation complete!"
echo ""
echo "Add to your PATH:"
echo "  export PATH=\"\${HOME}/cv-hub/bin:\${PATH}\""
echo ""
echo "Or add this to your ~/.bashrc or ~/.zshrc:"
echo "  echo 'export PATH=\"\${HOME}/cv-hub/bin:\${PATH}\"' >> ~/.bashrc"
echo ""
echo "Then run:"
echo "  cv doctor    # Verify installation"
echo "  cv init      # Initialize configuration"
echo "  cv sync      # Build knowledge graph"
echo ""
INSTALL_SCRIPT

aws s3 cp "${TEMP_DIR}/install.sh" "s3://${RELEASES_BUCKET}/install.sh" \
  --content-type "text/x-shellscript"

log_success "Uploaded install.sh"

# Create CloudFront invalidation to ensure fresh content
log_info "Creating CloudFront invalidation..."
RELEASES_CF_ID=$(get_output "RELEASES_CF_ID")
if [[ -n "$RELEASES_CF_ID" && "$RELEASES_CF_ID" != "None" ]]; then
  aws cloudfront create-invalidation \
    --distribution-id "${RELEASES_CF_ID}" \
    --paths "/${S3_PREFIX}/*" "/install.sh" \
    --query 'Invalidation.Id' --output text
  log_success "CloudFront invalidation created"
fi

log_success "Phase 9 complete! Release assets uploaded."
echo ""
echo "Assets available at:"
echo "  https://releases.hub.controlfab.ai/releases/cv-git/${RELEASE_VERSION}/"
echo ""
echo "Install script:"
echo "  curl -fsSL https://releases.hub.controlfab.ai/install.sh | bash"
echo ""

# Cleanup
rm -rf "${TEMP_DIR}"
