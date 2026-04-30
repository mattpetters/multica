#!/bin/bash
# cd-deploy.sh — VPS-side deploy script for the Multica CD pipeline
# Called from GitHub Actions via SSH.
#
# Usage:
#   ssh root@vps BACKEND_IMAGE=... WEB_IMAGE=... IMAGE_TAG=... \
#     COMMIT_SHA=... [GHCR_PAT=...] \
#     bash /docker/multica/scripts/cd-deploy.sh
set -euo pipefail

cd "${DEPLOY_DIR:-/docker/multica}"

# ── Required env ──────────────────────────────────────────────
: "${IMAGE_TAG:?Must set IMAGE_TAG (e.g. sha-abc1234)}"
: "${BACKEND_IMAGE:?Must set BACKEND_IMAGE}"
: "${WEB_IMAGE:?Must set WEB_IMAGE}"
: "${COMMIT_SHA:?Must set COMMIT_SHA}"

COMMIT_MSG="${COMMIT_MSG:-unknown}"

echo "========================================"
echo "  Multica CD Deploy"
echo "  Tag:     $IMAGE_TAG"
echo "  Commit:  ${COMMIT_SHA:0:7} — $COMMIT_MSG"
echo "  Backend: $BACKEND_IMAGE:$IMAGE_TAG"
echo "  Web:     $WEB_IMAGE:$IMAGE_TAG"
echo "  Dir:     $(pwd)"
echo "  Time:    $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "========================================"

# ── Login to GHCR if token provided ──────────────────────
if [ -n "${GHCR_PAT:-}" ]; then
  echo "🔄 Logging in to ghcr.io..."
  echo "$GHCR_PAT" | docker login ghcr.io -u "$GHCR_USER" --password-stdin 2>/dev/null
  echo "✅ GHCR authenticated"
fi

# ── Save previous tag ─────────────────────────────────────────
PREV_IMAGE_TAG=""
if [ -f .env ]; then
  PREV_IMAGE_TAG=$(grep '^DEPLOYED_IMAGE_TAG=' .env 2>/dev/null | cut -d= -f2 || echo "")
fi
echo "$PREV_IMAGE_TAG" > /tmp/.cd-prev-tag
echo "Previous tag: '${PREV_IMAGE_TAG:-none}'"

# ── Pull images ───────────────────────────────────────────────
echo ""
echo "=== Pulling images ==="
docker pull "${BACKEND_IMAGE}:${IMAGE_TAG}" | tail -1
docker pull "${WEB_IMAGE}:${IMAGE_TAG}" | tail -1

# ── Write version info to .env ────────────────────────────────
echo ""
echo "=== Updating .env ==="
if grep -q '^DEPLOYED_IMAGE_TAG=' .env 2>/dev/null; then
  sed -i "s/^DEPLOYED_IMAGE_TAG=.*/DEPLOYED_IMAGE_TAG=${IMAGE_TAG}/" .env
else
  echo "DEPLOYED_IMAGE_TAG=${IMAGE_TAG}" >> .env
fi

if grep -q '^DEPLOYED_COMMIT_HASH=' .env 2>/dev/null; then
  sed -i "s/^DEPLOYED_COMMIT_HASH=.*/DEPLOYED_COMMIT_HASH=${COMMIT_SHA}/" .env
else
  echo "DEPLOYED_COMMIT_HASH=${COMMIT_SHA}" >> .env
fi

if grep -q '^DEPLOYED_COMMIT_MSG=' .env 2>/dev/null; then
  sed -i "s|^DEPLOYED_COMMIT_MSG=.*|DEPLOYED_COMMIT_MSG=${COMMIT_MSG}|" .env
else
  echo "DEPLOYED_COMMIT_MSG=${COMMIT_MSG}" >> .env
fi

if grep -q '^DEPLOYED_AT=' .env 2>/dev/null; then
  sed -i "s|^DEPLOYED_AT=.*|DEPLOYED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')|" .env
else
  echo "DEPLOYED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> .env
fi

echo ".env updated"

# ── Write CD compose override ─────────────────────────────────
echo ""
echo "=== Writing compose override ==="
cat > docker-compose.cd.yml << COMPOSE_EOF
services:
  backend:
    image: ${BACKEND_IMAGE}:${IMAGE_TAG}
  frontend:
    image: ${WEB_IMAGE}:${IMAGE_TAG}
  caddy:
    image: caddy:2-alpine
    ports:
      - '8081:80'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    restart: unless-stopped
    depends_on:
      - backend
      - frontend
COMPOSE_EOF

echo "docker-compose.cd.yml written"

# ── Deploy ─────────────────────────────────────────────────────
echo ""
echo "=== Deploying ==="
docker compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.cd.yml \
  up -d --remove-orphans

echo "docker compose exit code: $?"

# ── Quick container check ─────────────────────────────────────
echo ""
echo "=== Container Status ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

echo ""
echo "=== Deploy script complete ==="
