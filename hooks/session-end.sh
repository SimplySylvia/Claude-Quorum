#!/usr/bin/env bash
# SessionEnd hook: end the session's map session and run session.
#
# /quorum:map ends its map session with `quorum-map leave <session>`, and /quorum:run its run session with
# `quorum-run leave <session>`, before they're done, but a session cut off partway (closed, /clear, logged out)
# never gets there. Its .tasks/.map-sessions/<session id> or .tasks/.run-sessions/<session id> marker would keep
# the map guard or the run guard blocking that session if it's resumed. This removes the markers of the session that
# ended. A session that crashes doesn't run SessionEnd; `quorum-map sessions` and `quorum-run sessions` list what's
# left, and /quorum:map with no arguments shows its own. Anything else, or any failure, exits 0 without a word.
# Bash 3.2 compatible.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"

input=$(cat 2>/dev/null || true)
session=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
printf '%s' "$session" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_-]*$' || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
if [ -n "$cwd" ] && [ -d "$cwd" ]; then cd "$cwd" 2>/dev/null || exit 0; fi
MAIN=$("$BIN/quorum-active-task" --main 2>/dev/null) || exit 0
if [ -f "$MAIN/.tasks/.map-sessions/$session" ]; then "$BIN/quorum-map" leave "$session" >/dev/null 2>&1 || true; fi
if [ -f "$MAIN/.tasks/.run-sessions/$session" ]; then "$BIN/quorum-run" leave "$session" >/dev/null 2>&1 || true; fi
exit 0
