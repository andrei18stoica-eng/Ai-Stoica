#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Rulează acest script cu sudo."
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker

echo
echo "Docker este pregătit."
echo "În apps/cloud copiază .env.example în .env, completează domeniul și secretul,"
echo "apoi rulează: docker compose up -d --build"
