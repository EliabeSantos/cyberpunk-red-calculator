param(
  [string]$NodeZipUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip",
  [string]$PostgresZipUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64-binaries.zip",
  [string]$NodeSha256 = "55b639295920b219bb2acbcfa00f90393a2789095b7323f79475c9f34795f217",
  [string]$PostgresSha256 = "6a1bfb6435b13d9563ae481445c70ac2a19846bd8a430b12903b408eec300f9b",
  [string]$InnoSetup = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)
$ErrorActionPreference = "Stop"

function Invoke-RequiredCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Step
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE. See the command output above for the original error."
  }
}

$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$stage = Join-Path $root "installer\windows\stage"
$output = Join-Path $root "installer\windows\output"
$electronOutput = Join-Path $root "installer\windows\electron-output"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $output -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $electronOutput -Recurse -Force -ErrorAction SilentlyContinue
New-Item $stage -ItemType Directory | Out-Null
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required on the Windows build runner." }
if (-not (Test-Path $InnoSetup)) { throw "Inno Setup compiler not found: $InnoSetup" }

# Fail before packaging if a PowerShell payload script cannot be parsed. This
# prevents producing an installer that only fails when the user first opens it.
$parseErrors = @()
foreach ($script in Get-ChildItem (Join-Path $root "scripts\windows") -Filter "*.ps1" -File) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) { $parseErrors += "$($script.Name): $((($errors | ForEach-Object { $_.Message }) -join '; '))" }
}
if ($parseErrors.Count -gt 0) { throw "PowerShell payload syntax validation failed: $($parseErrors -join ' | ')" }

Push-Location $root
try {
  Invoke-RequiredCommand "npm" @("ci") "npm ci"
  Invoke-RequiredCommand "npm" @("run", "build") "Next.js build"
} finally { Pop-Location }
$electronExecutable = Join-Path $root "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExecutable)) {
  throw "Electron installation is incomplete: npm ci did not provide $electronExecutable. Check the npm install logs and Electron download step."
}
$electronSize = (Get-Item $electronExecutable).Length
if ($electronSize -lt 1MB) {
  throw "Electron executable is unexpectedly small: $electronExecutable ($electronSize bytes)."
}
$cache = Join-Path $env:TEMP "cyberpunk-red-installer-cache"
New-Item $cache -ItemType Directory -Force | Out-Null
foreach ($item in @(
  @{ Url=$NodeZipUrl; File="node.zip"; Sha256=$NodeSha256 },
  @{ Url=$PostgresZipUrl; File="postgres.zip"; Sha256=$PostgresSha256 }
)) {
  $target = Join-Path $cache $item.File
  if (-not (Test-Path $target)) { Invoke-WebRequest -Uri $item.Url -OutFile $target }
  $actual = (Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant()
  if ($actual -ne $item.Sha256.ToLowerInvariant()) {
    Remove-Item $target -Force
    throw "Checksum mismatch for $($item.File): expected $($item.Sha256), got $actual."
  }
  Expand-Archive $target -DestinationPath (Join-Path $stage $item.File.Replace('.zip','')) -Force
}
Copy-Item "$root\.next" "$stage\app\.next" -Recurse
Copy-Item "$root\public" "$stage\app\public" -Recurse
Copy-Item "$root\package.json","$root\package-lock.json" "$stage\app"
Copy-Item "$root\node_modules" "$stage\app\node_modules" -Recurse
Copy-Item "$root\scripts" "$stage\app\scripts" -Recurse
Copy-Item "$root\desktop" "$stage\app\desktop" -Recurse
Copy-Item "$root\src\app\favicon.ico","$root\src\app\icon.ico","$root\src\app\icon.svg" "$stage\app"
Remove-Item "$stage\app\scripts\windows" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$root\supabase" "$stage\app\supabase" -Recurse
$requiredStageFiles = @(
  "$stage\app\.next\BUILD_ID",
  "$stage\app\package.json",
  "$stage\app\scripts\start-host.mjs",
  "$stage\app\scripts\migrate-local.mjs",
  "$stage\app\desktop\main.cjs",
  "$stage\app\node_modules\next\dist\bin\next",
  "$stage\app\node_modules\pg\package.json"
)
foreach ($path in $requiredStageFiles) {
  if (-not (Test-Path $path)) { throw "Required packaged application file is missing: $path" }
}
Push-Location $root
try {
  Invoke-RequiredCommand "npm" @("run", "dist:windows", "--", "--publish", "never") "Electron Builder"
} finally { Pop-Location }
if (-not (Test-Path $electronOutput -PathType Container)) {
  throw "Electron Builder completed without creating its configured output directory: $electronOutput"
}
$electronArtifacts = @(Get-ChildItem (Join-Path $electronOutput "*Setup*.exe") -File -ErrorAction Stop)
if ($electronArtifacts.Count -ne 1) {
  throw "Expected exactly one Electron NSIS installer in $electronOutput, found $($electronArtifacts.Count)."
}
if ($electronArtifacts[0].Length -lt 1MB) {
  throw "Electron installer is unexpectedly small: $($electronArtifacts[0].FullName) ($($electronArtifacts[0].Length) bytes)."
}
& $InnoSetup "$root\installer\windows\CyberpunkRedCalculator.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE." }
if (-not (Test-Path (Join-Path $output "CyberpunkRedCalculator-Setup.exe"))) {
  throw "Inno Setup completed without creating the expected installer artifact."
}
