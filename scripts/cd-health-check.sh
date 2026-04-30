#!/bin/bash
# cd-health-check.sh — Verify Multica deployment is healthy
# Called from GitHub Actions after deploy. Returns non-zero on failure.
#
# Usage:
#   ssh root@vps bash /docker/multica/scripts/cd-health-check.sh
#
set -euo pipefail

errors=0
pass()  { echo "✅ $1"; }
fail()  { echo "❌ $1"; errors=$((errors + 1)); }

echo ""
echo "========================================"
echo "  Health Check"
echo "  Time: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "========================================"

# ── Container status ──────────────────────────────────────────
echo ""
echo "--- Container Status ---"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || fail "docker ps failed"

for svc in postgres backend frontend caddy; do
  container="multica-${svc}-1"
  status=$(docker inspect "$container" --format '{{.State.Status}}' 2>/dev/null || echo "missing")
  if [ "$status" = "running" ]; then
    pass "${svc} container is running"
  else
    fail "${svc} container status: ${status}"
  fi
done

# ── API Health (via internal docker network) ──────────────────
echo ""
echo "--- API Health ---"
API_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 http://localhost:8080/api/config 2>/dev/null || echo "000")
if [ "$API_CODE" = "200" ]; then
  pass "API (internal): HTTP 200"
else
  fail "API (internal): HTTP ${API_CODE} (expected 200)"
fi

# ── Frontend Health (via internal docker network) ─────────────
echo ""
echo "--- Frontend Health ---"
FE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 http://localhost:3000/ 2>/dev/null || echo "000")
if [ "$FE_CODE" = "200" ]; then
  pass "Frontend (internal): HTTP 200"
else
  fail "Frontend (internal): HTTP ${FE_CODE} (expected 200)"
fi

# ── External Checks (via recurse.pro) ─────────────────────────
echo ""
echo "--- External Checks ---"
EXT_API=$(curl -s -o /dev/null -w "%{http_code}" -m 15 https://recurse.pro/api/config 2>/dev/null || echo "000")
if [ "$EXT_API" = "200" ]; then
  pass "API (external via recurse.pro): HTTP 200"
else
  fail "API (external): HTTP ${EXT_API}"
fi

EXT_FE=$(curl -s -o /dev/null -w "%{http_code}" -m 15 https://recurse.pro/ 2>/dev/null || echo "000")
if [ "$EXT_FE" = "200" ]; then
  pass "Frontend (external via recurse.pro): HTTP 200"
else
  fail "Frontend (external): HTTP ${EXT_FE}"
fi

# ── WebSocket Check ───────────────────────────────────────────
echo ""
echo "--- WebSocket Check ---"
WS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://recurse.pro/ws?workspace_slug=PLACEHOLDER" 2>/dev/null || echo "000")
case "$WS_CODE" in
  404) pass "WebSocket: HTTP 404 (handler reached)" ;;
  400) pass "WebSocket: HTTP 400 (handler reached)" ;;
  *)   fail "WebSocket: HTTP ${WS_CODE}" ;;
esac

# ── Deployed Version ──────────────────────────────────────────
echo ""
echo "--- Deployed Version ---"
if [ -f .env ]; then
  grep 'DEPLOYED_' .env 2>/dev/null || echo "(no version info in .env)"
fi

DEPLOYED_TAG=$(docker inspect multica-backend-1 --format '{{index .Config.Image}}' 2>/dev/null || echo "unknown")
echo "Image: $DEPLOYED_TAG"

# ── DB Health ─────────────────────────────────────────────────
echo ""
echo "--- Database Health ---"
DB_OK=$(docker exec multica-postgres-1 pg_isready -U multica 2>/dev/null || echo "unreachable")
if echo "$DB_OK" | grep -q "accepting connections"; then
  pass "Postgres: accepting connections"
else
  fail "Postgres: ${DB_OK}"
fi

# ── Result ────────────────────────────────────────────────────
echo ""
echo "========================================"
if [ "$errors" -eq 0 ]; then
  echo "  ✅ All health checks passed"
  echo "========================================"
  exit 0
else
  echo "  ❌ ${errors} health check(s) failed"
  echo "========================================"
  exit 1
fi
