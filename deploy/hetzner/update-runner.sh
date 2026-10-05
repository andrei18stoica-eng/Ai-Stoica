#!/usr/bin/env bash
# Runs on the server (started by systemd), never inside a container. The site's "Actualizează site-ul" button (Owner
# only) just drops a request file in $DIR; this script runs the fixed update.sh from the checkout and writes the result
# where the site can read it. "check" (hourly timer) looks for a newer version on GitHub and, when the Owner turned on
# automatic updates (file $DIR/auto), installs it.
set -uo pipefail

ROOT="${AI_STOICA_ROOT:-/opt/ai-stoica}"
DEPLOY="$ROOT/deploy/hetzner"
DIR="${AI_STOICA_UPDATE_DIR:-/var/lib/ai-stoica-update}"
MODE="${1:-run}"
mkdir -p "$DIR"

OWNER="$(stat -c %U "$ROOT")"
repo_git() {
  if [ "$(id -u)" = 0 ] && [ "$OWNER" != root ]; then runuser -u "$OWNER" -- git -C "$ROOT" "$@"; else git -C "$ROOT" "$@"; fi
}
version_at() { repo_git show "$1:package.json" 2>/dev/null | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n 1; }
json_text() {
  if command -v python3 >/dev/null 2>&1; then python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
  else printf '"%s"' "$(tr -d '\000-\037"\\' | tail -c 4000)"; fi
}
# Written next to the old file and renamed, so the site never reads half a file.
write_json() { local tmp="$DIR/.$1.tmp"; cat >"$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$DIR/$1"; }

check() {
  if ! repo_git fetch -q origin main; then
    printf '{"checkedAt":"%s","error":"Nu am putut verifica GitHub (git fetch a eșuat)."}\n' "$(date -Is)" | write_json available.json
    return 1
  fi
  local cur rem behind
  cur="$(repo_git rev-parse HEAD)"; rem="$(repo_git rev-parse origin/main)"; behind="$(repo_git rev-list --count HEAD..origin/main)"
  printf '{"checkedAt":"%s","current":{"commit":"%s","version":"%s"},"latest":{"commit":"%s","version":"%s"},"behind":%s}\n' \
    "$(date -Is)" "$cur" "$(version_at HEAD)" "$rem" "$(version_at origin/main)" "${behind:-0}" | write_json available.json
  [ "${behind:-0}" -gt 0 ]
}

run() {
  # One update at a time, whoever asked (the button or the timer).
  exec 9>"$DIR/.lock"
  # The update already running covers this request too; the request is removed so systemd does not start again.
  if ! flock -n 9; then rm -f "$DIR/request"; echo "O actualizare rulează deja."; return 0; fi
  rm -f "$DIR/request"
  printf '{"state":"running","startedAt":"%s","version":"%s"}\n' "$(date -Is)" "$(version_at HEAD)" | write_json status.json
  local log="$DIR/update.log" state=ok
  bash "$DEPLOY/update.sh" >"$log" 2>&1 || state=error
  chmod 644 "$log" 2>/dev/null || true
  printf '{"state":"%s","finishedAt":"%s","version":"%s","commit":"%s","log":%s}\n' \
    "$state" "$(date -Is)" "$(version_at HEAD)" "$(repo_git rev-parse HEAD)" "$(tail -n 40 "$log" | json_text)" | write_json status.json
  check >/dev/null 2>&1 || true
  [ "$state" = ok ]
}

case "$MODE" in
  check) if check && [ -f "$DIR/auto" ]; then run; fi ;;
  run) run ;;
  *) echo "Folosire: $0 [run|check]"; exit 2 ;;
esac
