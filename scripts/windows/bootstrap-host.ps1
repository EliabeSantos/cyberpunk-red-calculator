$ErrorActionPreference = "Stop"
# The script is installed at <app>\windows\bootstrap-host.ps1.
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:ProgramData "Cyberpunk RED Calculator"
$config = Join-Path $data "config"
$logs = Join-Path $data "logs"
New-Item $config,$logs -ItemType Directory -Force | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
# Use well-known SIDs for SYSTEM and the local Administrators group so this
# works on localized Windows installations (Administradores, Administrators,
# Administrateurs, etc.).
& icacls.exe $data /inheritance:r /grant:r "${identity}:(OI)(CI)M" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" *> (Join-Path $logs "permissions.log")
if ($LASTEXITCODE -ne 0) { throw "Could not protect the local data directory permissions. See $logs\permissions.log." }
$node = Get-ChildItem (Join-Path $root "node") -Filter node.exe -Recurse | Select-Object -First 1
$pg = Get-ChildItem (Join-Path $root "postgres") -Filter initdb.exe -Recurse | Select-Object -First 1
if (-not $node -or -not $pg) { throw "Portable Node.js/PostgreSQL payload is incomplete." }
$pgBin = Split-Path $pg.FullName
$pgCtl = Join-Path $pgBin "pg_ctl.exe"
$createdb = Join-Path $pgBin "createdb.exe"
# Keep the bundled database separate from common WSL/development PostgreSQL
# forwarding, which frequently occupies 127.0.0.1:5432 on developer machines.
$pgPort = 55432
$appPort = 3000

function Test-ListeningPort([int] $port) {
  return @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}

function Start-Postgres {
  & $pgCtl -D $cluster status *> $null
  if ($LASTEXITCODE -eq 0) { return }
  if (Test-ListeningPort $pgPort) {
    throw "PostgreSQL port $pgPort is already occupied by another process. Stop it or choose a different configured port."
  }
  & $pgCtl -D $cluster -o "-h 127.0.0.1 -p $pgPort" -l (Join-Path $logs "postgres.log") start
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed to start. See $logs\postgres.log." }
}

function Start-App {
  if (Test-ListeningPort $appPort) {
    throw "Application port $appPort is already occupied. Stop the existing server before starting this host."
  }
  $process = Start-Process -FilePath $node.FullName -ArgumentList "scripts\local-start.mjs" -WorkingDirectory (Join-Path $root "app") -RedirectStandardOutput (Join-Path $logs "host.log") -RedirectStandardError (Join-Path $logs "host-error.log") -PassThru
  $process.Id | Set-Content (Join-Path $config "host.pid") -Encoding ascii
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$appPort/" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
    } catch { Start-Sleep -Seconds 1 }
  }
  & taskkill.exe /PID $process.Id /T /F *> $null
  throw "Application did not become healthy on port $appPort. See $logs\host.log and $logs\host-error.log."
}

$password = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
$encodedPassword = [uri]::EscapeDataString($password)
$cluster = Join-Path $data "postgres"
$clusterExisted = Test-Path (Join-Path $cluster "PG_VERSION")
if (-not $clusterExisted) {
  $pwFile = Join-Path $config "bootstrap-password"
  $password | Set-Content $pwFile -Encoding ascii
  & $pg.FullName -D $cluster --username=mesa_app --pwfile=$pwFile --auth=scram-sha-256
  Remove-Item $pwFile -Force
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL cluster initialization failed." }
  Start-Postgres
  $previousPgPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $password
  try {
    & $createdb -h 127.0.0.1 -p $pgPort -U mesa_app cyberpunk_red
  } finally {
    $env:PGPASSWORD = $previousPgPassword
  }
  if ($LASTEXITCODE -ne 0) { throw "Local database creation failed." }
}
$envFile = Join-Path $config "host.env"
if ($clusterExisted -and -not (Test-Path $envFile)) {
  throw "Database exists but host.env is missing; restore the configuration or use the documented recovery procedure."
}
if (-not (Test-Path $envFile)) {
  "MESA_HOSTING_MODE=local`nMESA_LOCAL_DATABASE_URL=postgresql://mesa_app:$encodedPassword@127.0.0.1:$pgPort/cyberpunk_red`nMESA_HOSTNAME=0.0.0.0`nPORT=$appPort" | Set-Content $envFile -Encoding ascii
}
Get-Content $envFile | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') } }
Start-Postgres
Start-App
