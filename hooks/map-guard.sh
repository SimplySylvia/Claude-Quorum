#!/usr/bin/env bash
# PreToolUse hook: a map session plans and never builds.
#
# /quorum:map starts a map session with `quorum-map enter <session> <slug>`, which writes
# .tasks/.map-sessions/<session id> in the main working tree, and ends it with `quorum-map leave <session>`. For tool
# calls from that session (the input's session_id), it blocks (exit 2):
#   - Edit, Write, and NotebookEdit of a file in the repository outside .tasks/;
#   - Bash commands that write one (a > or >> redirect, tee, cp, mv, rm, truncate, ln, install, sed -i, perl -i);
#   - git commit, push, merge, rebase, reset, cherry-pick, revert, am, and apply, and quorum-branch start.
# A map's own files (.tasks/map-<slug>/: the map, its tickets, research, and prototypes) and files outside the
# repository are allowed. The map's Notes can't lift it: an agent writes the Notes, so a rule there would be the
# agent's own exemption. Not a sandbox: a script can hide what it writes.
#
# Without a map session, or on any failure to tell, it exits 0 at once. Bash 3.2 compatible.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"
# shellcheck source=hooks/shell-words.sh
. "$HERE/shell-words.sh"

input=$(cat 2>/dev/null || true)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
case "$tool" in Edit|Write|NotebookEdit|Bash) ;; *) exit 0 ;; esac
session=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
printf '%s' "$session" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_-]*$' || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
if [ -n "$cwd" ] && [ -d "$cwd" ]; then cd "$cwd" 2>/dev/null || exit 0; fi
MAIN=$("$BIN/quorum-active-task" --main 2>/dev/null) || exit 0
marker="$MAIN/.tasks/.map-sessions/$session"
[ -f "$marker" ] || exit 0
map=$(head -n 1 "$marker" | tr -d '[:space:]')
CODE=$("$BIN/quorum-active-task" --code 2>/dev/null) || CODE=$MAIN

phys() { (cd "$1" 2>/dev/null && pwd -P) || printf '%s\n' "$1"; }
TREES="$MAIN $CODE $(phys "$MAIN") $(phys "$CODE")"

# in_repo PATH: exit 0 if PATH is in the repository's working tree, outside its .tasks/. Prints it relative.
in_repo() {
  local p=$1 dir t
  p=${p#\"}; p=${p%\"}; p=${p#\'}; p=${p%\'}
  [ -n "$p" ] || return 1
  case "$p" in /*) ;; "~"*) return 1 ;; *) p="$(pwd)/$p" ;; esac
  dir=$(dirname "$p")
  [ -d "$dir" ] && p="$(cd "$dir" && pwd -P)/$(basename "$p")"
  for t in $TREES; do
    case "$p" in
      "$t"/.tasks|"$t"/.tasks/*) return 1 ;;
      "$t"|"$t"/*) printf '%s\n' "${p#"$t"/}"; return 0 ;;
    esac
  done
  return 1
}

block() {
  {
    echo "BLOCKED BY QUORUM: $1"
    echo "This session is working on the map '$map' (/quorum:map), which plans and never builds: it may write only under .tasks/."
    echo "When the map is cleared, its tasks start with /quorum:spec-and-eval --from-map $map <n>, or /quorum:run --map $map."
    echo "If the map session is over, end it first: quorum-map leave $session"
  } >&2
  exit 2
}

case "$tool" in
  Edit|Write|NotebookEdit)
    path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
    if rel=$(in_repo "$path"); then block "$tool $rel changes the repository."; fi ;;
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    while IFS= read -r stage; do
      if sub=$(git_subcommand "$stage"); then
        case "$sub" in commit|push|merge|rebase|reset|cherry-pick|revert|am|apply) block "git $sub changes the repository." ;; esac
      fi
      set -f
      # shellcheck disable=SC2086  # word-splitting the stage is the point
      set -- $stage
      set +f
      if [ "${1##*/}" = quorum-branch ] && [ "${2:-}" = start ]; then block "quorum-branch start begins a build."; fi
    done <<EOF
$(bare_stages "$cmd")
EOF
    while IFS= read -r target; do
      if [ -n "$target" ] && rel=$(in_repo "$target"); then block "this command writes $rel, in the repository."; fi
    done <<EOF
$(write_targets "$cmd")
EOF
    ;;
esac
exit 0
