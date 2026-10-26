#!/usr/bin/env bash
# Dump the database and upload it to object storage through a pre-authenticated request URL.
# Env (from /etc/rakakoom.env): BACKUP_PAR_URL (bucket PAR ending in /o/), BACKUP_HEALTHCHECK_URL,
# LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID
set -euo pipefail

day=$(TZ=Asia/Bangkok date +%F)
file="/tmp/rakakoom-${day}.dump"

fail() {
  rm -f "$file"
  if [ -n "${LINE_CHANNEL_ACCESS_TOKEN:-}" ] && [ -n "${ADMIN_LINE_USER_ID:-}" ]; then
    curl -fsS -m 30 -X POST https://api.line.me/v2/bot/message/push \
      -H "Authorization: Bearer ${LINE_CHANNEL_ACCESS_TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "{\"to\":\"${ADMIN_LINE_USER_ID}\",\"messages\":[{\"type\":\"text\",\"text\":\"RakaKoom: สำรองฐานข้อมูลวันที่ ${day} ล้มเหลว — $1\"}]}" \
      >/dev/null || true
  fi
  [ -n "${BACKUP_HEALTHCHECK_URL:-}" ] && curl -fsS -m 30 "${BACKUP_HEALTHCHECK_URL%/}/fail" >/dev/null || true
  exit 1
}
trap 'fail "คำสั่งล้มเหลวที่บรรทัด $LINENO"' ERR

# Explicit checks: under set -e a failed ${VAR:?} exits without running the ERR trap.
[ -n "${BACKUP_PAR_URL:-}" ] || fail "ยังไม่ได้ตั้ง BACKUP_PAR_URL"
[ -n "${BACKUP_HEALTHCHECK_URL:-}" ] || fail "ยังไม่ได้ตั้ง BACKUP_HEALTHCHECK_URL"

pg_dump -Fc -d rakakoom -f "$file"
curl -fsS -T "$file" "${BACKUP_PAR_URL%/}/rakakoom-${day}.dump"
rm -f "$file"
curl -fsS -m 30 "${BACKUP_HEALTHCHECK_URL}" >/dev/null || true
echo "backup uploaded: rakakoom-${day}.dump"
