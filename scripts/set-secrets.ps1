# Asks the owner for each GitHub Actions secret and stores it with gh. Values are typed/pasted by the owner,
# hidden while typing, and sent straight to GitHub; nothing is written to disk or printed.
# Run: powershell -ExecutionPolicy Bypass -File .\scripts\set-secrets.ps1 [-Only NAME1,NAME2]
param([string[]]$Only)
$ErrorActionPreference = 'Stop'
$repo = 'atisaroth-ship-it/rakakoom'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'

$secrets = @(
  @{ Name = 'DATABASE_URL';              Hint = 'Neon > Connect (ปิด Connection pooling) > Copy snippet ของ connection string' },
  @{ Name = 'FEED_URLS';                 Hint = 'แนะนำให้กด Enter ข้าม แล้วใช้ scripts\set-feed-urls.ps1 แทน (วางทีละลิงก์ ไม่พลาดง่าย)' },
  @{ Name = 'LINE_CHANNEL_ACCESS_TOKEN'; Hint = 'LINE Developers > channel ของ OA > Messaging API > Channel access token' },
  @{ Name = 'ADMIN_LINE_USER_ID';        Hint = 'LINE Developers > Basic settings > Your user ID (ขึ้นต้นด้วย U)' },
  @{ Name = 'HEALTHCHECK_URL';           Hint = 'healthchecks.io > check rakakoom-collect > Ping URL' },
  @{ Name = 'BACKUP_HEALTHCHECK_URL';    Hint = 'healthchecks.io > check rakakoom-backup > Ping URL' }
)

# powershell -File passes "A,B" as one string; split it.
if ($Only) {
  $names = $Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() }
  $secrets = $secrets | Where-Object { $names -contains $_.Name }
}

foreach ($s in $secrets) {
  Write-Host ''
  Write-Host "== $($s.Name) ==" -ForegroundColor Cyan
  Write-Host $s.Hint
  $secure = Read-Host 'วางค่าแล้วกด Enter (เว้นว่าง = ข้ามไปก่อน)' -AsSecureString
  $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
  if (-not $value) { Write-Host 'ข้าม' -ForegroundColor Yellow; continue }

  if ($s.Name -eq 'DATABASE_URL') {
    # node-postgres does not use channel_binding; Neon works without it.
    $value = $value -replace '[&?]channel_binding=require', ''
    if ($value -notmatch '^postgres(ql)?://') { Write-Host 'ไม่ใช่ connection string (ต้องขึ้นต้นด้วย postgresql://) — ข้าม' -ForegroundColor Red; continue }
    if ($value -match '-pooler\.') { Write-Host 'นี่เป็นแบบ pooling — ปิด Connection pooling ใน Neon แล้วคัดลอกใหม่ — ข้าม' -ForegroundColor Red; continue }
  }

  $value | & $gh secret set $s.Name -R $repo
  if ($LASTEXITCODE -eq 0) { Write-Host "บันทึก $($s.Name) แล้ว" -ForegroundColor Green } else { Write-Host "บันทึก $($s.Name) ไม่สำเร็จ" -ForegroundColor Red }
  $value = $null
}

Write-Host ''
Write-Host 'Secrets ที่มีใน repo ตอนนี้ (แสดงแค่ชื่อ):' -ForegroundColor Cyan
& $gh secret list -R $repo
