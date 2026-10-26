#!/usr/bin/env bash
# One-time server setup for Ubuntu 24.04 (ARM) on Oracle Cloud Always Free. Run as root:
#   sudo bash /opt/rakakoom/deploy/setup.sh
# Expects the project already copied to /opt/rakakoom (see deploy/README.md).
set -euo pipefail

APP=/opt/rakakoom

# Node.js 22 LTS and PostgreSQL 16 (Ubuntu 24.04 default)
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y postgresql-16 curl

install -m 644 "$APP/deploy/postgresql-tuning.conf" /etc/postgresql/16/main/conf.d/rakakoom.conf
systemctl restart postgresql

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
  echo "Created /etc/rakakoom.env — fill in FEED_URLS and the other values, then re-run this script."
fi
chown rakakoom:rakakoom /etc/rakakoom.env
chmod 600 /etc/rakakoom.env

sudo -u rakakoom bash -c "cd $APP && npm ci"
sudo -u rakakoom bash -c "cd $APP && set -a && . /etc/rakakoom.env && set +a && npm run migrate"

install -m 644 "$APP"/deploy/rakakoom-*.service "$APP"/deploy/rakakoom-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now rakakoom-collect.timer rakakoom-backup.timer
systemctl list-timers 'rakakoom-*'
