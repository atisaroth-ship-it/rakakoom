# Asks for each Shopee feed link one at a time (paste one link, Enter) and stores them as the FEED_URLS secret.
# Values are hidden while pasting and sent straight to GitHub; nothing is written to disk or printed.
# Run: powershell -ExecutionPolicy Bypass -File .\scripts\set-feed-urls.ps1
$ErrorActionPreference = 'Stop'
$repo = 'atisaroth-ship-it/rakakoom'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'

Write-Host 'Shopee Affiliate > รายการ feed สินค้า > Product Feed All Global Category > ดูลิงก์' -ForegroundColor Cyan
Write-Host 'กด "สำเนา" ทีละลิงก์ แล้ววางที่นี่ทีละลิงก์ กด Enter เปล่า ๆ เมื่อครบ'
$urls = @()
while ($true) {
  $secure = Read-Host "ลิงก์ที่ $($urls.Count + 1) (Enter เปล่า = ครบแล้ว)" -AsSecureString
  $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
  if (-not $value) { break }
  if ($value -notmatch '^https://affiliate\.shopee\.co\.th/api/v1/datafeed/download\?id=') {
    Write-Host 'ไม่ใช่ลิงก์ฟีด (ต้องขึ้นต้นด้วย https://affiliate.shopee.co.th/api/v1/datafeed/download?id=) — ลองใหม่' -ForegroundColor Red
    continue
  }
  $urls += $value
  Write-Host "รับลิงก์ที่ $($urls.Count) แล้ว" -ForegroundColor Green
}
if ($urls.Count -eq 0) { Write-Host 'ไม่มีลิงก์ — ไม่ได้บันทึก' -ForegroundColor Yellow; exit 1 }
($urls -join ',') | & $gh secret set FEED_URLS -R $repo
if ($LASTEXITCODE -eq 0) { Write-Host "บันทึก FEED_URLS แล้ว ($($urls.Count) ลิงก์)" -ForegroundColor Green } else { Write-Host 'บันทึกไม่สำเร็จ' -ForegroundColor Red }
