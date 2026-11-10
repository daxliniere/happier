#!/usr/bin/env bash
# Four thin project launchers share this dispatcher. Existing backup/deploy tools
# remain the only owners of archive creation, installation and database restore.
set -euo pipefail
umask 077
project=${1:?Expected project directory}; action=${2:?Expected action}; shift 2
project=$(cd "$project" && pwd -P)
usage() {
  cat <<'EOF'
!backup.sh [--foreground]                  Full Happier + Codex + Claude backup; once
                                           verified, it deletes the previous full backups
!delete-old-backups.sh [--dry-run] [--yes] Keep newest verified full backup
!install-linux.sh BUILD_DIR [VERSION]     Install server + CLI from a build
!rollback-linux.sh [BACKUP_DIR]           Restore relay/database + CLI link

Install reads VERSION from the build runner's RESULT.txt, or requires an explicit
0.2.N-fork.M for legacy release-assets folders. It requires a verified full backup.
Rollback defaults to the newest completed full backup. Provider histories are
backed up but are not overwritten by this Linux-component rollback.

Backup/install/rollback use detached user systemd jobs by default; --foreground
keeps them in this terminal. --dry-run previews without executing a job or changing
services/files. Install, rollback and deletion ask for 'yes'; --yes skips that.
--backup DIR selects an exact install rollback point. BACKUP_ROOT overrides
~/happier-backups. Logs go to <project>/builds/maintenance/.
EOF
}
dry=0 foreground=0 yes=0 backup=${FULL_BACKUP:-} positional=()
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0;;
    --dry-run) dry=1; shift;;
    --foreground) foreground=1; shift;;
    --yes) yes=1; shift;;
    --backup) (($# >= 2)) || { echo 'Missing --backup value' >&2; exit 2; }; backup=$2; shift 2;;
    --*) echo "Unknown option: $1" >&2; exit 2;;
    *) positional+=("$1"); shift;;
  esac
