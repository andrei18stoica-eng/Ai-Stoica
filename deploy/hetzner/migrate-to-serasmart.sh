#!/usr/bin/env bash
# One-time move of the Hetzner server from the old technical names (AI Stoica) to Serasmart (0.7.21). Run as root,
# after update.sh has brought the 0.7.21 code:
#
#   sudo bash /opt/ai-stoica/deploy/hetzner/migrate-to-serasmart.sh            # shows what it would do, changes nothing
#   sudo bash /opt/ai-stoica/deploy/hetzner/migrate-to-serasmart.sh --apply    # does it
#
# What it does, in order (each step is skipped when already done, so it can run again safely):
#   1. a full backup of the database (pg_dumpall) in /root/serasmart-backup-<date>.sql;
#   2. renames the database and its user aistoica -> serasmart (the password is set again from .env);
#   3. renames AI_STOICA_* -> SERASMART_* and POSTGRES_DB / POSTGRES_USER in .env (copy kept as .env.before-serasmart);
#   4. stops the containers (the data volumes stay), moves /opt/ai-stoica -> /opt/serasmart and /etc/ai-stoica ->
#      /etc/serasmart, leaving links at the old paths;
#   5. renames the Linux user aistoica -> serasmart (home folder, group, SSH alias of the deploy key, git remote);
#   6. renames the sshd hardening file and the host name ai-stoica-prod -> serasmart-prod;
#   7. starts everything again (the MCP service too, when it is set up), reinstalls the update button and checks /health.
set -euo pipefail

APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
OLD_ROOT=/opt/ai-stoica NEW_ROOT=/opt/serasmart
OLD_ETC=/etc/ai-stoica NEW_ETC=/etc/serasmart
OLD_USER=aistoica NEW_USER=serasmart
OLD_NAME=aistoica NEW_NAME=serasmart
OLD_HOST=ai-stoica-prod NEW_HOST=serasmart-prod

say() { echo "==> $*"; }
run() { echo "  + $*"; if [ "$APPLY" = 1 ]; then "$@"; fi; }
[ "$(id -u)" = 0 ] || { echo "Rulează cu sudo: sudo bash $0 [--apply]"; exit 1; }
[ "$APPLY" = 1 ] || echo "Doar arăt pașii (nimic nu se schimbă). Rulează din nou cu --apply ca să îi fac."

# Where the checkout is now.
if [ -d "$NEW_ROOT/deploy/hetzner" ] && [ ! -L "$NEW_ROOT" ]; then ROOT="$NEW_ROOT"; else ROOT="$OLD_ROOT"; fi
DEPLOY="$ROOT/deploy/hetzner"; ENV_FILE="$DEPLOY/.env"
[ -f "$ENV_FILE" ] || { echo "Nu găsesc $ENV_FILE."; exit 1; }
env_get() { awk -v k="$1" 'index($0, k "=") == 1 { v = substr($0, length(k) + 2) } END { sub(/\r$/, "", v); print v }' "$ENV_FILE"; }
DB="$(env_get POSTGRES_DB)"; DBUSER="$(env_get POSTGRES_USER)"; DBPASS="$(env_get POSTGRES_PASSWORD)"
compose() { (cd "$DEPLOY" && docker compose "$@"); }
MCP_ARGS=(); [ -f "$DEPLOY/claude-mcp.override.yml" ] && { [ -f "$OLD_ETC/mcp.env" ] || [ -f "$NEW_ETC/mcp.env" ]; } && MCP_ARGS=(-f docker-compose.yml -f claude-mcp.override.yml)

say "1. Copie de siguranță a bazei de date"
BACKUP="/root/serasmart-backup-$(date +%Y%m%d-%H%M%S).sql"
echo "  + docker compose exec -T postgres pg_dumpall -U $DBUSER > $BACKUP"
if [ "$APPLY" = 1 ]; then
  compose exec -T postgres pg_dumpall -U "$DBUSER" > "$BACKUP"
  chmod 600 "$BACKUP"
  [ -s "$BACKUP" ] || { echo "STOP: copia de siguranță e goală; nu continui."; exit 1; }
  echo "  copia: $BACKUP ($(du -h "$BACKUP" | cut -f1))"
