#!/usr/bin/env bash
# Local release runner. Compiler/package/signing owners remain the checkout's
# existing scripts. Never merges, bumps, commits, uploads, deploys or restarts.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: !build-linux-android.sh --repo CHECKOUT [--detach] [--only all|linux|android]
       [--output NEW_DIRECTORY] [--install] [--check]

Builds Linux x64 server + CLI and Sadder APK + signed AAB, sequentially.
--repo      Integrated, committed checkout to build (required; no branch guessing).
--detach    Run as a user systemd job, surviving terminal/agent disconnection.
--only      Build all (default), linux, or android.
--output    New results directory; default CHECKOUT/dist/fork-builds/all-VERSION-TIME.
--install   Run yarn install --frozen-lockfile first. Otherwise deps must exist.
--check     Check prerequisites and version metadata without building or writing.

Logs, RESULT.txt and SHA256SUMS go in the results directory. Failures return
nonzero; independent stages continue. Existing results are never overwritten.
Android uses SADDER_KEY_DIR; no passwords are printed. Nothing is published.
EOF
}
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "Missing tool: $1"; }
repo= output= only=all detach=0 install=0 check=0
while (($#)); do
  case "$1" in
    --repo|--output|--only)
      (($# >= 2)) || die "Missing value after $1"
      case "$1" in --repo) repo=$2;; --output) output=$2;; --only) only=$2;; esac
      shift 2;;
    --detach) detach=1; shift;;
    --install) install=1; shift;;
    --check) check=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "Unknown argument: $1 (use --help)";;
  esac
done
[[ -n "$repo" ]] || { usage >&2; exit 2; }
[[ "$only" == all || "$only" == linux || "$only" == android ]] || die "Invalid --only: $only"
repo=$(cd "$repo" && pwd -P)
export PATH="$PATH:$HOME/.local/bin"
for tool in git node yarn sha256sum flock find tar gzip realpath sort xargs; do need "$tool"; done
[[ "$(git -C "$repo" rev-parse --show-toplevel)" == "$repo" ]] || die "--repo must be a checkout root"
version=$(cat "$repo/fork/VERSION")
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$repo/dist/fork-cache}"
[[ "$version" =~ ^0\.2\.[0-9]+-fork\.[0-9]+$ ]] || die "Invalid fork/VERSION: $version"
node --input-type=module - "$repo/fork/build-version.json" "$version" <<'JS'
import { readFileSync } from 'node:fs';
const metadata = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (metadata.version !== process.argv[3] || !metadata.release) {
  throw new Error('fork/VERSION and fork/build-version.json must agree before building');
}
JS
[[ -z "$(git -C "$repo" status --porcelain --untracked-files=normal)" ]] || die "Checkout has uncommitted work. Integrate/commit it before a release build."
[[ -d "$repo/node_modules" && ! -L "$repo/node_modules" || "$install" == 1 ]] || die "Use --install for a checkout with missing/shared-symlink dependencies"
if [[ "$only" != android ]]; then
  need bun
  [[ "$(bun --version)" == 1.4.4 ]] || die "Linux releases require Bun 1.4.4"
