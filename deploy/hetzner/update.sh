#!/usr/bin/env bash
set -euo pipefail

ROOT="${AI_STOICA_ROOT:-/opt/ai-stoica}"
DEPLOY="$ROOT/deploy/hetzner"

cd "$ROOT"

# The checkout can belong to a deploy user whose SSH config holds the GitHub deploy key (on ai-stoica-prod: user
# "aistoica", remote "github-ai-stoica:..."). Under sudo, git runs as that user: root has neither the key nor the
# host alias, and git refuses a repository owned by someone else ("dubious ownership").
OWNER="$(stat -c %U "$ROOT")"
repo_git() {
  if [ "$(id -u)" = 0 ] && [ "$OWNER" != root ]; then runuser -u "$OWNER" -- git "$@"; else git "$@"; fi
}

if [[ -n "$(repo_git status --porcelain)" ]]; then
  echo "STOP: repository has local changes. Run 'git status --short' and review them first."
  exit 2
fi

echo "==> Updating AI Stoica from GitHub"
repo_git pull --ff-only origin main

cd "$DEPLOY"

echo "==> Rebuilding API"
docker compose up -d --build api

# Web version (profile "web", e.g. COMPOSE_PROFILES=edge,web in .env): rebuilt from the same code.
if docker compose config --services | grep -qx web; then
  # The site's "Actualizează site-ul" button (Owner) and the hourly check for a new version: installed or refreshed
  # here, before the web container starts, so its shared folder already belongs to the container's user.
  if [ "$(id -u)" = 0 ] && command -v systemctl >/dev/null 2>&1 && [ -f "$DEPLOY/install-updater.sh" ]; then
    bash "$DEPLOY/install-updater.sh" --quiet || echo "Atenție: butonul de actualizare din aplicație nu a putut fi instalat (vezi install-updater.sh)."
  fi
  echo "==> Rebuilding web interface"
  docker compose up -d --build web
fi

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
