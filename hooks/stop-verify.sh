#!/usr/bin/env bash
# Stop and SubagentStop hook: block "done" until the repo's fast checks pass.
#
# 1. Exit 0 if stop_hook_enabled is off, the repo has no .claude/hooks/verify-completion.sh, there is no active
#    task, or the task's status isn't BUILDING, IN_REVIEW, or ESCALATED. Also exit 0 for the main session (Stop)
#    while the task has pending_findings: those failures are already queued for the builder, and its
#    SubagentStop check still has to pass.
#    While /quorum:review --fix runs its builder, .tasks/.review-fix-active names the review and the session that
#    wrote it: the builder's SubagentStop is checked against that review's state instead of the active task's. A
#    marker from another session, or naming a review that isn't FIXING, is left over from an interrupted --fix: it's
#    ignored, and the active task is checked as usual.
#    The task is the one the session's directory (the input's cwd) resolves: in a task's git worktree, that
#    worktree's. Its checks run in the task's worktree when it has one, with that worktree's verify-completion.sh.
# 2. Skip: compute a key for the tree the checks run in (the repo two levels above the verify script chosen) from
#    HEAD, the unstaged and staged diffs, the untracked files outside .tasks/ (contents and executable bits, a link
#    by its target text, anything else by type only, never opened), the verify script's path and content, that
#    tree's path, verify_timeout_s and the plugin version. When it equals .tasks/<task>/verify-pass, exit 0 with no
#    output and don't run the checks. Ignored files and tool versions aren't in the key. An unborn HEAD, a git
#    error, a dirty or moved submodule, an untracked nested repo, an unreadable untracked file, or an untracked name
#    with a newline or a leading quote gives no key, which only turns the skip off. There's no maximum age.
# 3. Run verify-completion.sh with a timeout (verify_timeout_s, default 300). After a pass whose key is the same
#    before and after the run, write the key to the stamp atomically; otherwise, and on any failure, delete it.
# 4. On failure, count it in stop_blocks and exit 2 with the failing output, so Claude keeps working.
# 5. Loop guard: on the 3rd failure in a row, let the stop through, save the status in escalated_from, set
#    ESCALATED, and warn the user. A broken environment can't trap a session.
# 6. On success (a pass or a skip), reset stop_blocks if it isn't 0 and restore the status from escalated_from.
# Bash 3.2 compatible.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"
# shellcheck source=hooks/task-context.sh
. "$HERE/task-context.sh"
# shellcheck source=libexec/git-probe.sh
. "$HERE/../libexec/git-probe.sh"
MAX_BLOCKS=3

input=$(cat 2>/dev/null || true)
event=$(printf '%s' "$input" | jq -r '.hook_event_name // "Stop"' 2>/dev/null || echo Stop)

case "$(printf '%s' "${CLAUDE_PLUGIN_OPTION_STOP_HOOK_ENABLED:-true}" | tr '[:upper:]' '[:lower:]')" in
  false|0|no|off) exit 0 ;;
esac

cwd=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null || true)
if [ -n "$cwd" ] && [ -d "$cwd" ]; then cd "$cwd" || exit 0; fi
orig=${CLAUDE_PROJECT_DIR:-}
quorum_git_probe
task_context "$BIN"
ROOT=${TASK_ROOT:-${CLAUDE_PROJECT_DIR:-$(pwd)}}
CODE=${TASK_CODE:-$ROOT}
export CLAUDE_PROJECT_DIR="$ROOT"
# quorum-state gets the root it would resolve under this export: the same ROOT.
TASK_ROOT=$ROOT
[ -f "$ROOT/.claude/hooks/verify-completion.sh" ] || [ -f "$CODE/.claude/hooks/verify-completion.sh" ] || exit 0

task=""
FIX_MARKER="$ROOT/.tasks/.review-fix-active"
if [ "$event" = SubagentStop ] && [ -f "$FIX_MARKER" ]; then
  task=$(sed -n 1p "$FIX_MARKER" | tr -d '[:space:]')
  writer=$(sed -n 2p "$FIX_MARKER" | tr -d '[:space:]')
  session=$(printf '%s' "$input" | jq -r '.session_id // ""' 2>/dev/null || true)
  if [ -z "$task" ] || [ ! -f "$ROOT/.tasks/$task/state.md" ]; then task=""
  elif [ -n "$writer" ] && [ -n "$session" ] && [ "$writer" != "$session" ]; then task=""
  elif [ "$(task_state "$task" get status 2>/dev/null)" != FIXING ]; then task=""
  fi
