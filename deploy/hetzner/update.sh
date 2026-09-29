#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/ai-stoica"
DEPLOY="$ROOT/deploy/hetzner"

cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "STOP: repository has local changes. Run 'git status --short' and review them first."
  exit 2
fi

echo "==> Updating AI Stoica from GitHub"
git pull --ff-only origin main

cd "$DEPLOY"

echo "==> Rebuilding API"
docker compose up -d --build api

echo "==> Waiting for API health"
for i in {1..30}; do
  if curl -fsS http://127.0.0.1:8787/health >/tmp/aistoica-health.json 2>/dev/null; then
    cat /tmp/aistoica-health.json
    echo
    echo "AI Stoica API is healthy."
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "ERROR: API did not become healthy in time."
docker compose ps
docker compose logs --tail=120 api
exit 1
