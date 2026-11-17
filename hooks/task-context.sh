#!/usr/bin/env bash
# shellcheck disable=SC2034  # the TASK_* variables are set for the hooks that source this file
# Sourced by the guard hooks and stop-verify: resolve the active task's context once per run, and reach its state
# without resolving the root again. Not run on its own.
#
# task_context BIN   sets TASK_SLUG, TASK_ROOT, TASK_CODE and TASK_MAIN from one `quorum-active-task --all`, read
#                    line by line with `IFS= read -r` (never eval, never a whitespace IFS, which would drop an empty
#                    slug). When --all fails (a path holding a newline), it asks the four separate modes instead. A
#                    value it can't get is left empty, and it always returns 0: each hook tests the empty variable
#                    where it used to test the call's exit code.
# task_state SLUG ARGS...
#                    quorum-state --task SLUG --root "$TASK_ROOT" ARGS..., or without --root when TASK_ROOT isn't a
#                    directory, so quorum-state resolves it as before.
# Bash 3.2 compatible.

TASK_SLUG='' TASK_ROOT='' TASK_CODE='' TASK_MAIN='' TASK_BIN=''

task_context() {
  local out
  TASK_BIN=$1 TASK_SLUG='' TASK_ROOT='' TASK_CODE='' TASK_MAIN=''
  if out=$("$TASK_BIN/quorum-active-task" --all 2>/dev/null); then
    { IFS= read -r TASK_SLUG; IFS= read -r TASK_ROOT; IFS= read -r TASK_CODE; IFS= read -r TASK_MAIN; } <<EOF
$out
EOF
  else
    TASK_SLUG=$("$TASK_BIN/quorum-active-task" 2>/dev/null) || TASK_SLUG=''
    TASK_ROOT=$("$TASK_BIN/quorum-active-task" --root 2>/dev/null) || TASK_ROOT=''
    TASK_CODE=$("$TASK_BIN/quorum-active-task" --code 2>/dev/null) || TASK_CODE=''
    TASK_MAIN=$("$TASK_BIN/quorum-active-task" --main 2>/dev/null) || TASK_MAIN=''
  fi
  return 0
}

task_state() {
  local slug=$1; shift
  if [ -d "$TASK_ROOT" ]; then
    "$TASK_BIN/quorum-state" --task "$slug" --root "$TASK_ROOT" "$@"
  else
    "$TASK_BIN/quorum-state" --task "$slug" "$@"
  fi
}
