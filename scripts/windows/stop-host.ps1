$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:ProgramData "Cyberpunk RED Calculator"
$config = Join-Path $data "config"
$logs = Join-Path $data "logs"
$pidFile = Join-Path $config "host.pid"

if (Test-Path $pidFile) {
  $hostPid = [int](Get-Content $pidFile -Raw).Trim()
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $hostPid" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -like "*scripts\\local-start.mjs*") {
    & taskkill.exe /PID $hostPid /T /F *> (Join-Path $logs "stop.log")
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$pg = Get-ChildItem (Join-Path $root "postgres") -Filter pg_ctl.exe -Recurse | Select-Object -First 1
$cluster = Join-Path $data "postgres"
if ($pg -and (Test-Path (Join-Path $cluster "PG_VERSION"))) {
  & $pg.FullName -D $cluster stop -m fast -w *> (Join-Path $logs "postgres-stop.log")
}
