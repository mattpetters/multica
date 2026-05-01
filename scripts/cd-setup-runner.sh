#!/bin/bash
# cd-setup-runner.sh — Idempotent self-hosted GH runner install
# Can be run remotely via SSH or directly on the VPS.
#
# Usage: bash cd-setup-runner.sh <registration-token>
#   Get token: gh api -X POST repos/mattpetters/multica/actions/runners/registration-token --jq '.token'
#
# This script:
#   1. Creates /opt/actions-runner
#   2. Downloads latest GH runner for linux-x64
#   3. Configures it (idempotent — --replace)
#   4. Installs as systemd service
#   5. Adds daily Docker image prune cron (prevent disk bloat)
set -euo pipefail

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  echo "Usage: bash cd-setup-runner.sh <registration-token>"
  echo "  Get token: gh api -X POST repos/mattpetters/multica/actions/runners/registration-token --jq '.token'"
  exit 1
fi

RUNNER_DIR="/opt/actions-runner"
RUNNER_NAME="openclaw-vps"
RUNNER_LABELS="self-hosted,linux,x64"
REPO_URL="https://github.com/mattpetters/multica"

echo "=== Installing GitHub Actions Self-Hosted Runner ==="
echo "Dir:    $RUNNER_DIR"
echo "Name:   $RUNNER_NAME"
echo "Labels: $RUNNER_LABELS"
echo "Repo:   $REPO_URL"
echo ""

# Create dir
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Download latest runner if not already present
if [ ! -f "$RUNNER_DIR/config.sh" ]; then
  echo "=== Downloading latest runner ==="
  LATEST_URL=$(curl -s https://api.github.com/repos/actions/runner/releases/latest \
    | grep -o '"browser_download_url": "[^"]*linux-x64[^"]*tar.gz"' \
    | head -1 | cut -d'"' -f4)
  echo "Downloading: $LATEST_URL"
  curl -sL "$LATEST_URL" -o actions-runner.tar.gz
  tar xzf actions-runner.tar.gz
  rm actions-runner.tar.gz
else
  echo "Runner already downloaded, skipping"
fi

# Configure (idempotent)
echo ""
echo "=== Configuring runner ==="
./config.sh \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "_work" \
  --replace \
  --unattended

# Install and start systemd service
echo ""
echo "=== Installing systemd service ==="
./svc.sh install
./svc.sh start
./svc.sh status

# Add daily Docker cleanup cron
echo ""
echo "=== Setting up Docker cleanup cron ==="
cat > /etc/cron.daily/docker-cleanup << 'CRON'
#!/bin/sh
# Prune old Docker images (keep those used within 7 days)
docker image prune -f --filter "until=168h" 2>/dev/null || true
CRON
chmod +x /etc/cron.daily/docker-cleanup
echo "✅ Docker cleanup cron added"

echo ""
echo "=========================================="
echo "  ✅ Runner installed and running"
echo ""
echo "  Service: actions.runner.mattpetters-multica.${RUNNER_NAME}"
echo "  Dir:     $RUNNER_DIR"
echo "  Labels:  $RUNNER_LABELS"
echo "=========================================="
