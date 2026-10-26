#!/usr/bin/env bash
# Backstop alert for a GitHub Actions job that failed without the program's own alert.
# Usage: notify-failure.sh "<job name>"   Env: LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID, HEALTHCHECK_URL, RUN_URL
set -uo pipefail

job=${1:-unknown}
day=$(TZ=Asia/Bangkok date +%F)
text="RakaKoom: งาน ${job} ล้มเหลววันที่ ${day} — ดูรายละเอียดที่ ${RUN_URL:-GitHub Actions}"

if [ -n "${LINE_CHANNEL_ACCESS_TOKEN:-}" ] && [ -n "${ADMIN_LINE_USER_ID:-}" ]; then
  body=$(TEXT="$text" TO="$ADMIN_LINE_USER_ID" node -e \
    'process.stdout.write(JSON.stringify({ to: process.env.TO, messages: [{ type: "text", text: process.env.TEXT }] }))')
  curl -fsS -m 30 -X POST https://api.line.me/v2/bot/message/push \
    -H "Authorization: Bearer ${LINE_CHANNEL_ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$body" > /dev/null || echo "LINE alert failed"
fi
if [ -n "${HEALTHCHECK_URL:-}" ]; then
  curl -fsS -m 30 "${HEALTHCHECK_URL%/}/fail" > /dev/null || echo "heartbeat fail ping failed"
fi
exit 0
