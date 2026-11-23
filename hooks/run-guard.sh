#!/usr/bin/env bash
# PreToolUse hook: a /quorum:run session goes through the stages; its main session doesn't fix things itself.
#
# /quorum:run marks its session with `quorum-run enter <session>`, which writes .tasks/.run-sessions/<session id> in
# the main working tree. Until the task's build has started (its base_sha is set by quorum-branch start), it blocks
# (exit 2) that session's main conversation from:
#   - Edit, Write, and NotebookEdit of a file in the repository outside .tasks/;
#   - git commit, merge, rebase, cherry-pick, revert, am, and apply.
# It doesn't read Bash commands for the files they write: while a run specs and plans, its Bash calls write many
# files under .tasks/ through cds, heredocs, and variables, and guessing at those blocked real work. So a Bash write
# (sed -i, a redirect) can still change the code; the skill's wording covers that.
# The spec and plan stages read the code to understand and reproduce the problem, never to change it: the builder
# writes the code once the plan is approved. Quorum's agents (any call with an agent_type) are never blocked, and
# after the build starts the main session can edit again, as simplify-diff does. That leaves one gap: a main session
# that has started the build could still write the code itself before it starts the builder. Not a sandbox.
#
# A run that stops on an ESCALATED task keeps its marker, so the dashboard still reads `run stopped`, and marks it
# with `quorum-run escalated <session>`, which adds the line `escalated`. A marker with that line is ignored here:
# the run is over and the person fixes the checks by hand, with the escalated task active, another one, or none.
# `quorum-run enter` writes the marker afresh, without the line, so the session's next run is guarded again.
# Not marked: a task the Stop hook itself escalated as the run's own turn ended, since the run had no turn left to
# mark it in. That marker is guarded as any other (another task before its build, or no task active) until
# `quorum-run leave <session>` or /quorum:run is run again and stops on the status.
#
# Without a run session, or on any failure to tell, it exits 0 at once. Bash 3.2 compatible.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"
# shellcheck source=hooks/shell-words.sh
. "$HERE/shell-words.sh"
# shellcheck source=hooks/task-context.sh
. "$HERE/task-context.sh"
# shellcheck source=libexec/git-probe.sh
. "$HERE/../libexec/git-probe.sh"

input=$(cat 2>/dev/null || true)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
case "$tool" in Edit|Write|NotebookEdit|Bash) ;; *) exit 0 ;; esac
[ -z "$(printf '%s' "$input" | jq -r '.agent_type // empty' 2>/dev/null)" ] || exit 0
session=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
printf '%s' "$session" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_-]*$' || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
if [ -n "$cwd" ] && [ -d "$cwd" ]; then cd "$cwd" 2>/dev/null || exit 0; fi
quorum_git_probe
task_context "$BIN"
MAIN=$TASK_MAIN; [ -n "$MAIN" ] || exit 0
MARKER="$MAIN/.tasks/.run-sessions/$session"
[ -f "$MARKER" ] || exit 0
# The run stopped on an escalation (see the header): its marker stays for the dashboard, and guards nothing.
if tr -d '\r' < "$MARKER" 2>/dev/null | grep -qx 'escalated'; then exit 0; fi

# Once the build has started, this guard is done.
task=$TASK_SLUG
if [ -n "$task" ]; then
  base=$(task_state "$task" get base_sha 2>/dev/null || true)
  case "$base" in ''|null) ;; *) exit 0 ;; esac
fi
CODE=${TASK_CODE:-$MAIN}

phys() { (cd "$1" 2>/dev/null && pwd -P) || printf '%s\n' "$1"; }
TREES="$MAIN $CODE $(phys "$MAIN") $(phys "$CODE")"

# in_repo PATH: exit 0 if PATH is in the repository's working tree, outside its .tasks/. Prints it relative.
in_repo() {
  local p=${1//\\//} dir t  # on Windows a path may have backslashes, and C:/ is absolute
  [ -n "$p" ] || return 1
  case "$p" in /*|[A-Za-z]:/*) ;; "~"*) return 1 ;; *) p="$(pwd)/$p" ;; esac
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
    echo "This session is running /quorum:run, and the task's build hasn't started: the spec and plan stages read the code to understand and reproduce the problem, never to change it."
    echo "Write what you found into the spec (rd.md, eval.md) and go on with the stages; the builder writes the code once the plan is approved."
    echo "If the run is over and you're working by hand, end it first: quorum-run leave $session"
  } >&2
  exit 2
}

case "$tool" in
  Edit|Write|NotebookEdit)
    path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
    if rel=$(in_repo "$path"); then block "$tool $rel changes the code before the build."; fi ;;
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    while IFS= read -r stage; do
      if sub=$(git_subcommand "$stage"); then
        case "$sub" in commit|merge|rebase|cherry-pick|revert|am|apply) block "git $sub changes the code before the build." ;; esac
      fi
    done <<EOF2
$(bare_stages "$cmd")
EOF2
    ;;
esac
exit 0