fi
if [[ "$only" != linux ]]; then
  export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
  export ANDROID_HOME="${ANDROID_HOME:-/GGGG/projects/.tools/android-sdk}"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  export SADDER_KEY_DIR="${SADDER_KEY_DIR:-/GGGG/projects/CONCIERGE/HAPPIER/.release-private/sadder}"
  export PATH="$JAVA_HOME/bin:$PATH"
  need java; need jarsigner; need python3
  [[ -r "$SADDER_KEY_DIR/sadder-upload.p12" && -r "$SADDER_KEY_DIR/sadder-upload.password" ]] || die "Missing Android signing files in SADDER_KEY_DIR"
  [[ -f "$repo/fork/scripts/android-build.sh" ]] || die "Checkout has no fork/scripts/android-build.sh"
  apksigners=("$ANDROID_HOME"/build-tools/*/apksigner)
  apksigner=${apksigners[${#apksigners[@]}-1]}
  [[ -x "$apksigner" ]] || die "Android SDK apksigner not found"
fi
printf 'Source: %s\nVersion: %s\nCommit: %s\n' "$repo" "$version" "$(git -C "$repo" rev-parse HEAD)"
if [[ "$check" == 1 ]]; then echo 'Prerequisites OK. No build started.'; exit 0; fi
if [[ -z "$output" ]]; then output="$repo/dist/fork-builds/all-$version-$(date -u +%Y%m%d-%H%M%S)-$$"; fi
output=$(realpath -m "$output")
if [[ "$detach" == 1 ]]; then
  need systemd-run
  args=(--repo "$repo" --output "$output" --only "$only")
  [[ "$install" == 0 ]] || args+=(--install)
  unit="happier-build-$(date -u +%Y%m%d-%H%M%S)-$$"
  systemd-run --user --unit="$unit" --collect --working-directory="$repo" \
    --setenv="PATH=$PATH" --setenv="JAVA_HOME=${JAVA_HOME:-}" \
    --setenv="ANDROID_HOME=${ANDROID_HOME:-}" --setenv="SADDER_KEY_DIR=${SADDER_KEY_DIR:-}" \
    --setenv="XDG_CACHE_HOME=$XDG_CACHE_HOME" \
    /bin/bash "$(realpath "${BASH_SOURCE[0]}")" "${args[@]}"
  printf '\nBuild launched. Results: %s\nFollow: journalctl --user -fu %s\nStop: systemctl --user stop %s\n' "$output" "$unit" "$unit"
  exit 0
fi

cd "$repo"
# One runner per checkout: the existing builders write fixed dist/release-assets paths.
exec 9>"$(git rev-parse --git-path fork-local-build.lock)"
flock -n 9 || die "A build runner already holds this checkout's build lock"
[[ ! -e "$output" ]] || die "Output exists; choose a NEW directory: $output"
mkdir -p "$output/logs"
summary="$output/RESULT.txt"
printf 'RUNNING\nSource: %s\nVersion: %s\nCommit: %s\nStarted: %s\n' \
  "$repo" "$version" "$(git rev-parse HEAD)" "$(date -Is)" > "$summary"
trap 'rc=$?; if ((rc != 0)); then printf "\nFAILED or interrupted (exit %s)\n" "$rc" >> "$summary"; fi' EXIT
failed=0
stage() {
  local name=$1 rc=0; shift
  printf '\n== %s (%s)\n' "$name" "$(date -Is)"
  "$@" > "$output/logs/$name.log" 2>&1 || rc=$?
  printf '%s: exit %s; log %s\n' "$name" "$rc" "$output/logs/$name.log" | tee -a "$summary"
  return "$rc"
}
collect_linux() {
  local component=$1 stamp=$2 required=$3 file count=0
  local source="$repo/dist/release-assets/$component"
  [[ -d "$source" ]] || return 1
  mkdir -p "$output/$component"
  # Never accept an earlier archive when a broken build exits successfully.
  for file in "$source"/*-linux-x64.tar.gz; do
    [[ -f "$file" && "$file" -nt "$stamp" ]] || continue
    cp -p "$file" "$output/$component/"
    [[ "$(basename "$file")" != "$required"-v*-linux-x64.tar.gz ]] || count=$((count+1))
  done
  ((count > 0)) || return 1
  local checksums=("$source"/checksums-*.txt)
  [[ -f "${checksums[0]}" ]] || return 1
  for file in "${checksums[@]}"; do
    [[ "$file" -nt "$stamp" ]] || continue
    cp -p "$file" "$output/$component/"
  done
  (cd "$output/$component"; for file in checksums-*.txt; do sha256sum -c "$file" --ignore-missing || exit 1; done)
}
if [[ "$install" == 1 ]]; then
  [[ ! -L node_modules ]] || die "node_modules links to another checkout; use a checkout with its own install"
  stage install yarn install --frozen-lockfile || exit 1
fi
stage packages yarn -s build:packages || exit 1
if [[ "$only" != android ]]; then
  for component in server cli; do
    stamp="$output/logs/$component.started"; touch "$stamp"
    if stage "$component" yarn -s "release:build:binaries:$component" --channel preview --targets linux-x64; then
      product=happier; [[ "$component" != server ]] || product=happier-server
      if ! collect_linux "$component" "$stamp" "$product" >> "$output/logs/$component.log" 2>&1; then
        printf '%s: FAILED artifact freshness/checksum verification\n' "$component" | tee -a "$summary"
        failed=1
      fi
    else failed=1; fi
  done
fi
if [[ "$only" != linux ]]; then
  export HAPPIER_FORK_BUILDS_DIR="$output/android"
  export SENTRY_DISABLE_AUTO_UPLOAD=true
  export CI=1
  if stage android bash "$repo/fork/scripts/android-build.sh"; then
    apks=("$output"/android/*/Sadder-debugsigned.apk)
    aabs=("$output"/android/*/Sadder-upload-signed.aab)
    if [[ ${#apks[@]} != 1 || ${#aabs[@]} != 1 || ! -s "${apks[0]}" || ! -s "${aabs[0]}" ]] ||
      ! "$apksigner" verify "${apks[0]}" >> "$output/logs/android.log" 2>&1 ||
      ! jarsigner -verify "${aabs[0]}" >> "$output/logs/android.log" 2>&1; then
      echo 'android: FAILED artifact/signature verification' | tee -a "$summary"; failed=1
    fi
  else failed=1; fi
fi
if ! (cd "$output"; find . -type f \( -name '*.tar.gz' -o -name '*.apk' -o -name '*.aab' \) -print0 |
  sort -z | xargs -0 -r sha256sum > SHA256SUMS); then failed=1; fi
if ((failed == 0)); then result=SUCCESS; else result=FAILED; fi
printf '\n%s\nFinished: %s\nResults: %s\n' "$result" "$(date -Is)" "$output" | tee -a "$summary"
exit "$failed"
