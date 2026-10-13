$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDirectory = Join-Path $projectDirectory "dist"
$url = "http://localhost:4173"

Start-Process $url
Write-Host "Luma đang chạy tại $url"
Write-Host "Nhấn Ctrl+C để dừng."
python -m http.server 4173 --directory $distDirectory
