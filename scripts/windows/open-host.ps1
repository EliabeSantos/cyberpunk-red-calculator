$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$data = if ($env:MESA_DATA_DIR) { $env:MESA_DATA_DIR } else { Join-Path $env:ProgramData "Cyberpunk RED Calculator" }
$config = Join-Path $data "config"
$logs = Join-Path $data "logs"
$envFile = Join-Path $config "host.env"
$bootstrap = Join-Path $PSScriptRoot "bootstrap-host.ps1"
$port = 3000

if (Test-Path $envFile) {
  $portLine = Get-Content $envFile | Where-Object { $_ -match '^PORT=(\d+)$' } | Select-Object -First 1
  if ($portLine) { $port = [int]($portLine -replace '^PORT=', '') }
}

$url = "http://127.0.0.1:$port/"
try {
  Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null
} catch {
  & (Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe") `
    -NoProfile -ExecutionPolicy Bypass -File $bootstrap
  if (Test-Path $envFile) {
    $portLine = Get-Content $envFile | Where-Object { $_ -match '^PORT=(\d+)$' } | Select-Object -First 1
    if ($portLine) { $port = [int]($portLine -replace '^PORT=', '') }
  }
}

Start-Process $url
