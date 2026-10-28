# Builds the unsigned Windows "Happier (dev)" installer on a GitHub Actions Windows runner in the fork
# and downloads it. Needs `gh` signed in. The ref must already be pushed to the fork.
#   !build-windows-exe.bat [branch-or-sha]    (default: the current branch)
# Downloads to $env:HAPPIER_FORK_BUILDS_DIR, default <repo>/dist/fork-builds. Nothing is published.
param([string]$Ref = '')
$ErrorActionPreference = 'Stop'

$root = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
Set-Location -LiteralPath $root
if (-not $Ref) { $Ref = (& git rev-parse --abbrev-ref HEAD).Trim() }
$repo = 'daxliniere/happier'
$workflow = 'build-windows-dev.yml'

& gh workflow run $workflow --repo $repo --ref dev -f "source_ref=$Ref"
if ($LASTEXITCODE -ne 0) { throw 'Could not dispatch the workflow. Is the ref pushed to the fork?' }
Start-Sleep -Seconds 15
$runId = (& gh run list --repo $repo --workflow $workflow --limit 1 --json databaseId --jq '.[0].databaseId').Trim()
Write-Output "Run $runId building '$Ref' ..."
& gh run watch $runId --repo $repo --exit-status
if ($LASTEXITCODE -ne 0) { throw "Run $runId failed: gh run view $runId --repo $repo --log-failed" }

$builds = if ($env:HAPPIER_FORK_BUILDS_DIR) { $env:HAPPIER_FORK_BUILDS_DIR } else { Join-Path $root 'dist/fork-builds' }
$out = Join-Path $builds "windows-$runId"
New-Item -ItemType Directory -Force -Path $out | Out-Null
& gh run download $runId --repo $repo -n happier-windows-dev-nsis -D $out
if ($LASTEXITCODE -ne 0) { throw 'Artifact download failed.' }
Get-ChildItem -LiteralPath $out -Filter '*.exe' |
    ForEach-Object { '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLower(), $_.FullName }
