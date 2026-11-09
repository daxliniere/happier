#!/usr/bin/env bash
# CT100 counterpart to build-windows-exe.ps1. Builds the unsigned Windows "Happier (dev)" installer on a
# GitHub Actions Windows runner in the fork and downloads it. Needs `gh` signed in. The ref must already
# be pushed to the fork. Nothing is published.
#   !build-windows-exe.sh [branch-or-sha]    (default: the current branch)
# Downloads to $HAPPIER_FORK_BUILDS_DIR, default <repo>/dist/fork-builds.
set -euo pipefail

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$root"
ref="${1:-$(git rev-parse --abbrev-ref HEAD)}"
repo='daxliniere/happier'
workflow='build-windows-dev.yml'

# Remember the newest existing run, so the dispatched run is identified rather than guessed.
previous="$(gh run list --repo "$repo" --workflow "$workflow" --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
gh workflow run "$workflow" --repo "$repo" --ref dev -f "source_ref=$ref" \
  || { echo 'Could not dispatch the workflow. Is the ref pushed to the fork?' >&2; exit 1; }
run_id=''
for _ in $(seq 1 30); do
  sleep 5
  run_id="$(gh run list --repo "$repo" --workflow "$workflow" --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
  [[ "$run_id" != "$previous" && "$run_id" != 0 ]] && break
  run_id=''
done
[[ -n "$run_id" ]] || { echo 'The dispatched run did not appear within 150 s.' >&2; exit 1; }
echo "Run $run_id building '$ref' ..."
gh run watch "$run_id" --repo "$repo" --exit-status \
  || { echo "Run $run_id failed: gh run view $run_id --repo $repo --log-failed" >&2; exit 1; }

builds="${HAPPIER_FORK_BUILDS_DIR:-$root/dist/fork-builds}"
out="$builds/windows-$run_id"
mkdir -p "$out"
gh run download "$run_id" --repo "$repo" -n happier-windows-dev-nsis -D "$out" \
  || { echo 'Artifact download failed.' >&2; exit 1; }
find "$out" -maxdepth 1 -name '*.exe' -print0 | xargs -0 -r sha256sum
