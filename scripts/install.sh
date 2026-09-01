#!/usr/bin/env bash
# ==============================================================================
# EdgeMon Agent Linux One-Click Installer & Systemd Daemon Setup
# Project: https://github.com/dooooling/edgemon
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# 1. Require Root / Sudo
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root. Try: sudo bash $0"
   exit 1
fi

# 2. Detect System Architecture
ARCH=$(uname -m)
case "${ARCH}" in
    x86_64|amd64)
        TARGET_ARCH="x86_64-unknown-linux-musl"
        ;;
    aarch64|arm64)
        TARGET_ARCH="aarch64-unknown-linux-musl"
        ;;
    *)
        log_error "Unsupported architecture: ${ARCH}. EdgeMon provides prebuilt binaries for x86_64 and aarch64."
        exit 1
        ;;
esac

log_info "Detected Architecture: ${ARCH} (Target: ${TARGET_ARCH})"

# 3. Parameters / Inputs
SERVER_URL="${EDGEMON_SERVER:-}"
NODE_ID="${EDGEMON_NODE_ID:-}"
NODE_TOKEN="${EDGEMON_TOKEN:-}"
VERSION="${EDGEMON_VERSION:-latest}"
ALLOW_HTTP="${EDGEMON_ALLOW_HTTP:-false}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server|-s)
            SERVER_URL="$2"
            shift 2
            ;;
        --id|-i)
            NODE_ID="$2"
            shift 2
            ;;
        --token|-t)
            NODE_TOKEN="$2"
            shift 2
            ;;
        --version|-v)
            VERSION="$2"
            shift 2
            ;;
        --allow-http)
            ALLOW_HTTP="true"
            shift
            ;;
        --help|-h)
            echo "Usage: bash install.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --server, -s <URL>      EdgeMon Worker URL (e.g. https://monitor.yourdomain.com)"
            echo "  --id, -i <UUID>         Node UUID created in EdgeMon Admin Console"
            echo "  --token, -t <TOKEN>     Node Secret Token"
            echo "  --version, -v <TAG>     Release version (default: latest)"
            echo "  --allow-http            Allow non-HTTPS server URL (testing only)"
            echo ""
            exit 0
            ;;
        *)
            log_warn "Unknown parameter: $1"
            shift
            ;;
    esac
done

# Interactive prompts if parameters are missing
if [[ -z "${SERVER_URL}" ]]; then
    read -rp "Enter EdgeMon Server URL (e.g. https://monitor.yourdomain.com): " SERVER_URL
fi

if [[ -z "${NODE_ID}" ]]; then
    read -rp "Enter Node ID (UUID): " NODE_ID
fi

if [[ -z "${NODE_TOKEN}" ]]; then
    read -rsp "Enter Node Token: " NODE_TOKEN
    echo ""
fi

# Clean trailing slash from server URL
SERVER_URL="${SERVER_URL%/}"

if [[ -z "${SERVER_URL}" || -z "${NODE_ID}" || -z "${NODE_TOKEN}" ]]; then
    log_error "Server URL, Node ID, and Node Token are required."
    exit 1
fi

# 4. Download Binary
REPO="dooooling/edgemon"
INSTALL_BIN="/usr/local/bin/edgemon-agent"
CONFIG_DIR="/etc/edgemon"
ENV_FILE="${CONFIG_DIR}/agent.env"

log_info "Fetching EdgeMon Agent binary..."

if [[ "${VERSION}" == "latest" ]]; then
    DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/edgemon-agent-${TARGET_ARCH}.tar.gz"
else
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/edgemon-agent-${TARGET_ARCH}.tar.gz"
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

log_info "Downloading from: ${DOWNLOAD_URL}"
if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${DOWNLOAD_URL}" -o "${TMP_DIR}/edgemon-agent.tar.gz" || {
        log_error "Failed to download binary from GitHub Releases. Check network or specified version."
        exit 1
    }
elif command -v wget >/dev/null 2>&1; then
    wget -qO "${TMP_DIR}/edgemon-agent.tar.gz" "${DOWNLOAD_URL}" || {
        log_error "Failed to download binary from GitHub Releases. Check network or specified version."
        exit 1
    }
else
    log_error "Neither curl nor wget is available. Please install one first."
    exit 1
fi

tar -xzf "${TMP_DIR}/edgemon-agent.tar.gz" -C "${TMP_DIR}"

if [[ ! -f "${TMP_DIR}/edgemon-agent" ]]; then
    log_error "Archive did not contain edgemon-agent binary."
    exit 1
fi

mkdir -p /usr/local/bin
install -m 755 "${TMP_DIR}/edgemon-agent" "${INSTALL_BIN}"
log_success "Installed binary to ${INSTALL_BIN}"

# 5. Write Configuration File with Strict Permissions (0600)
mkdir -p "${CONFIG_DIR}"
cat > "${ENV_FILE}" <<EOF
# EdgeMon Agent Daemon Environment Configuration
EDGEMON_SERVER=${SERVER_URL}
EDGEMON_NODE_ID=${NODE_ID}
EDGEMON_TOKEN=${NODE_TOKEN}
EOF

if [[ "${ALLOW_HTTP}" == "true" ]]; then
    echo "EDGEMON_ALLOW_HTTP=1" >> "${ENV_FILE}"
fi

chmod 600 "${ENV_FILE}"
log_success "Saved credentials to ${ENV_FILE} (permissions: 0600)"

# 6. Install & Configure Systemd Service
if command -v systemctl >/dev/null 2>&1 && [[ -d /etc/systemd/system ]]; then
    SERVICE_FILE="/etc/systemd/system/edgemon-agent.service"
    
    EXTRA_FLAGS=""
    if [[ "${ALLOW_HTTP}" == "true" ]]; then
        EXTRA_FLAGS="--allow-http"
    fi

    cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=EdgeMon Lightweight Telemetry Agent
Documentation=https://github.com/dooooling/edgemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
ExecStart=${INSTALL_BIN} --server \${EDGEMON_SERVER} --id \${EDGEMON_NODE_ID} --token \${EDGEMON_TOKEN} ${EXTRA_FLAGS}
Restart=always
RestartSec=5s
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal

# Security Sandbox Hardening
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable edgemon-agent.service
    systemctl restart edgemon-agent.service

    log_success "Systemd service 'edgemon-agent' enabled and started."
    log_info "Check service status with: systemctl status edgemon-agent"
    log_info "View real-time logs with: journalctl -u edgemon-agent -f"
else
    log_warn "Systemd not detected (e.g. OpenVZ / Alpine / Docker container)."
    log_info "You can run the agent manually in background:"
    log_info "nohup ${INSTALL_BIN} --server \"${SERVER_URL}\" --id \"${NODE_ID}\" --token \"${NODE_TOKEN}\" > /var/log/edgemon-agent.log 2>&1 &"
fi

log_success "========================================================"
log_success "  EdgeMon Agent installation completed successfully!    "
log_success "========================================================"
