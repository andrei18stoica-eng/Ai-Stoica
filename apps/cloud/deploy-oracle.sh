#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Lipsește apps/cloud/.env. Copiază .env.example în .env și completează valorile."
  exit 1
fi

set -a
. ./.env
set +a

if [ -z "${AI_STOICA_DOMAIN:-}" ] || [ "$AI_STOICA_DOMAIN" = "ai.example.com" ]; then
  echo "Setează AI_STOICA_DOMAIN la domeniul real care indică spre IP-ul Oracle."
  exit 1
fi

if [ -z "${OMNIROUTE_WS_BRIDGE_SECRET:-}" ] || [ "$OMNIROUTE_WS_BRIDGE_SECRET" = "change-me-to-a-long-random-secret" ]; then
  echo "Setează un OMNIROUTE_WS_BRIDGE_SECRET lung și aleator."
  exit 1
fi

if [ -z "${AI_STOICA_OWNER_EMAIL:-}" ]; then
  echo "Atenție: AI_STOICA_OWNER_EMAIL nu este setat; niciun cont nu va fi Owner pe acest server."
fi

case "${AI_STOICA_DEFAULT_MODEL:-}" in
  [Aa][Ii]" "[Pp]rincipal|[Aa][Ii]" "[Ss]toica)
    echo "AI_STOICA_DEFAULT_MODEL nu poate fi „${AI_STOICA_DEFAULT_MODEL}” (selectarea automată este dezactivată). Lasă-l gol sau pune un id exact din OmniRoute."
    exit 1
    ;;
esac

echo "Pornesc/actualizez AI Stoica Cloud..."
docker compose pull --ignore-buildable 2>/dev/null || docker compose pull redis omniroute caddy data-permissions
docker compose up -d --build --remove-orphans

echo
docker compose ps

echo
echo "Verific HTTPS: https://$AI_STOICA_DOMAIN/health"
curl --fail --show-error --silent   --retry 20 --retry-delay 3 --retry-connrefused   "https://$AI_STOICA_DOMAIN/health"
echo
echo "AI Stoica Cloud este online."
