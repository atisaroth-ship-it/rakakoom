#!/usr/bin/env bash
# Backstop for a unit that died without alerting (OOM, kill on timeout, uncaught crash).
# Usage (from rakakoom-failure@.service): notify-failure.sh <unit name>
set -uo pipefail

unit=${1:-unknown}
day=$(TZ=Asia/Bangkok date +%F)
text="RakaKoom: ${unit} หยุดทำงานผิดปกติวันที่ ${day} — ดู journalctl -u ${unit}"

if [ -n "${LINE_CHANNEL_ACCESS_TOKEN:-}" ] && [ -n "${ADMIN_LINE_USER_ID:-}" ]; then
  curl -fsS -m 30 -X POST https://api.line.me/v2/bot/message/push \
    -H "Authorization: Bearer ${LINE_CHANNEL_ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "{\"to\":\"${ADMIN_LINE_USER_ID}\",\"messages\":[{\"type\":\"text\",\"text\":\"${text}\"}]}" >/dev/null
fi

case "$unit" in
  rakakoom-backup*) hc=${BACKUP_HEALTHCHECK_URL:-} ;;
  *) hc=${HEALTHCHECK_URL:-} ;;
esac
[ -n "$hc" ] && curl -fsS -m 30 "${hc%/}/fail" >/dev/null
exit 0