done
die() { echo "ERROR: $*" >&2; exit 1; }
case "$action" in backup|prune|install|rollback) ;; *) die "Unknown action: $action";; esac
confirm() {
  [[ "$yes" == 1 || "$dry" == 1 ]] && return
  local answer
  printf '%s\nType yes to continue: ' "$1"
  read -r answer || die 'No confirmation received; use --yes for an unattended command'
  [[ "$answer" == yes ]] || die 'Cancelled'
}
if [[ "$action" == install ]]; then
  ((${#positional[@]} >= 1 && ${#positional[@]} <= 2)) || die 'Give BUILD_DIR and optionally VERSION; see --help'
  release=$(cd "${positional[0]}" && pwd -P)
  version=${positional[1]:-}
  if [[ -f "$release/RESULT.txt" ]]; then
    grep -qx SUCCESS "$release/RESULT.txt" || die 'Build RESULT.txt does not report SUCCESS'
    recorded=$(sed -n 's/^Version: //p' "$release/RESULT.txt")
    [[ -z "$version" || "$version" == "$recorded" ]] || die 'Version differs from the build result'
    version=$recorded
  fi
  [[ "$version" =~ ^0\.2\.[0-9]+-fork\.[0-9]+$ ]] || die 'Supply VERSION for a legacy release-assets folder'
  [[ -d "$release/server" && -d "$release/cli" ]] || die 'Build folder needs server/ and cli/'
  confirm "Install $version from $release? The relay and daemon will restart."
elif [[ "$action" == rollback ]]; then
  ((${#positional[@]} <= 1)) || die 'Give at most one backup directory'
  backup=${positional[0]:-$backup}
  confirm 'Restore the relay/database and CLI link? Services restart; relay data returns to the selected snapshot.'
else
  ((${#positional[@]} == 0)) || die 'Unexpected positional argument'
fi
export BACKUP_ROOT="${BACKUP_ROOT:-$HOME/happier-backups}"
if [[ "$action" != prune && "$foreground" == 0 && "$dry" == 0 ]]; then
  command -v systemd-run >/dev/null || die 'systemd-run unavailable; use --foreground'
  logs="$project/builds/maintenance"
  mkdir -p "$logs"
  unit="happier-$action-$(date -u +%Y%m%d-%H%M%S)-$$"
  log="$logs/$unit.log"
  args=("$project" "$action" --foreground --yes)
  [[ -z "$backup" ]] || args+=(--backup "$backup")
  args+=("${positional[@]}")
  systemd-run --user --unit="$unit" --collect --working-directory="$project" \
    --property="StandardOutput=append:$log" --property="StandardError=append:$log" \
    --setenv="BACKUP_ROOT=$BACKUP_ROOT" --setenv="PATH=$PATH" \
    /bin/bash "$(realpath "${BASH_SOURCE[0]}")" "${args[@]}"
  printf 'Job: %s\nLog: %s\nFollow: tail -f "%s"\n' "$unit" "$log" "$log"
  exit 0
fi
if [[ ! -d "$BACKUP_ROOT" ]]; then
  if [[ "$action" == backup && "$dry" == 0 ]]; then mkdir -p "$BACKUP_ROOT";
  else die "Backup directory not found: $BACKUP_ROOT"; fi
fi
BACKUP_ROOT=$(cd "$BACKUP_ROOT" && pwd -P)
export BACKUP_ROOT
# Lock the directory itself, leaving no lockfile; all four entry points cooperate.
exec 9<"$BACKUP_ROOT"
flock -n 9 || die 'Another backup/cleanup/install/rollback job is running'
complete() {
  local path=$1 member
  [[ -d "$path" && ! -L "$path" && -f "$path/MANIFEST" && -f "$path/RESTORE.txt" && -f "$path/SHA256SUMS" ]] || return 1
  grep -q '^finished: ' "$path/MANIFEST" || return 1
  for member in happier-home.tar.gz codex-home.tar.gz claude-home.tar.gz systemd-user-units.tar.gz happier-server-light.sqlite; do
    [[ -f "$path/$member" ]] || return 1
  done
}
full_backups=()
for path in "$BACKUP_ROOT"/full-*; do
  [[ "$(basename "$path")" =~ ^full-[0-9]{8}-[0-9]{6}$ ]] || continue
  if complete "$path"; then full_backups+=("$path");
  elif [[ -e "$path" ]]; then printf 'Leaving incomplete/symlink backup alone: %s\n' "$path"; fi
done
# Names contain UTC/local timestamps written by full-backup.sh; sort by name.
if ((${#full_backups[@]})); then
  mapfile -t full_backups < <(printf '%s\n' "${full_backups[@]}" | LC_ALL=C sort)
fi
latest() {
  ((${#full_backups[@]})) || die 'No completed full backup; run !backup.sh first'
  printf '%s\n' "${full_backups[${#full_backups[@]}-1]}"
}
verify() {
  local path=$1 member
  complete "$path" || die "Not a completed full backup: $path"
  for member in happier-home.tar.gz codex-home.tar.gz claude-home.tar.gz systemd-user-units.tar.gz happier-server-light.sqlite; do
    awk -v file="$member" '$2 == file || $2 == "*"file {found=1} END {exit !found}' "$path/SHA256SUMS" || die "Checksum missing for $member"
  done
  (cd "$path" && sha256sum --strict -c SHA256SUMS) || die "Backup checksum verification failed: $path"
}
case "$action" in
  backup)
    if [[ "$dry" == 1 ]]; then echo "Would run full-backup.sh into $BACKUP_ROOT, then verify all five checksums"; exit 0; fi
    before=; ((${#full_backups[@]} == 0)) || before=$(latest)
    bash "$project/full-backup.sh"
    # Discover only the newly completed result, not an older successful archive.
    newest=
    for path in "$BACKUP_ROOT"/full-*; do
      [[ "$(basename "$path")" =~ ^full-[0-9]{8}-[0-9]{6}$ ]] || continue
      if complete "$path" && [[ "$path" > "$newest" ]]; then newest=$path; fi
    done
    [[ -n "$newest" && "$newest" != "$before" ]] || die 'Backup command produced no new completed backup'
    verify "$newest"
    printf 'BACKUP VERIFIED: %s\n' "$newest"
    # The verified new backup replaces every earlier completed one (owner decision 2026-11-10).
    # Incomplete or symlinked directories were never in full_backups and are left alone.
    for path in "${full_backups[@]}"; do
      [[ "$path" == "$newest" ]] && continue
      [[ "$(dirname "$path")" == "$BACKUP_ROOT" && ! -L "$path" ]] || die 'Backup path changed; refusing deletion'
      rm -rf -- "$path"
      printf 'DELETED PREVIOUS BACKUP: %s\n' "$path"
    done;;
  prune)
    keep=$(latest)
    verify "$keep"
    printf 'KEEP: %s\n' "$keep"
    for path in "${full_backups[@]}"; do [[ "$path" == "$keep" ]] || printf 'DELETE: %s\n' "$path"; done
    if [[ "$dry" == 1 || ${#full_backups[@]} == 1 ]]; then exit 0; fi
    confirm 'Delete ALL listed older full backups? Only the newest verified full backup will remain.'
    for path in "${full_backups[@]}"; do
      [[ "$path" == "$keep" ]] && continue
      [[ "$(dirname "$path")" == "$BACKUP_ROOT" && ! -L "$path" ]] || die 'Backup path changed; refusing deletion'
      rm -rf -- "$path"
    done
    echo 'OLDER FULL BACKUPS DELETED';;
  install|rollback)
    [[ -n "$backup" ]] || backup=$(latest)
    backup=$(cd "$backup" && pwd -P)
    verify "$backup"
    printf 'Rollback point: %s\n' "$backup"
    if [[ "$action" == install ]]; then
      env -u SERVER_TAR -u CLI_TAR YES=1 DRY_RUN="$dry" FULL_BACKUP="$backup" \
        RELEASE_DIR="$release" CLI_VERSION_NAME="$version" bash "$project/deploy-linux.sh" update
    else
      env YES=1 DRY_RUN="$dry" bash "$project/deploy-linux.sh" rollback "$backup"
    fi;;
esac
