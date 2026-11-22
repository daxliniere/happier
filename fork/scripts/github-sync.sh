#!/usr/bin/env bash
# Linux counterpart to github-sync.ps1. Commits the full worktree (including untracked files) to the
# current branch and pushes it to origin. The commit message is the fork version, optionally followed
# by custom wording:
#   !github-sync.sh "READY TO GO! (needs more SFX)"  ->  0.2.21-beta1.2 READY TO GO! (needs more SFX)
# If there are changes to commit and the version has not been bumped since HEAD, it bumps first.
# --dry-run prints what would happen and changes nothing (no bump, no commit, no push).
set -euo pipefail

dry=0 message=()
while (($#)); do
  case "$1" in
    --dry-run) dry=1; shift;;
    -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0;;
    *) message+=("$1"); shift;;
  esac
done
custom="${message[*]-}"
custom="${custom#"${custom%%[![:space:]]*}"}"
custom="${custom%"${custom##*[![:space:]]}"}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(git -C "$here" rev-parse --show-toplevel)"
cd "$root"
version_path='fork/VERSION'
read_version() { tr -d '[:space:]' < "$root/$version_path"; }

branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" != HEAD ]] || die 'HEAD is detached; check out a branch before syncing.'

# Version a commit would carry, and whether it needs the bump first.
bump_needed=0
version="$(read_version)"
dirty="$(git status --porcelain --untracked-files=all)"
if [[ -n "$dirty" ]]; then
  at_head="$(git show "HEAD:$version_path" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "$version" == "$at_head" ]]; then
    bump_needed=1
    if [[ "$version" =~ ^(.*\.)([0-9]+)$ ]]; then
      version="${BASH_REMATCH[1]}$((10#${BASH_REMATCH[2]} + 1))"
    else
      die "fork/VERSION must end in a build number, found '$version'."
    fi
  fi
fi
subject="$version"
[[ -z "$custom" ]] || subject="$version $custom"

if ((dry)); then
  if [[ -n "$dirty" ]]; then
    printf 'Branch: %s\nChanges that would be committed:\n%s\n' "$branch" "$dirty"
    ((bump_needed)) && printf 'Would bump fork/VERSION first.\n'
    printf 'Would commit as: %s\n' "$subject"
  else
    printf 'Branch: %s\nNothing to commit.\n' "$branch"
  fi
  printf 'Would push: git push -u origin HEAD\n'
  exit 0
fi

if [[ -n "$dirty" ]]; then
  if ((bump_needed)); then bash "$here/bump-version.sh" >/dev/null; fi
  version="$(read_version)"
  subject="$version"
  [[ -z "$custom" ]] || subject="$version $custom"
  git add -A
  git commit -q -m "$subject" || die 'git commit failed.'
fi
git push -q -u origin HEAD || die 'git push failed.'
printf 'Synced %s at %s\n' "$(git rev-parse --abbrev-ref HEAD)" "$(read_version)"
