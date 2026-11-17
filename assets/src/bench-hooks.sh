#!/usr/bin/env bash
# Count the git processes and time the PreToolUse hooks of a Quorum plugin for one Bash tool call.
#
#   assets/src/bench-hooks.sh [--plugin DIR]
#
# DIR is the plugin to measure (default: this repo); run it once with DIR a worktree of an older commit to compare.
# The fixture, in a temporary directory removed on exit, is a git repo with one commit and an active BUILDING task
# "demo" with no base_sha, written by the plugin's own quorum-state, plus the run-session marker of "bench-session".
# Each PreToolUse hook whose matcher takes Bash, in the plugin's hooks/hooks.json order, is fed
#   {"hook_event_name":"PreToolUse","tool_name":"Bash","session_id":"bench-session","cwd":"<repo>",
#    "tool_input":{"command":"git status --short"}}
# five times, with a counting git first on PATH and as the only QUORUM_GIT_CANDIDATES. A hook's git count is the
# number of git processes its first run started; its time is the median wall time of the five runs.
# Prints `os`, `bash`, `git` and `cpus` lines, one `<hook> <N> git <ms> ms` line per hook, and last
# `total <N> git <ms> ms`. Bash 3.2 compatible.
set -euo pipefail

die() { echo "bench-hooks.sh: $*" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN="$HERE/../.."
while [ $# -gt 0 ]; do
  case "$1" in
    --plugin) [ $# -ge 2 ] || die "--plugin needs a directory"; PLUGIN=$2; shift 2 ;;
    *) die "usage: bench-hooks.sh [--plugin DIR]" ;;
  esac
done
[ -d "$PLUGIN" ] || die "no such directory: $PLUGIN"
PLUGIN=$(cd "$PLUGIN" && pwd -P)
[ -f "$PLUGIN/hooks/hooks.json" ] || die "not a Quorum plugin (no hooks/hooks.json): $PLUGIN"
command -v jq >/dev/null 2>&1 || die "needs jq"

# The real git the shim runs, found with this repo's probe (the measured plugin may predate it). Then drop the answer
# so the hooks probe for themselves, as they would in a fresh tool call.
# shellcheck source=libexec/git-probe.sh
. "$HERE/../../libexec/git-probe.sh"
quorum_git_probe
REAL=$QUORUM_GIT_USE
[ "$REAL" = git ] && REAL=$(command -v git)
unset QUORUM_GIT_USE QUORUM_GIT_PROBE QUORUM_REAL_GIT

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
FIX=$(cd "$FIX" && pwd -P)
REPO="$FIX/repo"
mkdir -p "$REPO" "$FIX/shim"
cd "$REPO"
"$REAL" init -q -b main
"$REAL" -c user.name=bench -c user.email=bench@example.com commit -q --allow-empty -m init
export CLAUDE_PROJECT_DIR="$REPO" CLAUDE_PLUGIN_ROOT="$PLUGIN"
"$PLUGIN/bin/quorum-state" --task demo init LOW BUILDING >/dev/null
printf 'demo\n' > .tasks/.active
mkdir -p .tasks/.run-sessions
date '+%Y-%m-%d %H:%M' > .tasks/.run-sessions/bench-session

# The counting git: one line per process in $GIT_LOG, then the real git.
# shellcheck disable=SC2016  # the $ signs are for the shim to expand, not this script
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "${GIT_LOG:-/dev/null}"\nexec "%s" "$@"\n' "$REAL" > "$FIX/shim/git"
chmod +x "$FIX/shim/git"
export PATH="$FIX/shim:$PATH" QUORUM_GIT_CANDIDATES="$FIX/shim/git"

jq -n --arg cwd "$REPO" \
  '{hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "bench-session", cwd: $cwd,
    tool_input: {command: "git status --short"}}' > "$FIX/input.json"
HOOKS=$(jq -r '.hooks.PreToolUse[] | select(.matcher | split("|") | index("Bash")) | .hooks[].command' \
  "$PLUGIN/hooks/hooks.json" | sed 's|.*/hooks/||')
[ -n "$HOOKS" ] || die "no PreToolUse hook takes Bash in $PLUGIN/hooks/hooks.json"

cpus=$(sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo '?')
echo "os $(uname -sr)"
echo "bash $BASH_VERSION"
echo "git $("$REAL" --version | sed 's/^git version //')"
echo "cpus $cpus"

TIMEFORMAT=%R
total_n=0 total_ms=0
for hook in $HOOKS; do
  [ -x "$PLUGIN/hooks/$hook" ] || die "hook not found: $PLUGIN/hooks/$hook"
  : > "$FIX/log"
  times=""
  for run in 1 2 3 4 5; do
    if [ "$run" -eq 1 ]; then export GIT_LOG="$FIX/log"; else export GIT_LOG=/dev/null; fi
    # The hook's own exit status (a block is 2) doesn't matter here, only its git processes and time.
    t=$( { time "$PLUGIN/hooks/$hook" < "$FIX/input.json" >/dev/null 2>&1 || :; } 2>&1 )
    times="$times$(awk -v s="$t" 'BEGIN { printf "%d", s * 1000 + 0.5 }')
"
  done
  n=$(wc -l < "$FIX/log" | tr -d ' ')
  ms=$(printf '%s' "$times" | sort -n | sed -n 3p)
  echo "$hook $n git $ms ms"
  total_n=$((total_n + n)) total_ms=$((total_ms + ms))
done
echo "total $total_n git $total_ms ms"
