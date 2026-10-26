#!/usr/bin/env bash
# Stream a database dump straight to Google Cloud Storage (no temporary file on the 30 GB disk)
# and keep only the newest BACKUP_KEEP dumps (the free tier is 5 GB-months of storage).
# Env (from /etc/rakakoom.env): BACKUP_BUCKET (gs://name), BACKUP_KEEP (default 2), BACKUP_HEALTHCHECK_URL,
# LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID. Auth: the VM's service account (see deploy/README.md).
set -euo pipefail

day=$(TZ=Asia/Bangkok date +%F)
keep=${BACKUP_KEEP:-2}

fail() {
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
[ -n "${BACKUP_BUCKET:-}" ] || fail "ยังไม่ได้ตั้ง BACKUP_BUCKET"
[ -n "${BACKUP_HEALTHCHECK_URL:-}" ] || fail "ยังไม่ได้ตั้ง BACKUP_HEALTHCHECK_URL"
command -v gcloud >/dev/null || fail "ไม่พบคำสั่ง gcloud"

bucket=${BACKUP_BUCKET%/}
final="${bucket}/rakakoom-${day}.dump"
# Upload under a temporary name; only a complete dump gets the real name, so retention never keeps a broken one.
pg_dump -Fc -d rakakoom | gcloud storage cp - "${final}.partial"
gcloud storage mv "${final}.partial" "${final}"

# Retention: delete all but the newest $keep dumps (names sort by date).
mapfile -t old < <(gcloud storage ls "${bucket}/rakakoom-*.dump" | sort | head -n -"${keep}")
if [ "${#old[@]}" -gt 0 ]; then
  gcloud storage rm "${old[@]}"
fi

curl -fsS -m 30 "${BACKUP_HEALTHCHECK_URL}" >/dev/null || true
echo "backup uploaded: rakakoom-${day}.dump (keeping ${keep})"
