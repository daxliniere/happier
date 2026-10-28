# Builds the Linux x64 server and CLI binaries (needs Bun 1.4.4 on PATH) and prints their SHA-256.
# Output: dist/release-assets/{server,cli}. Nothing is uploaded.
$ErrorActionPreference = 'Stop'

$root = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
Set-Location -LiteralPath $root
foreach ($component in 'server', 'cli') {
    & yarn -s "release:build:binaries:$component" --channel preview --targets linux-x64
    if ($LASTEXITCODE -ne 0) { throw "release:build:binaries:$component failed." }
}
Get-ChildItem -LiteralPath (Join-Path $root 'dist/release-assets') -Recurse -Filter '*.tar.gz' |
    ForEach-Object { '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLower(), $_.FullName }
