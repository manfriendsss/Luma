# Chạy LUMA ở chế độ cửa sổ dòng lệnh (hiện log). Tương đương: npm start
$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDirectory
node scripts/build.mjs
Start-Process "http://127.0.0.1:4173"
Write-Host "LUMA đang chạy tại http://127.0.0.1:4173 — nhấn Ctrl+C để dừng."
node server.mjs
