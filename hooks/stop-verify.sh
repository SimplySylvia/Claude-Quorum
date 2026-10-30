#!/usr/bin/env bash
# Stop and SubagentStop hook: block "done" until the repo's fast checks pass.
#
# 1. Exit 0 if stop_hook_enabled is off, the repo has no .claude/hooks/verify-completion.sh, there is no active
#    task, or the task's status isn't BUILDING, IN_REVIEW, or ESCALATED. Also exit 0 for the main session (Stop)
#    while the task has pending_findings: those failures are already queued for the builder, and its
#    SubagentStop check still has to pass.
# 2. Run verify-completion.sh with a timeout (verify_timeout_s, default 300).
# 3. On failure, count it in stop_blocks and exit 2 with the failing output, so Claude keeps working.
# 4. Loop guard: on the 3rd failure in a row, let the stop through, save the status in escalated_from, set
#    ESCALATED, and warn the user. A broken environment can't trap a session.
# 5. On success, reset stop_blocks and restore the status from escalated_from.
# Bash 3.2 compatible.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"
MAX_BLOCKS=3

input=$(cat 2>/dev/null || true)
event=$(printf '%s' "$input" | jq -r '.hook_event_name // "Stop"' 2>/dev/null || echo Stop)

case "$(printf '%s' "${CLAUDE_PLUGIN_OPTION_STOP_HOOK_ENABLED:-true}" | tr '[:upper:]' '[:lower:]')" in
  false|0|no|off) exit 0 ;;
esac

ROOT=${CLAUDE_PROJECT_DIR:-$(pwd)}
export CLAUDE_PROJECT_DIR="$ROOT"
VERIFY="$ROOT/.claude/hooks/verify-completion.sh"
[ -f "$VERIFY" ] || exit 0

task=$("$BIN/quorum-active-task" 2>/dev/null) || exit 0
state() { "$BIN/quorum-state" --task "$task" "$@"; }
status=$(state get status 2>/dev/null) || exit 0
case "$status" in BUILDING|IN_REVIEW|ESCALATED) ;; *) exit 0 ;; esac
if [ "$event" = Stop ] && [ -n "$(state get pending_findings 2>/dev/null)" ]; then exit 0; fi

timeout_s=${CLAUDE_PLUGIN_OPTION_VERIFY_TIMEOUT_S:-300}
case "$timeout_s" in ''|*[!0-9]*) timeout_s=300 ;; esac

out=$(mktemp); marker="$out.timeout"
trap 'rm -f "$out" "$marker"' EXIT

# Run the checks in the background with a watchdog (macOS has no `timeout` command).
bash "$VERIFY" >"$out" 2>&1 &
pid=$!
# The watchdog's output goes nowhere, so its sleep can't hold the hook's stdout open after the checks finish.
(
  trap 'kill "$nap" 2>/dev/null; exit 0' TERM
  sleep "$timeout_s" & nap=$!
  wait "$nap"
  if kill -0 "$pid" 2>/dev/null; then : >"$marker"; pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null; fi
) >/dev/null 2>&1 &
watchdog=$!
wait "$pid"; rc=$?
kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null

if [ "$rc" -eq 0 ] && [ ! -e "$marker" ]; then
  [ "$(state get stop_blocks)" = "0" ] || state set stop_blocks 0
  if [ "$status" = ESCALATED ]; then
    prev=$(state get escalated_from)
    state set status "${prev:-IN_REVIEW}"
    state clear escalated_from
  fi
  exit 0
fi

blocks=$(state incr stop_blocks)
if [ -e "$marker" ]; then
  echo "verify-completion.sh timed out after ${timeout_s}s (verify_timeout_s)." >>"$out"
fi

if [ "$blocks" -ge "$MAX_BLOCKS" ]; then
  if [ "$status" != ESCALATED ]; then
    state set escalated_from "$status"
    state set status ESCALATED
  fi
  msg="Quorum: verification checks have failed $blocks times in a row, so the Stop hook is letting this stop through and has marked task '$task' ESCALATED. Fix the environment or the failing checks; the next passing run restores status $(state get escalated_from)."
  jq -n --arg m "$msg" '{systemMessage: $m}'
  exit 0
fi

{
  echo "BLOCKED: Project verification checks failed. Fix all failing tests, typechecks, and linters and output the passing proof before finishing."
  echo "After fixing, restate your full report (what you changed, your commits, and the passing check output): your next reply replaces your previous one."
  echo "Failure $blocks of $MAX_BLOCKS in a row for task '$task'. Last 50 lines of .claude/hooks/verify-completion.sh:"
  tail -n 50 "$out"
} >&2
exit 2