fi

say "2. Baza de date și utilizatorul ei: $OLD_NAME -> $NEW_NAME"
if [ "$DB" = "$OLD_NAME" ] || [ "$DBUSER" = "$OLD_NAME" ]; then
  # Nothing may stay connected to the database while it is renamed.
  run compose stop api web
  psql_su() { compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$1" -d postgres -c "$2"; }
  # A role cannot rename itself: a temporary superuser does it, then leaves.
  run psql_su "$DBUSER" "CREATE ROLE serasmart_migrate SUPERUSER LOGIN;"
  [ "$DB" = "$OLD_NAME" ] && run psql_su serasmart_migrate "ALTER DATABASE $OLD_NAME RENAME TO $NEW_NAME;"
  if [ "$DBUSER" = "$OLD_NAME" ]; then
    run psql_su serasmart_migrate "ALTER ROLE $OLD_NAME RENAME TO $NEW_NAME;"
    echo "  + ALTER ROLE $NEW_NAME PASSWORD (din .env)"
    if [ "$APPLY" = 1 ]; then printf "ALTER ROLE %s PASSWORD '%s';\n" "$NEW_NAME" "${DBPASS//\'/\'\'}" | compose exec -T postgres psql -v ON_ERROR_STOP=1 -U serasmart_migrate -d postgres >/dev/null; fi
  fi
  if [ "$DBUSER" = "$OLD_NAME" ]; then FINAL_USER="$NEW_NAME"; else FINAL_USER="$DBUSER"; fi
  run psql_su "$FINAL_USER" "DROP ROLE serasmart_migrate;"
else
  echo "  deja făcut ($DB / $DBUSER)"
fi

say "3. Variabilele din .env"
if grep -qE "^AI_STOICA_|^POSTGRES_(DB|USER)=$OLD_NAME$" "$ENV_FILE"; then
  run cp -p "$ENV_FILE" "$ENV_FILE.before-serasmart"
  run sed -i -E "s/^AI_STOICA_/SERASMART_/; s/^POSTGRES_DB=$OLD_NAME$/POSTGRES_DB=$NEW_NAME/; s/^POSTGRES_USER=$OLD_NAME$/POSTGRES_USER=$NEW_NAME/" "$ENV_FILE"
else
  echo "  deja făcut"
fi

say "4. Dosarele: $OLD_ROOT -> $NEW_ROOT, $OLD_ETC -> $NEW_ETC"
run compose "${MCP_ARGS[@]}" down
if [ -d "$OLD_ROOT" ] && [ ! -L "$OLD_ROOT" ] && [ ! -e "$NEW_ROOT" ]; then
  run mv "$OLD_ROOT" "$NEW_ROOT"; run ln -s "$NEW_ROOT" "$OLD_ROOT"
else echo "  $NEW_ROOT: deja făcut"; fi
if [ -d "$OLD_ETC" ] && [ ! -L "$OLD_ETC" ] && [ ! -e "$NEW_ETC" ]; then
  run mv "$OLD_ETC" "$NEW_ETC"; run ln -s "$NEW_ETC" "$OLD_ETC"
else echo "  $NEW_ETC: deja făcut sau nu există"; fi
[ "$APPLY" = 1 ] && { ROOT="$NEW_ROOT"; DEPLOY="$ROOT/deploy/hetzner"; ENV_FILE="$DEPLOY/.env"; }

say "5. Utilizatorul Linux: $OLD_USER -> $NEW_USER"
if id "$OLD_USER" >/dev/null 2>&1 && ! id "$NEW_USER" >/dev/null 2>&1; then
  if pgrep -u "$OLD_USER" >/dev/null 2>&1; then echo "  STOP la pasul 5: utilizatorul $OLD_USER are procese pornite (închide sesiunea lui și rulează din nou)."; [ "$APPLY" = 1 ] && exit 1; fi
  run usermod -l "$NEW_USER" "$OLD_USER"
  getent group "$OLD_USER" >/dev/null && run groupmod -n "$NEW_USER" "$OLD_USER"
  OLD_HOME="$(getent passwd "$OLD_USER" 2>/dev/null | cut -d: -f6)"; [ -n "$OLD_HOME" ] || OLD_HOME="/home/$OLD_USER"
  [ -d "$OLD_HOME" ] && [ ! -e "/home/$NEW_USER" ] && run usermod -d "/home/$NEW_USER" -m "$NEW_USER"
  for f in /etc/sudoers.d/*; do [ -f "$f" ] && grep -q "\b$OLD_USER\b" "$f" && run sed -i "s/\b$OLD_USER\b/$NEW_USER/g" "$f"; done
else echo "  deja făcut sau nu există"; fi
SSH_CFG="/home/$NEW_USER/.ssh/config"
if [ -f "$SSH_CFG" ] && grep -q "github-ai-stoica" "$SSH_CFG"; then
  run sed -i "s/github-ai-stoica/github-serasmart/g" "$SSH_CFG"
fi
if [ -d "$ROOT/.git" ]; then
  GIT_USER="$(stat -c %U "$ROOT")"
  REMOTE="$(runuser -u "$GIT_USER" -- git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
  NEW_REMOTE="$(printf '%s' "$REMOTE" | sed 's/github-ai-stoica/github-serasmart/')"
  # The repository's new name (Serasmart-AI) is used only once GitHub answers to it (after you rename it on GitHub).
  RENAMED="$(printf '%s' "$NEW_REMOTE" | sed 's#/Ai-Stoica\(\.git\)\?$#/Serasmart-AI.git#')"
  if [ "$APPLY" = 1 ] && [ "$RENAMED" != "$NEW_REMOTE" ] && runuser -u "$GIT_USER" -- git ls-remote "$RENAMED" HEAD >/dev/null 2>&1; then NEW_REMOTE="$RENAMED"; fi
  if [ -n "$REMOTE" ] && [ "$REMOTE" != "$NEW_REMOTE" ]; then run runuser -u "$GIT_USER" -- git -C "$ROOT" remote set-url origin "$NEW_REMOTE"; fi
fi

say "6. sshd și numele serverului"
[ -f /etc/ssh/sshd_config.d/99-aistoica-hardening.conf ] && run mv /etc/ssh/sshd_config.d/99-aistoica-hardening.conf /etc/ssh/sshd_config.d/99-serasmart-hardening.conf
if [ "$(hostname)" = "$OLD_HOST" ]; then run hostnamectl set-hostname "$NEW_HOST"; run sed -i "s/\b$OLD_HOST\b/$NEW_HOST/g" /etc/hosts; fi

say "7. Pornesc totul din nou"
run compose up -d --remove-orphans
if [ "${#MCP_ARGS[@]}" -gt 0 ]; then run compose "${MCP_ARGS[@]}" up -d --build --remove-orphans; fi
run bash "$DEPLOY/install-updater.sh" --quiet || echo "  Atenție: butonul de actualizare nu a putut fi reinstalat (rulează install-updater.sh)."
if [ "$APPLY" = 1 ]; then
  for i in $(seq 1 30); do
    if health="$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null)"; then echo "$health"; echo "Gata: serverul folosește acum numele Serasmart. Copia bazei de date: $BACKUP"; exit 0; fi
    sleep 2
  done
  echo "ATENȚIE: API-ul nu răspunde. Vezi: cd $DEPLOY && docker compose logs --tail=80 api. Copia bazei de date: $BACKUP"
  exit 1
fi
echo "Asta e tot. Când ești gata: sudo bash $0 --apply"
