#!/usr/bin/env bash
# SessionEnd hook: end the session's map session.
#
# /quorum:map ends its map session with `quorum-map leave <session>` before it stops, but a session cut off partway
# (closed, /clear, logged out) never gets there, and its .tasks/.map-sessions/<session id> marker would keep the map
# guard blocking that session if it's resumed. This removes the marker of the session that ended. A session that
# crashes doesn't run SessionEnd; `quorum-map sessions` lists what's left, and /quorum:map with no arguments shows it.
# Anything else, or any failure, exits 0 without a word. Bash 3.2 compatible.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"

input=$(cat 2>/dev/null || true)
session=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
printf '%s' "$session" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_-]*$' || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
if [ -n "$cwd" ] && [ -d "$cwd" ]; then cd "$cwd" 2>/dev/null || exit 0; fi
MAIN=$("$BIN/quorum-active-task" --main 2>/dev/null) || exit 0
[ -f "$MAIN/.tasks/.map-sessions/$session" ] || exit 0
"$BIN/quorum-map" leave "$session" >/dev/null 2>&1 || true
exit 0
