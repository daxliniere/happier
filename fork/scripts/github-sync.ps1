# Commits the full worktree (including untracked files) to the current branch and pushes it.
# The commit message is the fork version, optionally followed by custom wording:
#   !github-sync.bat "READY TO GO! (needs more SFX)"  ->  0.2.19-fork.4 READY TO GO! (needs more SFX)
# If there are changes to commit and the version has not been bumped since HEAD, it bumps first.
param([string]$Message = '')
$ErrorActionPreference = 'Stop'

$root = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
Set-Location -LiteralPath $root
$versionPath = 'fork/VERSION'

function Read-Version { (Get-Content -LiteralPath (Join-Path $root $versionPath) -Raw -Encoding UTF8).Trim() }

$dirty = (& git status --porcelain)
if ($dirty) {
    $versionAtHead = (& git show "HEAD:$versionPath" 2>$null)
    if ($LASTEXITCODE -ne 0) { $versionAtHead = '' }
    if ((Read-Version) -eq ([string]$versionAtHead).Trim()) {
        & (Join-Path $PSScriptRoot 'bump-version.ps1') | Out-Null
    }
    $version = Read-Version
    $subject = if ($Message.Trim()) { "$version $($Message.Trim())" } else { $version }
    & git add -A
    & git commit -m $subject
    if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }
}
& git push -u origin HEAD
if ($LASTEXITCODE -ne 0) { throw 'git push failed.' }
Write-Output "Synced $(& git rev-parse --abbrev-ref HEAD) at $(Read-Version)"
