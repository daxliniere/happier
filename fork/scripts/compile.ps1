# Compiles the shared workspace packages (the build-enforcing lane every deliverable depends on).
# A build-required change must be followed by a version bump first: use -Bump.
param([switch]$Bump)
$ErrorActionPreference = 'Stop'

$root = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
Set-Location -LiteralPath $root
if ($Bump) { Write-Output "Version: $(& (Join-Path $PSScriptRoot 'bump-version.ps1'))" }
& yarn -s build:packages
if ($LASTEXITCODE -ne 0) { throw 'build:packages failed.' }
Write-Output 'Compile OK.'
