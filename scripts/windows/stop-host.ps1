$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:ProgramData "Cyberpunk RED Calculator"
$config = Join-Path $data "config"
$logs = Join-Path $data "logs"
$pidFile = Join-Path $config "host.pid"
New-Item $logs -ItemType Directory -Force | Out-Null

function Wait-ForProcessExit([int] $processId, [int] $seconds = 30) {
  for ($attempt = 0; $attempt -lt ($seconds * 2); $attempt++) {
    if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

if (Test-Path $pidFile) {
  $rawPid = (Get-Content $pidFile -Raw).Trim()
  $hostPid = 0
  if (-not [int]::TryParse($rawPid, [ref]$hostPid) -or $hostPid -le 0) {
    throw "Invalid host PID file. Refusing to stop an unknown process."
  }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $hostPid" -ErrorAction SilentlyContinue
  if ($process) {
    $expectedNodeRoot = [IO.Path]::GetFullPath((Join-Path $root "node"))
    $executable = if ($process.ExecutablePath) { [IO.Path]::GetFullPath($process.ExecutablePath) } else { "" }
    $isBundledNode = $executable.StartsWith($expectedNodeRoot, [StringComparison]::OrdinalIgnoreCase)
    $expectedStartScript = [IO.Path]::GetFullPath((Join-Path $root "app\scripts\start-host.mjs"))
    # Older installations passed the script as a relative argument. Accept
    # that legacy form only together with the bundled Node executable; new
    # bootstraps use the absolute script path.
    $isExpectedScript = ($process.CommandLine -match [regex]::Escape($expectedStartScript)) -or
      ($process.CommandLine -match '(?i)(^|[" ])scripts[\\/]start-host\.mjs([" ]|$)')
    if (-not $isBundledNode -or -not $isExpectedScript) {
      throw "PID $hostPid não corresponde ao host empacotado; atualização/desinstalação abortada."
    }
    & taskkill.exe /PID $hostPid /T /F *> (Join-Path $logs "stop.log")
    if ($LASTEXITCODE -ne 0 -or -not (Wait-ForProcessExit $hostPid)) {
      throw "Não foi possível confirmar a parada do host PID $hostPid."
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$pg = Get-ChildItem (Join-Path $root "postgres") -Filter pg_ctl.exe -Recurse | Select-Object -First 1
$cluster = Join-Path $data "postgres"
if ($pg -and (Test-Path (Join-Path $cluster "PG_VERSION"))) {
  & $pg.FullName -D $cluster status *> (Join-Path $logs "postgres-status.log")
  if ($LASTEXITCODE -eq 0) {
    # The server may exit between `status` and `stop` (for example after the
    # host was closed manually). Treat that already-stopped state as success.
    if (Test-Path (Join-Path $cluster "postmaster.pid")) {
      & $pg.FullName -D $cluster stop -m fast -w *> (Join-Path $logs "postgres-stop.log")
      if ($LASTEXITCODE -ne 0) {
        & $pg.FullName -D $cluster status *> (Join-Path $logs "postgres-status.log")
        if ($LASTEXITCODE -eq 0) { throw "PostgreSQL não confirmou a parada; atualização/desinstalação abortada." }
      }
    }
  }
}
