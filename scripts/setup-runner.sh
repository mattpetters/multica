#!/bin/bash
# setup-runner.sh — Install GitHub Actions self-hosted runner on VPS
#
# Prerequisites:
#   - Linux x64 (tested on Ubuntu/Debian)
#   - Docker installed and accessible
#   - A GitHub personal access token or runner registration token
#
# Usage:
#   1. Go to https://github.com/mattpetters/multica/settings/actions/runners/new
#   2. Copy the registration token
#   3. Run: RUNNER_TOKEN=<token> bash scripts/setup-runner.sh
#
# This script:
#   - Creates /opt/actions-runner
#   - Downloads the latest runner release
#   - Configures it for the multica repo
#   - Installs as a systemd service
set -euo pipefail

RUNNER_DIR="/opt/actions-runner"
REPO_URL="https://github.com/mattpetters/multica"
RUNNER_LABELS="self-hosted,linux,x64,vps"
RUNNER_NAME="${RUNNER_NAME:-openclaw-vps}"

: "${RUNNER_TOKEN:?Set RUNNER_TOKEN from https://github.com/mattpetters/multica/settings/actions/runners/new}"

echo "=== Installing GitHub Actions Runner ==="
echo "Dir:    $RUNNER_DIR"
echo "Repo:   $REPO_URL"
echo "Labels: $RUNNER_LABELS"
echo "Name:   $RUNNER_NAME"
echo ""

# ── Create directory ──────────────────────────────────────────
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# ── Download latest runner ────────────────────────────────────
echo "Fetching latest runner release..."
LATEST_URL=$(curl -s https://api.github.com/repos/actions/runner/releases/latest \
  | grep -o '"browser_download_url": "[^"]*linux-x64[^"]*tar.gz"' \
  | head -1 \
  | cut -d'"' -f4)

if [ -z "$LATEST_URL" ]; then
  echo "❌ Could not determine latest runner URL"
  exit 1
fi

echo "Downloading: $LATEST_URL"
curl -sL "$LATEST_URL" -o actions-runner.tar.gz
tar xzf actions-runner.tar.gz
rm actions-runner.tar.gz

# ── Configure ─────────────────────────────────────────────────
echo ""
echo "=== Configuring runner ==="
./config.sh \
  --url "$REPO_URL" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "_work" \
  --replace \
  --unattended

# ── Install as systemd service ────────────────────────────────
echo ""
echo "=== Installing systemd service ==="
./svc.sh install

# ── Start service ─────────────────────────────────────────────
echo ""
echo "=== Starting runner ==="
./svc.sh start
./svc.sh status

echo ""
echo "=========================================="
echo "  ✅ Runner installed and running"
echo ""
echo "  Service: actions.runner.mattpetters-multica.${RUNNER_NAME}"
echo "  Dir:     $RUNNER_DIR"
echo "  Labels:  $RUNNER_LABELS"
echo ""
echo "  Manage:"
echo "    systemctl status actions.runner.mattpetters-multica.${RUNNER_NAME}"
echo "    systemctl restart actions.runner.mattpetters-multica.${RUNNER_NAME}"
echo "    journalctl -u actions.runner.mattpetters-multica.${RUNNER_NAME} -f"
echo ""
echo "  Verify at:"
echo "    https://github.com/mattpetters/multica/settings/actions/runners"
echo "=========================================="