fi
if [ -z "$task" ]; then
  # When CLAUDE_PROJECT_DIR already was the root, the export changed nothing, so the slug read above still holds.
  if [ -n "$orig" ] && [ "$orig" = "$ROOT" ]; then task=$TASK_SLUG
  else task=$("$BIN/quorum-active-task" 2>/dev/null) || exit 0
  fi
  [ -n "$task" ] || exit 0
fi
state() { task_state "$task" "$@"; }
status=$(state get status 2>/dev/null) || exit 0
case "$status" in BUILDING|IN_REVIEW|ESCALATED|FIXING) ;; *) exit 0 ;; esac
if [ "$event" = Stop ] && [ -n "$(state get pending_findings 2>/dev/null)" ]; then exit 0; fi
worktree=$(state get worktree 2>/dev/null || true)
if [ -n "$worktree" ] && [ -d "$worktree" ]; then CODE=$worktree; fi
VERIFY="$CODE/.claude/hooks/verify-completion.sh"
[ -f "$VERIFY" ] || VERIFY="$ROOT/.claude/hooks/verify-completion.sh"

timeout_s=${CLAUDE_PLUGIN_OPTION_VERIFY_TIMEOUT_S:-300}
case "$timeout_s" in ''|*[!0-9]*) timeout_s=300 ;; esac

out=$(mktemp); marker="$out.timeout"; keyf="$out.key"
trap 'rm -f "$out" "$marker" "$keyf" "$keyf.paths" "$keyf.diff" "$keyf.others"' EXIT

KTREE=${VERIFY%/.claude/hooks/verify-completion.sh}
STAMP="$ROOT/.tasks/$task/verify-pass"
NL='
'
kgit() { GIT_OPTIONAL_LOCKS=0 "$BIN/quorum-git" -C "$KTREE" "$@"; }

# stop_key: print the key of the tree the checks run in, or return 1 when there is none. Every failure here only
# turns the skip off: nothing is opened that isn't a readable regular file, and no object is written.
stop_key() {
  local h p t x n
  case "$KTREE$VERIFY" in *"$NL"*) return 1 ;; esac
  : >"$keyf" && : >"$keyf.paths" || return 1
  h=$(kgit rev-parse --verify -q HEAD 2>/dev/null) && [ -n "$h" ] || return 1
  printf 'HEAD %s\n' "$h" >>"$keyf"
  for x in '' --cached; do
    # shellcheck disable=SC2086  # $x is empty or one flag
    kgit diff $x --binary --no-color --no-ext-diff --no-textconv --ignore-submodules=none HEAD -- . ':(exclude).tasks' \
      >"$keyf.diff" 2>/dev/null || return 1
    # A submodule shows as its commit line, which doesn't change with further edits inside it.
    if grep -q '^[-+]Subproject commit ' "$keyf.diff"; then return 1; fi
    n=$(wc -c <"$keyf.diff" | tr -d ' ')
    printf 'DIFF%s %s\n' "$x" "$n" >>"$keyf" && cat "$keyf.diff" >>"$keyf" || return 1
  done
  kgit ls-files -z --others --exclude-standard -- . ':(exclude).tasks' >"$keyf.others" 2>/dev/null || return 1
  # Each path is relative to KTREE, so every test is on "$KTREE/$p", never on the session's directory.
  while IFS= read -r -d '' p; do
    case "$p" in
      *"$NL"*|'"'*) return 1 ;;   # hash-object --stdin-paths would read a leading quote as C-quoting
      */) return 1 ;;             # an untracked nested repository, whose contents git doesn't list
    esac
    if [ -L "$KTREE/$p" ]; then
      t=$(readlink "$KTREE/$p" && printf x) || return 1
      t=${t%x}; t=${t%"$NL"}
      case "$t" in *"$NL"*) return 1 ;; esac
      printf 'L %s %s\n' "$p" "$t"
    elif [ -f "$KTREE/$p" ]; then
      [ -r "$KTREE/$p" ] || return 1
      x=-; [ -x "$KTREE/$p" ] && x=x
      printf 'F %s %s\n' "$p" "$x"
      printf '%s\n' "$p" >>"$keyf.paths"
    else
      t=other
      if [ -d "$KTREE/$p" ]; then t=dir; elif [ -p "$KTREE/$p" ]; then t=fifo; elif [ -S "$KTREE/$p" ]; then t=socket; fi
      printf 'T %s %s\n' "$p" "$t"
    fi
  done <"$keyf.others" >>"$keyf" || return 1
  printf 'VERIFY %s\n' "$VERIFY" >>"$keyf"
  printf '%s\n' "$VERIFY" >>"$keyf.paths"
  kgit hash-object --no-filters --stdin-paths <"$keyf.paths" >>"$keyf" 2>/dev/null || return 1
  t=$(jq -r .version "$HERE/../.claude-plugin/plugin.json" 2>/dev/null) || return 1
  printf 'KTREE %s\ntimeout %s\nversion %s\n' "$KTREE" "$timeout_s" "$t" >>"$keyf" || return 1
  t=$(kgit hash-object --stdin <"$keyf" 2>/dev/null) && [ -n "$t" ] || return 1
  printf '%s\n' "$t"
}

