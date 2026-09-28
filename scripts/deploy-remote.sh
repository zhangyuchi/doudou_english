#!/usr/bin/env bash
# Manage only a marked application root; stdin is a locally validated dist tar.gz.
# One session owns the lock through extraction and atomic current switching.
set -euo pipefail
umask 022

# Report a recoverable deployment failure to the invoking SSH client.
fail() { printf '部署错误：%s\n' "$*" >&2; exit 1; }
# Keep version names confined to one non-hidden releases child directory.
valid_version() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; }

[[ $# -eq 3 ]] || fail '需要 action remoteDir version 三个参数。'
action=$1
deploy_root=$2
version=$3
[[ "$action" == deploy || "$action" == list || "$action" == rollback ]] || fail '未知动作。'
[[ "$action" == list ]] || valid_version "$version" || fail '非法版本标识。'
[[ "$deploy_root" =~ ^/([A-Za-z0-9_-][A-Za-z0-9._-]*/)+[A-Za-z0-9_-][A-Za-z0-9._-]*$ ]] || fail '需要受限的应用专用绝对路径。'
case "$deploy_root" in
  /|/srv|/var|/var/www|/home|/root|/opt|/tmp|/usr|/etc|/run|/boot|/dev|/proc|/sys) fail '拒绝宽泛目录。' ;;
  /etc/*|/usr/*|/bin/*|/sbin/*|/boot/*|/dev/*|/proc/*|/sys/*|/run/*) fail '拒绝系统目录。' ;;
esac
[[ ! "$deploy_root" =~ ^/home/[^/]+$ ]] || fail '不能使用用户家目录本身。'
[[ "$(realpath -m -- "$deploy_root")" == "$deploy_root" ]] || fail '路径或其父目录不能是符号链接。'
[[ "$deploy_root" != "$(realpath -m -- "$HOME")" ]] || fail '不能使用当前用户家目录。'

marker="$deploy_root/.doudou-english-deploy"
releases="$deploy_root/releases"
current="$deploy_root/current"
lock="$deploy_root/.deploy-lock"

# Validate the owned layout before acquiring the lock and again while holding it.
# The marker authorizes this layout, not arbitrary files or redirected paths.
check_layout() {
  [[ -d "$deploy_root" && ! -L "$deploy_root" ]] || fail '部署根目录不是实际目录。'
  [[ -f "$marker" && ! -L "$marker" && "$(cat -- "$marker")" == doudou-english-v1 ]] || fail '目录未由本脚本管理或标记无效。'
  [[ -d "$releases" && ! -L "$releases" ]] || fail 'releases 必须是实际目录。'
  if [[ -e "$current" || -L "$current" ]]; then
    [[ -L "$current" ]] || fail 'current 不是符号链接，拒绝覆盖。'
    local target
    target=$(readlink -- "$current")
    [[ "$target" == releases/* ]] && valid_version "${target#releases/}" || fail 'current 指向管理范围外。'
    check_release "${target#releases/}"
  fi
}

# Validate a version for activation or rollback without modifying it.
# Only a completed, non-redirected version can be activated or rolled back to.
check_release() {
  local dir="$releases/$1"
  [[ -d "$dir" && ! -L "$dir" ]] || fail '版本不存在或是符号链接。'
  [[ -s "$dir/index.html" && ! -L "$dir/index.html" ]] || fail '版本缺少有效 index.html。'
  [[ -f "$dir/.release-complete" && ! -L "$dir/.release-complete" && "$(cat -- "$dir/.release-complete")" == "$1" ]] || fail '版本尚未完整发布。'
}

if [[ "$action" == list ]]; then
  check_layout
  if [[ -L "$current" ]]; then printf 'CURRENT %s\n' "$(readlink -- "$current" | cut -d/ -f2)"; else printf 'CURRENT none\n'; fi
  shopt -s nullglob
  for dir in "$releases"/*; do
    name=${dir##*/}
    valid_version "$name" || continue
    if [[ -d "$dir" && ! -L "$dir" && -s "$dir/index.html" && ! -L "$dir/index.html" && -f "$dir/.release-complete" && ! -L "$dir/.release-complete" && "$(cat -- "$dir/.release-complete")" == "$name" ]]; then
      printf 'READY %s\n' "$name"
    else
      printf 'INCOMPLETE %s\n' "$name"
    fi
  done
  exit 0
fi

if [[ "$action" == deploy && ! -e "$marker" && ! -L "$marker" ]]; then
  if [[ -e "$deploy_root" || -L "$deploy_root" ]]; then
    [[ -d "$deploy_root" && ! -L "$deploy_root" ]] || fail '部署根目录类型错误。'
    [[ -z "$(find "$deploy_root" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail '非空未标记目录，拒绝接管。'
  else
    mkdir -p -- "$deploy_root"
  fi
else
  check_layout
fi

mkdir -- "$lock" 2>/dev/null || fail '发布锁已存在：确认没有发布进程后按文档处理，不自动删除。'
pending_link=""
# Normal exits release only our empty lock and, if present, our own temporary link.
cleanup() {
  if [[ -n "$pending_link" && -L "$pending_link" ]]; then unlink -- "$pending_link"; fi
  rmdir -- "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

if [[ ! -e "$marker" && ! -L "$marker" ]]; then
  [[ -z "$(find "$deploy_root" -mindepth 1 -maxdepth 1 ! -name .deploy-lock -print -quit)" ]] || fail '目录在加锁前被修改，拒绝接管。'
  mkdir -- "$releases"
  printf 'doudou-english-v1\n' > "$marker"
fi
check_layout

if [[ "$action" == deploy ]]; then
  release_dir="$releases/$version"
  mkdir -- "$release_dir" || fail '版本已经存在，不覆盖。'
  tar -xzf - --no-same-owner --no-same-permissions -C "$release_dir"
  [[ -z "$(find "$release_dir" -type l -print -quit)" ]] || fail '版本包含符号链接，拒绝激活。'
  [[ -s "$release_dir/index.html" && ! -L "$release_dir/index.html" ]] || fail '归档缺少有效 index.html。'
  printf '%s\n' "$version" > "$release_dir/.release-complete"
fi
check_release "$version"
next_link="$deploy_root/.current-$version-$$"
ln -sT -- "releases/$version" "$next_link"
# Cleanup ownership starts only after creation; an existing conflicting path stays untouched.
pending_link="$next_link"
mv -Tf -- "$pending_link" "$current"
pending_link=""
printf 'CURRENT %s\n' "$version"
