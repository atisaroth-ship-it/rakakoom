# Asks the owner for each Cloudflare Worker secret and stores it with wrangler. Values are pasted by the owner,
# hidden while typing, and sent straight to Cloudflare; nothing is written to disk or printed.
# Run: powershell -ExecutionPolicy Bypass -File .\scripts\set-bot-secrets.ps1 [-Only NAME1,NAME2]
param([string[]]$Only)
$ErrorActionPreference = 'Stop'

$secrets = @(
  @{ Name = 'DATABASE_URL';              Hint = 'Neon > Connect (ปิด Connection pooling) > Copy snippet ของ connection string (ตัวเดียวกับที่ใส่ใน GitHub)' },
  @{ Name = 'LINE_CHANNEL_SECRET';       Hint = 'LINE Developers > channel ราคาคุ้ม > แท็บ Basic settings > Channel secret' },
  @{ Name = 'LINE_CHANNEL_ACCESS_TOKEN'; Hint = 'LINE Developers > channel ราคาคุ้ม > แท็บ Messaging API > Channel access token (ตัวเดียวกับที่ใส่ใน GitHub)' }
)
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
  $value | & npx.cmd wrangler secret put $s.Name
  if ($LASTEXITCODE -eq 0) { Write-Host "บันทึก $($s.Name) แล้ว" -ForegroundColor Green } else { Write-Host "บันทึก $($s.Name) ไม่สำเร็จ" -ForegroundColor Red }
  $value = $null
}

Write-Host ''
Write-Host 'Secrets ของบอทตอนนี้ (แสดงแค่ชื่อ):' -ForegroundColor Cyan
& npx.cmd wrangler secret list
