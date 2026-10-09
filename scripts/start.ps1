# 一键启动：按需构建（qqmusic-sdk → dance-sdk → backend → frontend），再启动后端 + 客户端镜像
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent

function Build-IfNeeded([string]$name) {
  $dir = Join-Path $root "packages\$name"
  if (-not (Test-Path (Join-Path $dir 'dist'))) {
    Write-Host "== 构建 $name =="
    Push-Location $dir
    npm install
    npm run build
    Pop-Location
  } else {
    Write-Host "== $name 已构建，跳过 =="
  }
}

Build-IfNeeded 'qqmusic-sdk'
Build-IfNeeded 'dance-sdk'
Build-IfNeeded 'dance-backend'
Build-IfNeeded 'dance-frontend'

Write-Host '== 启动后端 (http://127.0.0.1:8790) =='
Start-Process node -ArgumentList 'dist/index.js' -WorkingDirectory (Join-Path $root 'packages\dance-backend') -WindowStyle Hidden

$bridge = Join-Path $root 'tools\qqclient-bridge'
if (Test-Path $bridge) {
  Write-Host '== 启动客户端镜像 (http://127.0.0.1:8899) —— 需 QQ 音乐客户端在运行 =='
  Start-Process python -ArgumentList 'bridge.py' -WorkingDirectory $bridge -WindowStyle Hidden
}

Start-Sleep -Seconds 4
try {
  (Invoke-RestMethod 'http://127.0.0.1:8790/api/health') | ConvertTo-Json -Compress
  Write-Host '就绪：浏览器打开 http://127.0.0.1:8790/'
} catch {
  Write-Host '后端未就绪，请检查 packages\dance-backend 是否构建成功。'
}
