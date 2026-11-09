#!/usr/bin/env bash
# PostToolUse hook on Bash: record the task's pull request.
#
# When a Bash call runs `gh pr create` and its output names a pull request URL, save that URL as the active task's
# `pr` in state.md, so the dashboard and later commands know the PR exists. The task is the one
# quorum-active-task resolves (its feat/ or fix/ branch, then .tasks/.active). Anything else, or any failure, exits
# 0 without a word: this hook only records, it never blocks.
# Bash 3.2 compatible.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"

input=$(cat 2>/dev/null || true)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
printf '%s' "$command" | grep -Eq '(^|[^[:alnum:]_-])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)' || exit 0

# Bash's tool_response is an object with stdout and stderr; take any string in it, so a version that sends text works too.
output=$(printf '%s' "$input" | jq -r '.tool_response | if type == "object" then [.stdout, .stderr] | map(strings) | join("\n") else tostring end' 2>/dev/null) || exit 0
url=$(printf '%s' "$output" | grep -Eo 'https?://[^[:space:]"]+/pull/[0-9]+' | head -n 1)
[ -n "$url" ] || exit 0

export CLAUDE_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-$(pwd)}
task=$("$BIN/quorum-active-task" 2>/dev/null) || exit 0
"$BIN/quorum-state" --task "$task" set pr "$url" >/dev/null 2>&1 || true
exit 0
