# Bumps the fork build number in fork/VERSION by one increment and prints the new value.
# The upstream package versions are deliberately left alone (avoids merge conflicts with upstream).
$ErrorActionPreference = 'Stop'

$root = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$file = Join-Path $root 'fork/VERSION'
$current = (Get-Content -LiteralPath $file -Raw -Encoding UTF8).Trim()
if ($current -notmatch '^(.*\.)(\d+)$') { throw "fork/VERSION must end in a build number, found '$current'." }
$next = $Matches[1] + ([int]$Matches[2] + 1)
[IO.File]::WriteAllText($file, "$next`n", (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText((Join-Path $root 'fork/build-version.json'), "{`"version`":`"$next`"}`n", (New-Object Text.UTF8Encoding($false)))
Write-Output $next
