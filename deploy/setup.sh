#!/usr/bin/env bash
# One-time server setup for Ubuntu 24.04 LTS (x86_64) on a Google Cloud e2-micro. Run as root:
#   sudo bash /opt/rakakoom/deploy/setup.sh
# Expects the project already copied to /opt/rakakoom (see deploy/README.md).
set -euo pipefail

APP=/opt/rakakoom

apt-get update

# 1 GB RAM is not enough for the daily apply plus Postgres; a swap file keeps it from being OOM-killed.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Node.js 22 LTS, PostgreSQL 16 (Ubuntu 24.04 default), Google Cloud CLI for backups
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y postgresql-16 curl
if ! command -v gcloud >/dev/null; then
  apt-get install -y apt-transport-https ca-certificates gnupg
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main' \
    > /etc/apt/sources.list.d/google-cloud-sdk.list
  apt-get update
  apt-get install -y google-cloud-cli
fi

install -m 644 "$APP/deploy/postgresql-tuning.conf" /etc/postgresql/16/main/conf.d/rakakoom.conf
systemctl restart postgresql@16-main

id rakakoom >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin rakakoom
chown -R rakakoom:rakakoom "$APP"

# Database owned by the rakakoom OS user; local peer auth, no password.
sudo -u postgres psql -tc "select 1 from pg_roles where rolname = 'rakakoom'" | grep -q 1 \
  || sudo -u postgres createuser rakakoom
sudo -u postgres psql -tc "select 1 from pg_database where datname = 'rakakoom'" | grep -q 1 \
  || sudo -u postgres createdb -O rakakoom rakakoom

if [ ! -f /etc/rakakoom.env ]; then
  cp "$APP/.env.example" /etc/rakakoom.env
  sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgresql:///rakakoom?host=/var/run/postgresql|' /etc/rakakoom.env
  chown rakakoom:rakakoom /etc/rakakoom.env
  chmod 600 /etc/rakakoom.env
  echo "Created /etc/rakakoom.env — fill in the values (see deploy/README.md), then re-run this script."
  exit 0
fi
chown rakakoom:rakakoom /etc/rakakoom.env
chmod 600 /etc/rakakoom.env

sudo -u rakakoom bash -c "cd $APP && npm ci"
# Read DATABASE_URL the same way systemd will (no shell evaluation of the file).
db_url=$(sed -n 's/^DATABASE_URL=//p' /etc/rakakoom.env | tr -d '"')
sudo -u rakakoom env DATABASE_URL="$db_url" FEED_URLS=unused bash -c "cd $APP && npm run migrate"

install -m 644 "$APP"/deploy/rakakoom-*.service "$APP"/deploy/rakakoom-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now rakakoom-collect.timer rakakoom-backup.timer
systemctl list-timers 'rakakoom-*'
