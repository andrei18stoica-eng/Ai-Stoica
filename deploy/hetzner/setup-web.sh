#!/usr/bin/env bash
# AI Stoica: one-time setup of the site (aistoica.ro), the free phone app (PWA) and OmniRoute on this server.
# It asks step by step, keeps every value already in .env and backs .env up first, so it is safe to run again.
#   sudo bash /opt/ai-stoica/deploy/hetzner/setup-web.sh
set -euo pipefail

DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DEPLOY/.env"
MEMINFO="${AI_STOICA_MEMINFO:-/proc/meminfo}"
OMNI_VERSION_DEFAULT="3.8.51"
# The keys the web service reads (same names as apps/cloud/server.cjs and docker-compose.yml).
AI_KEYS=(CEREBRAS_API_KEY GROQ_API_KEY GEMINI_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY MISTRAL_API_KEY
  NVIDIA_API_KEY COHERE_API_KEY HF_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN AI_STOICA_GITHUB_TOKEN
  POLLINATIONS_API_KEY FAL_API_KEY REPLICATE_API_TOKEN TOGETHER_API_KEY STABILITY_API_KEY)
# What the Windows app copies with Settings → API-uri AI → "Copiază cheile pentru server".
PASTE_KEYS=(OMNIROUTE_API_KEY "${AI_KEYS[@]}")

step() { printf '\n==> %s\n' "$*"; }
ok() { printf '    OK: %s\n' "$*"; }
warn() { printf '    ATENȚIE: %s\n' "$*"; }
die() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

# Answers come from standard input; Enter (or the end of input) takes the value in brackets.
ask() {
  printf '%s%s: ' "$1" "${2:+ [$2]}"
  IFS= read -r REPLY || REPLY=""
  REPLY="${REPLY%$'\r'}"
  [ -n "$REPLY" ] || REPLY="${2:-}"
}
ask_secret() {
  printf '%s: ' "$1"
  IFS= read -rs REPLY || REPLY=""
  printf '\n'
  REPLY="${REPLY%$'\r'}"
}
yes_no() {
  local hint="D/n"; [ "$2" = n ] && hint="d/N"
  ask "$1 ($hint)" ""
  case "${REPLY,,}" in d|da|y|yes) return 0 ;; n|nu|no) return 1 ;; *) [ "$2" = d ] ;; esac
}

