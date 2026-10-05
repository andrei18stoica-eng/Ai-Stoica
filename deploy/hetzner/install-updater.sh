#!/usr/bin/env bash
# Installs (or refreshes) the server side of the site's "Actualizează site-ul" button, once, as root:
#   - the folder shared with the web container (requests in, status out), owned by the container's user;
#   - ai-stoica-update.path + .service: when the site drops a request, run update-runner.sh (update.sh);
#   - ai-stoica-update-check.timer: every hour, look for a newer version (and install it if automatic updates are on).
# update.sh runs this at the end of every update, so after the first time nothing needs to be done by hand.
set -euo pipefail

ROOT="${AI_STOICA_ROOT:-/opt/ai-stoica}"
DIR="${AI_STOICA_UPDATE_DIR:-/var/lib/ai-stoica-update}"
UNITS="${AI_STOICA_SYSTEMD_DIR:-/etc/systemd/system}"
WEB_UID="${AI_STOICA_WEB_UID:-1000}"   # user "node" in the apps/cloud image
QUIET=0; [ "${1:-}" = "--quiet" ] && QUIET=1
say() { [ "$QUIET" = 1 ] || echo "$@"; }

if [ "$(id -u)" != 0 ]; then echo "Rulează cu sudo: sudo bash $0"; exit 1; fi
if ! command -v systemctl >/dev/null 2>&1; then echo "systemd lipsește: butonul de actualizare nu poate fi instalat aici."; exit 1; fi

mkdir -p "$DIR"
chown "$WEB_UID:$WEB_UID" "$DIR"
chmod 755 "$DIR"

RUNNER="$ROOT/deploy/hetzner/update-runner.sh"
write_unit() { local name="$1"; local tmp; tmp="$(mktemp)"; cat >"$tmp"; if ! cmp -s "$tmp" "$UNITS/$name"; then mv -f "$tmp" "$UNITS/$name"; chmod 644 "$UNITS/$name"; CHANGED=1; else rm -f "$tmp"; fi; }
CHANGED=0

write_unit ai-stoica-update.service <<EOF
[Unit]
Description=AI Stoica: actualizarea site-ului (cerută din aplicație)
After=network-online.target docker.service

[Service]
Type=oneshot
Environment=AI_STOICA_ROOT=$ROOT
Environment=AI_STOICA_UPDATE_DIR=$DIR
ExecStart=/bin/bash $RUNNER run
TimeoutStartSec=1800
EOF

write_unit ai-stoica-update.path <<EOF
[Unit]
Description=AI Stoica: așteaptă cererea de actualizare din aplicație

[Path]
PathExists=$DIR/request
Unit=ai-stoica-update.service

[Install]
WantedBy=multi-user.target
EOF

write_unit ai-stoica-update-check.service <<EOF
[Unit]
Description=AI Stoica: caută o versiune nouă pe GitHub
After=network-online.target docker.service

[Service]
Type=oneshot
Environment=AI_STOICA_ROOT=$ROOT
Environment=AI_STOICA_UPDATE_DIR=$DIR
ExecStart=/bin/bash $RUNNER check
TimeoutStartSec=1800
EOF

write_unit ai-stoica-update-check.timer <<EOF
[Unit]
Description=AI Stoica: verificare orară a versiunii noi

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

[ "$CHANGED" = 1 ] && systemctl daemon-reload
systemctl enable --now ai-stoica-update.path >/dev/null 2>&1
systemctl enable --now ai-stoica-update-check.timer >/dev/null 2>&1
date -Is >"$DIR/installed"
say "Butonul «Actualizează site-ul» e gata: Setări → General în aplicație (contul Owner)."
