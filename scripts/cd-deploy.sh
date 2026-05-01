#!/bin/bash
# cd-deploy.sh — VPS-side deploy script for the Multica CD pipeline
# Runs directly on VPS via self-hosted GitHub Actions runner.
#
# Usage (called by deploy.yml — not typically run manually):
#   BACKEND_IMAGE=... WEB_IMAGE=... IMAGE_TAG=... \
#     COMMIT_SHA=... bash /docker/multica/scripts/cd-deploy.sh
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

# ── Save previous tag ─────────────────────────────────────────
PREV_IMAGE_TAG=""
if [ -f .env ]; then
  PREV_IMAGE_TAG=$(grep '^DEPLOYED_IMAGE_TAG=' .env 2>/dev/null | cut -d= -f2 || echo "")
fi
echo "$PREV_IMAGE_TAG" > /tmp/.cd-prev-tag
echo "Previous tag: '${PREV_IMAGE_TAG:-none}'"

# ── Pull images if not available locally ──────────────────────
# Self-hosted runner builds locally, so images should already exist.
# Pull is only needed for rollbacks to older tags.
echo ""
echo "=== Checking images ==="
for img in "${BACKEND_IMAGE}:${IMAGE_TAG}" "${WEB_IMAGE}:${IMAGE_TAG}"; do
  if docker image inspect "$img" > /dev/null 2>&1; then
    echo "✅ $img (local)"
  else
    echo "🔄 Pulling $img ..."
    docker pull "$img" | tail -1
  fi
done

# ── Write version info to .env ────────────────────────────────
echo ""
echo "=== Updating .env ==="

update_env_var() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

update_env_var "DEPLOYED_IMAGE_TAG" "$IMAGE_TAG"
update_env_var "DEPLOYED_COMMIT_HASH" "$COMMIT_SHA"
update_env_var "DEPLOYED_COMMIT_MSG" "$COMMIT_MSG"
update_env_var "DEPLOYED_AT" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

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
