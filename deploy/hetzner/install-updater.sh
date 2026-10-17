#!/usr/bin/env bash
# Installs (or refreshes) the server side of the site's "Actualizează site-ul" button, once, as root:
#   - the folder shared with the web container (requests in, status out), owned by the container's user;
#   - serasmart-update.path + .service: when the site drops a request, run update-runner.sh (update.sh);
#   - serasmart-update-check.timer: every hour, look for a newer version (and install it if automatic updates are on).
# update.sh runs this at the end of every update, so after the first time nothing needs to be done by hand.
set -euo pipefail

# The checkout this script lives in (/opt/serasmart, or /opt/ai-stoica on a server not yet moved); SERASMART_ROOT
# (or the older AI_STOICA_ROOT) overrides it.
ROOT="${SERASMART_ROOT:-${AI_STOICA_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}}"
# The real folder, not the /opt/ai-stoica link left by the move: its owner (stat) is the user git runs as, and a link
# belongs to root, which has no deploy key ("git fetch a eșuat" on 2026-10-17).
ROOT="$(cd "$ROOT" 2>/dev/null && pwd -P || printf "%s" "$ROOT")"
DIR="${SERASMART_UPDATE_DIR:-${AI_STOICA_UPDATE_DIR:-/var/lib/serasmart-update}}"
UNITS="${SERASMART_SYSTEMD_DIR:-${AI_STOICA_SYSTEMD_DIR:-/etc/systemd/system}}"
WEB_UID="${SERASMART_WEB_UID:-${AI_STOICA_WEB_UID:-1000}}"   # user "node" in the apps/cloud image
QUIET=0; [ "${1:-}" = "--quiet" ] && QUIET=1
say() { [ "$QUIET" = 1 ] || echo "$@"; }

if [ "$(id -u)" != 0 ]; then echo "Rulează cu sudo: sudo bash $0"; exit 1; fi
if ! command -v systemctl >/dev/null 2>&1; then echo "systemd lipsește: butonul de actualizare nu poate fi instalat aici."; exit 1; fi

# 0.7.21: the shared folder and the services had the old name (ai-stoica-update). The folder moves to the new name
# (the old path stays as a link) and the old path/timer units are switched off and removed; an update already running
# from the old service finishes normally.
LEGACY_DIR="/var/lib/ai-stoica-update"
if [ "$DIR" = "/var/lib/serasmart-update" ] && [ -d "$LEGACY_DIR" ] && [ ! -L "$LEGACY_DIR" ] && [ ! -e "$DIR" ]; then
  mv "$LEGACY_DIR" "$DIR" && ln -s "$DIR" "$LEGACY_DIR"
fi
for old in ai-stoica-update.path ai-stoica-update-check.timer; do
  if [ -f "$UNITS/$old" ]; then systemctl disable --now "$old" >/dev/null 2>&1 || true; rm -f "$UNITS/$old"; CLEANED=1; fi
done
for old in ai-stoica-update-check.service ai-stoica-update.service; do [ -f "$UNITS/$old" ] && rm -f "$UNITS/$old" && CLEANED=1; done
[ "${CLEANED:-0}" = 1 ] && systemctl daemon-reload

mkdir -p "$DIR"
chown "$WEB_UID:$WEB_UID" "$DIR"
chmod 755 "$DIR"

RUNNER="$ROOT/deploy/hetzner/update-runner.sh"
write_unit() { local name="$1"; local tmp; tmp="$(mktemp)"; cat >"$tmp"; if ! cmp -s "$tmp" "$UNITS/$name"; then mv -f "$tmp" "$UNITS/$name"; chmod 644 "$UNITS/$name"; CHANGED=1; else rm -f "$tmp"; fi; }
CHANGED=0

write_unit serasmart-update.service <<EOF
[Unit]
Description=Serasmart AI: actualizarea site-ului (cerută din aplicație)
After=network-online.target docker.service

[Service]
Type=oneshot
Environment=SERASMART_ROOT=$ROOT
Environment=SERASMART_UPDATE_DIR=$DIR
ExecStart=/bin/bash $RUNNER run
TimeoutStartSec=1800
EOF

write_unit serasmart-update.path <<EOF
[Unit]
Description=Serasmart AI: așteaptă cererea de actualizare din aplicație

[Path]
PathExists=$DIR/request
Unit=serasmart-update.service

[Install]
WantedBy=multi-user.target
EOF

write_unit serasmart-update-check.service <<EOF
[Unit]
Description=Serasmart AI: caută o versiune nouă pe GitHub
After=network-online.target docker.service

[Service]
Type=oneshot
Environment=SERASMART_ROOT=$ROOT
Environment=SERASMART_UPDATE_DIR=$DIR
ExecStart=/bin/bash $RUNNER check
TimeoutStartSec=1800
EOF

write_unit serasmart-update-check.timer <<EOF
[Unit]
Description=Serasmart AI: verificare orară a versiunii noi

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

[ "$CHANGED" = 1 ] && systemctl daemon-reload
systemctl enable --now serasmart-update.path >/dev/null 2>&1
systemctl enable --now serasmart-update-check.timer >/dev/null 2>&1
date -Is >"$DIR/installed"
say "Butonul «Actualizează site-ul» e gata: Setări → General în aplicație (contul Owner)."
