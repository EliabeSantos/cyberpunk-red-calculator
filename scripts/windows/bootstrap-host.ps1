$ErrorActionPreference = "Stop"
# The script is installed at <app>\windows\bootstrap-host.ps1.
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:ProgramData "Cyberpunk RED Calculator"
$config = Join-Path $data "config"
$logs = Join-Path $data "logs"
New-Item $config,$logs -ItemType Directory -Force | Out-Null
trap {
  # Keep diagnostics useful without echoing environment variables, passwords,
  # or the host-admin token into the log.
  $message = $_.Exception.Message -replace '(?i)(postgres(?:ql)?://[^\s]+)', 'postgresql://[redacted]'
  "Host bootstrap failed: $($_.Exception.GetType().Name): $message" |
    Add-Content (Join-Path $logs "host-error.log")
  exit 1
}
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
$psql = Join-Path $pgBin "psql.exe"
if (-not (Test-Path $psql)) { throw "Portable PostgreSQL payload is missing psql.exe." }
# Keep the bundled database separate from common WSL/development PostgreSQL
# forwarding, which frequently occupies 127.0.0.1:5432 on developer machines.
$pgPort = 55432
$appPort = 3000

function Test-ListeningPort([int] $port) {
  return @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}

function Find-FreeAppPort([int] $preferredPort) {
  $candidate = $preferredPort
  while (Test-ListeningPort $candidate) {
    $candidate++
    if ($candidate -gt ($preferredPort + 100)) {
      throw "No free application port was found near $preferredPort."
    }
  }
  return $candidate
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

function Ensure-LocalDatabase {
  $exists = (& $psql -h 127.0.0.1 -p $pgPort -U mesa_app -d postgres -tAc "select 1 from pg_database where datname = 'cyberpunk_red'" 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the local database catalog." }
  if ($exists -eq "1") { return }
  & $createdb -h 127.0.0.1 -p $pgPort -U mesa_app cyberpunk_red
  if ($LASTEXITCODE -ne 0) { throw "Local database creation failed." }
}

function Start-App {
  if (Test-ListeningPort $appPort) {
    throw "Application port $appPort is already occupied. Stop the existing server before starting this host."
  }
  $startScript = Join-Path $root "app\scripts\start-host.mjs"
  if (-not (Test-Path $startScript)) { throw "Host start script is missing from the installed application." }
  $process = Start-Process -FilePath $node.FullName -ArgumentList @("`"$startScript`"") -WorkingDirectory (Join-Path $root "app") -RedirectStandardOutput (Join-Path $logs "host.log") -RedirectStandardError (Join-Path $logs "host-error.log") -PassThru
  $process.Id | Set-Content (Join-Path $config "host.pid") -Encoding ascii
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$appPort/" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
    } catch { Start-Sleep -Seconds 1 }
  }
  if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
    & taskkill.exe /PID $process.Id /T /F *> $null
  }
  Remove-Item (Join-Path $config "host.pid") -Force -ErrorAction SilentlyContinue
  throw "Application did not become healthy on port $appPort. See $logs\host.log and $logs\host-error.log."
}

$cluster = Join-Path $data "postgres"
$envFile = Join-Path $config "host.env"
$pwFile = Join-Path $config "bootstrap-password"
$adminTokenFile = Join-Path $config "host-admin-token"
function New-RandomAdminToken {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
$password = if (Test-Path $pwFile) { (Get-Content $pwFile -Raw).Trim() } else { [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 })) }
$encodedPassword = [uri]::EscapeDataString($password)
$adminToken = if (Test-Path $adminTokenFile) { (Get-Content $adminTokenFile -Raw).Trim() } else {
  New-RandomAdminToken
}
if ([string]::IsNullOrWhiteSpace($adminToken)) {
  $adminToken = New-RandomAdminToken
}
if (-not (Test-Path $adminTokenFile) -or [string]::IsNullOrWhiteSpace((Get-Content $adminTokenFile -Raw))) {
  $adminToken | Set-Content $adminTokenFile -Encoding ascii
}
$hostEnvExists = Test-Path $envFile
if ($hostEnvExists) {
  $portLine = Get-Content $envFile | Where-Object { $_ -match '^PORT=(\d+)$' } | Select-Object -First 1
  if ($portLine) { $appPort = [int]($portLine -replace '^PORT=', '') }
  # Keep the database credential stable across restarts. The bootstrap
  # password file is intentionally removed after first setup, so generating
  # a new password here would make the persisted host.env and PostgreSQL
  # credentials diverge on the next launch.
  $databaseUrlLine = Get-Content $envFile | Where-Object { $_ -match '^MESA_LOCAL_DATABASE_URL=' } | Select-Object -First 1
  if ($databaseUrlLine) {
    $databaseUrl = $databaseUrlLine.Substring('MESA_LOCAL_DATABASE_URL='.Length)
    $databaseUri = [Uri]$databaseUrl
    $separator = $databaseUri.UserInfo.IndexOf(':')
    if ($separator -lt 0) { throw "MESA_LOCAL_DATABASE_URL has no database password." }
    $password = [Uri]::UnescapeDataString($databaseUri.UserInfo.Substring($separator + 1))
    $encodedPassword = [uri]::EscapeDataString($password)
  }
  Get-Content $envFile | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') } }
}
$appPort = if ($hostEnvExists) { $appPort } else { Find-FreeAppPort $appPort }
$configuredMode = if ($env:MESA_HOSTING_MODE) { $env:MESA_HOSTING_MODE.Trim().ToLowerInvariant() } else { $null }
if (-not $configuredMode) { $configuredMode = "local" }
if ($configuredMode -ne "local" -and $configuredMode -ne "supabase") {
  throw "MESA_HOSTING_MODE must be local or supabase."
}
$clusterExisted = Test-Path (Join-Path $cluster "PG_VERSION")
if ($configuredMode -eq "local" -and -not $clusterExisted) {
  if (-not (Test-Path $pwFile)) { $password | Set-Content $pwFile -Encoding ascii }
  if (Test-ListeningPort $pgPort) {
    throw "PostgreSQL port $pgPort is already occupied by another process. The database cluster was not initialized."
  }
  & $pg.FullName -D $cluster --username=mesa_app --pwfile=$pwFile --auth=scram-sha-256 --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL cluster initialization failed." }
  Start-Postgres
  $previousPgPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $password
  try {
    Ensure-LocalDatabase
  } finally {
    $env:PGPASSWORD = $previousPgPassword
  }
}
if ($configuredMode -eq "local" -and $clusterExisted -and -not $hostEnvExists -and (Test-Path $pwFile)) {
  Start-Postgres
  $previousPgPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $password
  try {
    Ensure-LocalDatabase
  } finally {
    $env:PGPASSWORD = $previousPgPassword
  }
}
if ($configuredMode -eq "local" -and $clusterExisted -and -not $hostEnvExists -and -not (Test-Path $pwFile)) {
  throw "Database exists but host.env is missing; restore the configuration or use the documented recovery procedure."
}
if (-not $hostEnvExists) {
  "MESA_HOSTING_MODE=local`nMESA_HOST_ENV_FILE=$envFile`nMESA_HOSTING_MODE_FILE=$envFile`nMESA_HOST_ADMIN_TOKEN_FILE=$adminTokenFile`nMESA_LOCAL_DATABASE_URL=postgresql://mesa_app:$encodedPassword@127.0.0.1:$pgPort/cyberpunk_red`nMESA_HOSTNAME=0.0.0.0`nPORT=$appPort" | Set-Content $envFile -Encoding ascii
  Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
} elseif (-not (Select-String -Path $envFile -Pattern '^MESA_HOST_ADMIN_TOKEN_FILE=' -Quiet)) {
  Add-Content $envFile "MESA_HOST_ADMIN_TOKEN_FILE=$adminTokenFile" -Encoding ascii
}
Get-Content $envFile | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') } }
& icacls.exe $envFile /inheritance:r /grant:r "${identity}:R" "*S-1-5-18:R" "*S-1-5-32-544:R" *> (Join-Path $logs "permissions.log")
if ($LASTEXITCODE -ne 0) { throw "Could not protect host.env permissions. See $logs\permissions.log." }
& icacls.exe $adminTokenFile /inheritance:r /grant:r "${identity}:R" "*S-1-5-18:F" "*S-1-5-32-544:F" *> (Join-Path $logs "permissions.log")
if ($LASTEXITCODE -ne 0) { throw "Could not protect host-admin-token permissions. See $logs\permissions.log." }
if ($env:MESA_HOSTING_MODE -eq "local") { Start-Postgres }
Start-App
