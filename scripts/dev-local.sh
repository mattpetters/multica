#!/usr/bin/env bash
#
# Local development: Gateway (with Telegram bot) + Desktop + Web (for login)
#
# Usage:
#   pnpm dev:local
#
# Reads TELEGRAM_BOT_TOKEN from .env at the repo root.
# Gateway runs on port 4000 in long-polling mode (no TELEGRAM_WEBHOOK_URL needed).
# Web app runs on port 3000 (default) for OAuth login flow.
# Desktop connects to the local Gateway and uses local Web for login.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
ENV_FILE="$ROOT_DIR/.env"

# Load .env
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo "Copy .env.example to .env and fill in TELEGRAM_BOT_TOKEN"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not set in .env"
  exit 1
fi

echo "Starting local dev environment..."
echo "  Gateway:  http://localhost:4000 (Telegram long-polling mode)"
echo "  Web:      http://localhost:3000 (OAuth login)"
echo "  Desktop:  connecting to local Gateway + Web"
echo "  Data dir: ~/.super-multica-dev (isolated from production)"
echo "  Workspace: ~/Documents/Multica-dev (isolated from production)"
echo ""

# Build shared packages first
pnpm turbo build --filter=@multica/types --filter=@multica/utils --filter=@multica/core

# Start everything
# Gateway uses PORT=4000 to avoid conflict with Web app on port 3000
exec pnpm concurrently \
  -n types,utils,core,gateway,web,desktop \
  -c blue,green,yellow,magenta,red,cyan \
  "pnpm --filter @multica/types dev" \
  "pnpm --filter @multica/utils dev" \
  "pnpm --filter @multica/core dev" \
  "PORT=4000 SMC_DATA_DIR=~/.super-multica-dev MULTICA_WORKSPACE_DIR=~/Documents/Multica-dev MULTICA_RUN_LOG=1 pnpm --filter @multica/gateway dev" \
  "pnpm --filter @multica/web dev" \
  "GATEWAY_URL=http://localhost:4000 MAIN_VITE_WEB_URL=http://localhost:3000 SMC_DATA_DIR=~/.super-multica-dev MULTICA_WORKSPACE_DIR=~/Documents/Multica-dev MULTICA_RUN_LOG=1 pnpm --filter @multica/desktop dev"
