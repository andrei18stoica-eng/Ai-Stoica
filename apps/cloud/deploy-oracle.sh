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

echo "Pornesc/actualizez AI Stoica Cloud..."
docker compose pull
docker compose up -d --build --remove-orphans

echo
docker compose ps

echo
echo "Verific HTTPS: https://$AI_STOICA_DOMAIN/health"
curl --fail --show-error --silent   --retry 20 --retry-delay 3 --retry-connrefused   "https://$AI_STOICA_DOMAIN/health"
echo
echo "AI Stoica Cloud este online."
