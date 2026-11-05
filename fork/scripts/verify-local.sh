#!/usr/bin/env bash
# Development checks only. Existing pipeline owns test/compiler selection.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: !verify-local.sh [--repo CHECKOUT] [--checks unit,typecheck]
                       [--output NEW_DIRECTORY] [--dry-run]

Runs local checks without an agent. Default checkout is this script's checkout.
Checks: unit, typecheck, integration (comma-separated; defaults: unit,typecheck).
Uses installed dependencies; does not install, invoke providers, build release
packages, merge, bump, commit, push, deploy or restart services.

Saves inventory.log, diff.log, checks.log and RESULT.txt under a new directory
in CHECKOUT/dist/local-verification by default. Exit 0 means selected checks
passed, not release readiness. The inventory lists ALL local branches and
worktrees for human assessment, including unrelated and already replaced work.
--dry-run prints the selected pipeline plan without creating result files.

Examples:
  ./!verify-local.sh
  ./!verify-local.sh --repo /path/to/rc5 --checks typecheck
  ./!verify-local.sh --checks unit,typecheck,integration
EOF
}

fail() { printf '%s\n' "$*" >&2; exit 2; }
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
checks=unit,typecheck
output=
dry_run=false
while (($#)); do
  case "$1" in
    --repo|--checks|--output)
      (($# >= 2)) && [[ -n "$2" ]] || fail "$1 requires a value"
      case "$1" in
        --repo) repo=$2 ;;
        --checks) checks=$2 ;;
        --output) output=$2 ;;
      esac
      shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
[[ "$checks" != ,* && "$checks" != *, && "$checks" != *,,* ]] || fail 'Empty check name'
IFS=, read -r -a selected <<< "$checks"
for check in "${selected[@]}"; do
  case "$check" in unit|typecheck|integration) ;; *) fail "Unsupported check: $check" ;; esac
done
cd -- "$repo"
repo=$(git rev-parse --show-toplevel)
cd -- "$repo"
[[ -x apps/stack/bin/hstack-exec && -f scripts/pipeline/run.mjs ]] || fail 'Not a Happier checkout'
command -v node >/dev/null || fail 'Node is required'
command=(./apps/stack/bin/hstack-exec -- node scripts/pipeline/run.mjs checks
  --profile custom --custom-checks "$checks" --install-deps false)
if $dry_run; then
  "${command[@]}" --dry-run
  exit
fi

if [[ -n "$output" ]]; then
  mkdir -- "$output" || fail 'Output must be a new directory with an existing parent'
else
  mkdir -p -- dist/local-verification
  output=$(mktemp -d "$repo/dist/local-verification/run-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
fi
output=$(cd -- "$output" && pwd)
printf 'Results: %s\n' "$output"
printf 'RUNNING — not yet passed\n' > "$output/RESULT.txt"
trap 'printf "INTERRUPTED — checks incomplete\n" > "$output/RESULT.txt"; exit 130' INT
trap 'printf "INTERRUPTED — checks incomplete\n" > "$output/RESULT.txt"; exit 143' TERM

inventory() {
  printf 'Checkout: %s\n' "$repo"
  git log -1 --format='%h %s'
  if [[ -f fork/VERSION ]]; then cat fork/VERSION; fi
  printf '\nWorktrees (including uncommitted files):\n'
  local field path branch
  # -z preserves paths with spaces, quotes and backslashes.
  while IFS= read -r -d '' field; do
    if [[ "$field" == 'worktree '* ]]; then
      path=${field#worktree }
      printf '\n%s\n' "$path"
      git -C "$path" status --short --branch || return
    fi
  done < <(git worktree list --porcelain -z)
  printf '\nBranch patches compared with current HEAD (+ absent, - equivalent):\n'
  while IFS= read -r branch; do
    printf '\n%s\n' "$branch"
    git cherry HEAD "$branch" || return
  done < <(git for-each-ref --format='%(refname:short)' refs/heads/)
}

failed=0
if inventory > "$output/inventory.log" 2>&1; then
  printf 'PASS inventory collection\n' > "$output/RESULT.txt"
else
  printf 'FAIL inventory collection\n' > "$output/RESULT.txt"
  failed=1
fi
if { git diff --check && git diff --cached --check; } > "$output/diff.log" 2>&1; then
  printf 'PASS working/staged diff check\n' >> "$output/RESULT.txt"
else
  printf 'FAIL working/staged diff check\n' >> "$output/RESULT.txt"
  failed=1
fi
printf 'Running %s; details in checks.log\n' "$checks"
if "${command[@]}" > "$output/checks.log" 2>&1; then
  printf 'PASS selected automated checks: %s\n' "$checks" >> "$output/RESULT.txt"
else
  status=$?
  printf 'FAIL checks (exit %s): %s\n' "$status" "$checks" >> "$output/RESULT.txt"
  failed=1
fi
printf 'Inventory requires assessment; device QA and release builds are separate.\n' >> "$output/RESULT.txt"
if ((failed)); then
  printf 'OVERALL: FAIL\n' >> "$output/RESULT.txt"
else
  printf 'OVERALL: PASS (selected checks only)\n' >> "$output/RESULT.txt"
fi
cat "$output/RESULT.txt"
exit "$failed"
