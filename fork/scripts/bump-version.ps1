# Bumps the fork build number in fork/VERSION by one increment and prints the new value.
# The upstream package versions are deliberately left alone (avoids merge conflicts with upstream).
$ErrorActionPreference = 'Stop'

$root = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$file = Join-Path $root 'fork/VERSION'
$current = (Get-Content -LiteralPath $file -Raw -Encoding UTF8).Trim()
if ($current -notmatch '^(.*\.)(\d+)$') { throw "fork/VERSION must end in a build number, found '$current'." }
$next = $Matches[1] + ([int]$Matches[2] + 1)
[IO.File]::WriteAllText($file, "$next`n", (New-Object Text.UTF8Encoding($false)))
$release = (Get-Content -LiteralPath (Join-Path $root 'fork/RELEASE') -Raw -Encoding UTF8).Trim()
[IO.File]::WriteAllText((Join-Path $root 'fork/build-version.json'), ((@{ version = $next; release = $release } | ConvertTo-Json -Compress) + "`n"), (New-Object Text.UTF8Encoding($false)))
# Keep the CLI's embedded label package-local: its build compiles a temporary source copy.
$cliManifestPath = Join-Path $root 'apps/cli/package.json'
$cliManifest = Get-Content -LiteralPath $cliManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$cliManifest | Add-Member -NotePropertyName happierForkVersion -NotePropertyValue $next -Force
$cliManifest | Add-Member -NotePropertyName happierForkRelease -NotePropertyValue $release -Force
[IO.File]::WriteAllText($cliManifestPath, (($cliManifest | ConvertTo-Json -Depth 100) + "`n"), (New-Object Text.UTF8Encoding($false)))
Write-Output $next