# A pass and a skip share this success path.
passed() {
  [ "$(state get stop_blocks)" = "0" ] || state set stop_blocks 0
  if [ "$status" = ESCALATED ]; then
    prev=$(state get escalated_from)
    state set status "${prev:-IN_REVIEW}"
    state clear escalated_from
  fi
  exit 0
}

before=$(stop_key 2>/dev/null) || before=""
if [ -n "$before" ] && [ -f "$STAMP" ] && [ "$(head -n 1 "$STAMP" 2>/dev/null)" = "$before" ]; then passed; fi

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
  after=""; [ -z "$before" ] || after=$(stop_key 2>/dev/null) || after=""
  # Stamp-write errors are ignored: the next stop just runs the checks again.
  if [ -n "$before" ] && [ "$before" = "$after" ]; then
    tmp=$(mktemp "$STAMP.XXXXXX" 2>/dev/null) || tmp=""
    if [ -z "$tmp" ] || ! { printf '%s\n' "$after" >"$tmp" && mv -f "$tmp" "$STAMP"; } 2>/dev/null; then
      rm -f "$tmp" "$STAMP" 2>/dev/null
    fi
  else
    rm -f "$STAMP" 2>/dev/null
  fi
  passed
fi

rm -f "$STAMP" 2>/dev/null
blocks=$(state incr stop_blocks)
if [ -e "$marker" ]; then
  echo "verify-completion.sh timed out after ${timeout_s}s (verify_timeout_s)." >>"$out"
fi

if [ "$blocks" -ge "$MAX_BLOCKS" ]; then
  if [ "$status" != ESCALATED ]; then
    state set escalated_from "$status"
    state set status ESCALATED
  fi
  msg="Quorum: verification checks have failed $blocks times in a row, so the Stop hook is letting this stop through and has marked task '$task' ESCALATED. Find the cause before changing more code (the quorum:debugging skill: reproduce, read the whole error, check what changed), then fix the environment or the failing checks; the next passing run restores status $(state get escalated_from)."
  jq -n --arg m "$msg" '{systemMessage: $m}'
  exit 0
fi

{
  echo "BLOCKED: Project verification checks failed. Fix all failing tests, typechecks, and linters and output the passing proof before finishing."
  echo "Find the root cause first (the quorum:debugging skill): reproduce the failure, read the whole error, and check what changed. Don't weaken a check to make it pass."
  echo "After fixing, restate your full report (what you changed, your commits, and the passing check output): your next reply replaces your previous one."
  echo "Failure $blocks of $MAX_BLOCKS in a row for task '$task'. Last 50 lines of .claude/hooks/verify-completion.sh:"
  tail -n 50 "$out"
} >&2
exit 2