# .env is read by Docker Compose literally: a value cannot hold spaces, quotes, "$", "#" or backslashes.
valid_value() { [[ -n "$1" && "$1" != *[[:space:]\$\#\"\'\`\\]* ]]; }
mask() { printf '%s… (%d caractere)' "${1:0:4}" "${#1}"; }
known_key() { local k; for k in "${PASTE_KEYS[@]}"; do [ "$k" = "$1" ] && return 0; done; return 1; }

env_get() {
  [ -f "$ENV_FILE" ] || return 0
  awk -v k="$1" -v q="'" '
    index($0, k "=") == 1 { v = substr($0, length(k) + 2) }
    END {
      sub(/\r$/, "", v); f = substr(v, 1, 1)
      if (length(v) > 1 && (f == "\"" || f == q) && substr(v, length(v)) == f) v = substr(v, 2, length(v) - 2)
      print v
    }' "$ENV_FILE"
}
# Replaces "NAME=…" (or a commented "# NAME=…") in place, drops later duplicates, appends when missing.
# The value goes through the environment, never through sed, so "/", "&" or "+" in keys stay as they are.
env_set() {
  local tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  NAME="$1" VALUE="$2" awk '
    BEGIN { k = ENVIRON["NAME"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, k "=") == 1 || $0 ~ ("^#[ ]*" k "=") {
      if (!done) { print k "=" v; done = 1; next }
      if ($0 ~ /^#/) print
      next
    }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

wait_for() {
  local i
  for ((i = 0; i < $2; i += 2)); do
    curl -fsS -o /dev/null --max-time 5 "$1" 2>/dev/null && return 0
    sleep 2
  done
  return 1
}
port_busy() { command -v ss >/dev/null 2>&1 && ss -ltnH "( sport = :$1 )" 2>/dev/null | grep -q .; }

cd "$DEPLOY"
command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || die "Docker Compose lipsește. Instalează Docker după deploy/hetzner/README.md."
docker info >/dev/null 2>&1 || die "Nu pot folosi Docker. Rulează cu sudo: sudo bash $DEPLOY/setup-web.sh"

echo "AI Stoica — site-ul, aplicația de telefon și OmniRoute pe acest server."
echo "Răspunde la întrebări; Enter alege valoarea din paranteze. Ce e deja salvat în .env rămâne."

step "1/8 Setările serverului (.env)"
new_env=0
if [ ! -f "$ENV_FILE" ]; then
  [ -f .env.example ] || die ".env.example lipsește din $DEPLOY."
  cp .env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  env_set POSTGRES_PASSWORD "$(openssl rand -hex 32)"
  new_env=1
  ok "am creat .env și o parolă aleatoare pentru baza de date"
else
  backup="$ENV_FILE.backup-$(date +%Y%m%d-%H%M%S)"
  cp -p "$ENV_FILE" "$backup"
  chmod 600 "$backup"
  ok "copie de siguranță: $backup"
  [ "$(env_get POSTGRES_PASSWORD)" != "CHANGE_ME_RANDOM" ] || warn "POSTGRES_PASSWORD are încă valoarea din exemplu (n-o schimb: baza de date o folosește deja)."
fi
chmod 600 "$ENV_FILE"
owner="$(env_get OWNER_EMAIL)"
if [ -z "$owner" ] || [ "$owner" = "owner@exemplu.ro" ]; then
  while :; do
    ask "E-mailul contului Owner" ""
    [[ "$REPLY" == ?*@?*.?* ]] && valid_value "$REPLY" && break
    warn "scrie un e-mail valid"
  done
  owner="${REPLY,,}"
  env_set OWNER_EMAIL "$owner"
fi
ok "Owner: $owner"
if [ "$new_env" = 1 ]; then
  while :; do
    ask_secret "Parola contului Owner (minimum 8 caractere, fără spații, ghilimele, \$ sau #)"
    [ "${#REPLY}" -ge 8 ] && valid_value "$REPLY" && break
    warn "parola nu este acceptată, încearcă din nou"
  done
  env_set OWNER_INITIAL_PASSWORD "$REPLY"
fi
if [ -z "$(env_get AI_STOICA_DOMAIN)" ]; then
  ask "Adresa API-ului" "api.aistoica.ro"
  valid_value "$REPLY" || die "adresă invalidă: $REPLY"
  env_set AI_STOICA_DOMAIN "${REPLY,,}"
fi
api_domain="$(env_get AI_STOICA_DOMAIN)"

step "2/8 Memorie pentru construirea site-ului"
mem="$(awk '/^MemTotal:/ { print int($2 / 1024) }' "$MEMINFO" 2>/dev/null || true)"
swap="$(awk '/^SwapTotal:/ { print int($2 / 1024) }' "$MEMINFO" 2>/dev/null || true)"
mem="${mem:-0}"; swap="${swap:-0}"
if [ "$mem" -gt 0 ] && [ $((mem + swap)) -lt 3500 ]; then
  warn "serverul are $mem MB RAM și $swap MB swap; construirea site-ului poate rămâne fără memorie."
  if [ "$(id -u)" = 0 ] && [ ! -e /swapfile ] && yes_no "Creez un fișier swap de 2 GB (memorie de rezervă pe disc)?" d; then
    if fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; then
      grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      ok "swap de 2 GB activ"
    else
      warn "nu am putut crea fișierul swap"
    fi
  fi
else
  ok "$mem MB RAM, $swap MB swap"
fi

step "3/8 Adresa site-ului și DNS"
domain="$(env_get AI_STOICA_WEB_DOMAIN)"
ask "Adresa site-ului" "${domain:-aistoica.ro}"
domain="${REPLY,,}"
valid_value "$domain" || die "adresă invalidă: $domain"
env_set AI_STOICA_WEB_DOMAIN "$domain"
server_ips=" $(hostname -I 2>/dev/null || true) "
public_ip=""
for ip in $server_ips; do
  case "$ip" in 10.*|127.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|*:*) ;; *) public_ip="${public_ip:-$ip}" ;; esac
done
dns_ips="$(getent ahostsv4 "$domain" 2>/dev/null | awk '{ print $1 }' | sort -u | tr '\n' ' ' || true)"
dns_ok=0
for ip in $dns_ips; do [[ "$server_ips" == *" $ip "* ]] && dns_ok=1; done
if [ "$dns_ok" = 1 ]; then
  ok "$domain duce la acest server (${dns_ips% })"
elif [ -z "${dns_ips// /}" ]; then
  warn "$domain nu are încă înregistrare DNS. La firma domeniului adaugă: tip A, nume @, valoare ${public_ip:-IP-ul serverului}."
  echo "    Continui: site-ul primește HTTPS singur după ce DNS-ul ajunge la server."
else
  warn "$domain duce la ${dns_ips% }, nu la acest server (${public_ip:-?}). Schimbă înregistrarea A la firma domeniului."
fi

step "4/8 Serviciile pornite"
profiles="$(env_get COMPOSE_PROFILES)"
for p in edge web; do [[ ",$profiles," == *",$p,"* ]] || profiles="${profiles:+$profiles,}$p"; done
env_set COMPOSE_PROFILES "$profiles"
ok "COMPOSE_PROFILES=$profiles (edge = HTTPS prin Caddy, web = site-ul și OmniRoute)"

step "5/8 OmniRoute pe server"
omni_exists="$(docker compose ps -a -q omniroute 2>/dev/null || true)"
version="$(env_get OMNIROUTE_VERSION)"
if [ -n "$version" ] && [ "$version" != latest ]; then
  ok "OMNIROUTE_VERSION=$version"
elif [ -n "$omni_exists" ]; then
  ok "OmniRoute există deja pe server; păstrez OMNIROUTE_VERSION=${version:-latest}"
else
  while :; do
    ask "Versiunea OmniRoute (aceeași ca pe PC; o vezi în panoul OmniRoute de pe PC)" "$OMNI_VERSION_DEFAULT"
    [[ "$REPLY" =~ ^[0-9A-Za-z._-]+$ ]] && break
    warn "versiune invalidă"
  done
  env_set OMNIROUTE_VERSION "$REPLY"
  ok "OMNIROUTE_VERSION=$REPLY"
fi
if [ -z "$(env_get OMNIROUTE_WS_BRIDGE_SECRET)" ]; then
  env_set OMNIROUTE_WS_BRIDGE_SECRET "$(openssl rand -hex 32)"
  ok "am generat OMNIROUTE_WS_BRIDGE_SECRET"
fi
omni_pass="$(env_get OMNIROUTE_INITIAL_PASSWORD)"
if [ -z "$omni_pass" ]; then
  omni_pass="$(openssl rand -hex 8)"
  env_set OMNIROUTE_INITIAL_PASSWORD "$omni_pass"
fi
if [ -z "$omni_exists" ]; then
  ok "parola panoului OmniRoute de pe server: $omni_pass (după importul bazei de pe PC devine parola de pe PC)"
fi

step "6/8 Cheile AI (aceleași ca în aplicația Windows)"
missing=()
for k in "${AI_KEYS[@]}"; do [ -n "$(env_get "$k")" ] || missing+=("$k"); done
echo "    Salvate: $((${#AI_KEYS[@]} - ${#missing[@]})) din ${#AI_KEYS[@]}."
if [ "${#missing[@]}" -gt 0 ]; then
  if yes_no "Lipești cheile copiate din aplicația Windows (Setări → API-uri AI → „Copiază cheile pentru server”)?" d; then
    echo "    Lipește textul (click dreapta; cheile nu apar pe ecran), apoi apasă încă o dată Enter."
    added=0
    while IFS= read -rs line; do
      line="${line%$'\r'}"
      [ -n "$line" ] || break
      [[ "$line" == \#* ]] && continue
      name="${line%%=*}"; value="${line#*=}"
      if [[ "$line" != *=* ]] || ! known_key "$name"; then warn "sar peste un rând necunoscut: ${name:0:40}"; continue; fi
      if ! valid_value "$value"; then warn "$name are caractere pe care .env nu le acceptă; sar peste"; continue; fi
      env_set "$name" "$value"
      added=$((added + 1))
      ok "$name $(mask "$value")"
    done
    ok "$added chei salvate"
  elif yes_no "Le scrii una câte una?" n; then
    for k in "${missing[@]}"; do
      ask_secret "$k (Enter = sar peste)"
      [ -n "$REPLY" ] || continue
      if valid_value "$REPLY"; then env_set "$k" "$REPLY"; ok "$k $(mask "$REPLY")"; else warn "$k are caractere pe care .env nu le acceptă; sar peste"; fi
    done
  fi
fi

step "7/8 Pornesc OmniRoute"
docker compose up -d omniroute || die "Nu am putut porni OmniRoute (eroarea e mai sus)."
if ! wait_for http://127.0.0.1:20128/api/health 120; then
  docker compose logs --tail=60 omniroute || true
  die "OmniRoute nu a pornit în 2 minute (jurnalul e mai sus)."
fi
ok "OmniRoute răspunde pe 127.0.0.1:20128"
echo "    Ca să ai aceleași combinații („Ai principal”) și furnizori ca pe PC, mută baza OmniRoute de pe PC:"
echo "    a) pe PC, în panoul OmniRoute: Settings → System & Storage → Export Database (fișier .sqlite);"
echo "    b) pe PC, într-o fereastră PowerShell nouă, pe care o lași deschisă:"
echo "         ssh -L 20129:127.0.0.1:20128 root@${public_ip:-IP_SERVER}"
echo "    c) în browser: http://127.0.0.1:20129 → Settings → System & Storage → Import Database → fișierul de la a)."
ask "Apasă Enter după import (sau dacă îl faci mai târziu)" ""
key="$(env_get OMNIROUTE_API_KEY)"
for attempt in 1 2 3; do
  if [ -z "$key" ]; then
    ask_secret "Cheia API OmniRoute (panoul OmniRoute → API Manager; Enter = mai târziu)"
    key="$REPLY"
    [ -n "$key" ] || break
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Authorization: Bearer $key" http://127.0.0.1:20128/v1/models 2>/dev/null || true)"
  if [ "$code" = 200 ] && valid_value "$key"; then
    env_set OMNIROUTE_API_KEY "$key"
    ok "cheia OmniRoute merge ($(mask "$key"))"
    break
  fi
  warn "OmniRoute refuză cheia (HTTP ${code:-?}). Verifică în API Manager că există și e activă."
  key=""
done
[ -n "$key" ] || warn "fără cheie OmniRoute site-ul folosește doar cheile AI directe; rulează din nou scriptul după ce o ai."

step "8/8 Construiesc și pornesc site-ul (5–10 minute prima dată)"
docker compose up -d --build web || die "Construirea site-ului a eșuat (eroarea e mai sus)."
if ! wait_for http://127.0.0.1:8788/health 240; then
  docker compose logs --tail=80 web || true
  die "Site-ul nu a pornit (jurnalul e mai sus)."
fi
health="$(curl -fsS --max-time 10 http://127.0.0.1:8788/health 2>/dev/null || true)"
case "$health" in
  *'"omni":true'*) ok "site-ul rulează și vede OmniRoute" ;;
  *'"omniNeedsKey":true'*) warn "site-ul rulează, dar OmniRoute cere cheia API (OMNIROUTE_API_KEY)" ;;
  *) warn "site-ul rulează, dar nu vede OmniRoute" ;;
esac
if [ -z "$(docker compose ps -q caddy 2>/dev/null || true)" ] && port_busy 443; then
  warn "portul 443 e folosit de alt program, așa că nu pornesc Caddy (HTTPS). Programul:"
  ss -ltnpH "( sport = :443 )" 2>/dev/null || true
else
  docker compose up -d caddy || die "Caddy (HTTPS) nu a pornit (eroarea e mai sus)."
  ok "Caddy pornit: HTTPS pentru $api_domain și $domain"
  if [ "$dns_ok" = 1 ]; then
    if wait_for "https://$domain/health" 90; then ok "https://$domain merge"
    else warn "https://$domain nu răspunde încă; certificatul HTTPS poate dura câteva minute (docker compose logs caddy)."; fi
  fi
fi

echo
echo "GATA. Ce urmează:"
echo "  1. Deschide https://$domain și intră cu contul Owner ($owner)."
echo "  2. Telefon: iPhone → Safari → Distribuie → „Adaugă pe ecranul principal”; Android → Chrome → „Instalează aplicația”."
echo "  3. Windows: AI Stoica → Setări → AI & OmniRoute → Adresa serviciului AI Stoica: https://$domain"
echo "  4. După ce totul merge: o cheie OmniRoute nouă în API Manager, apoi rulează din nou acest script."
echo "  Actualizări: sudo bash $(cd "$DEPLOY/../.." && pwd)/deploy/hetzner/update.sh"
