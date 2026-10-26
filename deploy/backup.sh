#!/usr/bin/env bash
# Dump the database and upload it to OCI Object Storage through a pre-authenticated request.
# Env (from /etc/rakakoom.env): BACKUP_PAR_URL (bucket PAR ending in /o/), LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID
set -euo pipefail

day=$(TZ=Asia/Bangkok date +%F)
file="/tmp/rakakoom-${day}.dump"

alert() {
  if [ -n "${LINE_CHANNEL_ACCESS_TOKEN:-}" ] && [ -n "${ADMIN_LINE_USER_ID:-}" ]; then
    curl -fsS -X POST https://api.line.me/v2/bot/message/push \
      -H "Authorization: Bearer ${LINE_CHANNEL_ACCESS_TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "{\"to\":\"${ADMIN_LINE_USER_ID}\",\"messages\":[{\"type\":\"text\",\"text\":\"RakaKoom: สำรองฐานข้อมูลวันที่ ${day} ล้มเหลว\"}]}" \
      >/dev/null || true
  fi
}
trap 'alert; rm -f "$file"' ERR

: "${BACKUP_PAR_URL:?BACKUP_PAR_URL is not set}"
pg_dump -Fc -d rakakoom -f "$file"
curl -fsS -T "$file" "${BACKUP_PAR_URL%/}/rakakoom-${day}.dump"
rm -f "$file"
echo "backup uploaded: rakakoom-${day}.dump"
