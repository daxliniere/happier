#!/usr/bin/env bash
# CT100-compatible counterpart to bump-version.ps1. Upstream package versions
# remain unchanged; only the fork build metadata and embedded CLI labels move.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
version_file="$root/fork/VERSION"
current="$(<"$version_file")"
if [[ ! "$current" =~ ^(.*\.)([0-9]+)$ ]]; then
  printf "fork/VERSION must end in a build number, found '%s'.\n" "$current" >&2
  exit 1
fi
prefix="${BASH_REMATCH[1]}"
number="${BASH_REMATCH[2]}"
next="${prefix}$((10#$number + 1))"
release="$(<"$root/fork/RELEASE")"

printf '%s\n' "$next" > "$version_file"
node - "$root" "$next" "$release" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [root, version, release] = process.argv.slice(2);
fs.writeFileSync(
  path.join(root, 'fork/build-version.json'),
  `${JSON.stringify({ version, release })}\n`,
  'utf8',
);

// Keep the CLI label package-local: the release build compiles a temporary copy.
const cliPath = path.join(root, 'apps/cli/package.json');
const manifest = JSON.parse(fs.readFileSync(cliPath, 'utf8'));
manifest.happierForkVersion = version;
manifest.happierForkRelease = release;
fs.writeFileSync(cliPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
NODE

printf '%s\n' "$next"
