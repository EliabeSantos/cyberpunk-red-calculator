param(
  [string]$NodeZipUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip",
  [string]$PostgresZipUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64-binaries.zip",
  [string]$NodeSha256 = "55b639295920b219bb2acbcfa00f90393a2789095b7323f79475c9f34795f217",
  [string]$PostgresSha256 = "6a1bfb6435b13d9563ae481445c70ac2a19846bd8a430b12903b408eec300f9b",
  [string]$InnoSetup = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$stage = Join-Path $root "installer\windows\stage"
$output = Join-Path $root "installer\windows\output"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $output -Recurse -Force -ErrorAction SilentlyContinue
New-Item $stage -ItemType Directory | Out-Null
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required on the Windows build runner." }
if (-not (Test-Path $InnoSetup)) { throw "Inno Setup compiler not found: $InnoSetup" }
Push-Location $root
try { npm ci; npm run build; npm prune --omit=dev } finally { Pop-Location }
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
Remove-Item "$stage\app\scripts\windows" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$root\supabase" "$stage\app\supabase" -Recurse
& $InnoSetup "$root\installer\windows\CyberpunkRedCalculator.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE." }
if (-not (Test-Path (Join-Path $output "CyberpunkRedCalculator-Setup.exe"))) {
  throw "Inno Setup completed without creating the expected installer artifact."
}
