#!/usr/bin/env bats
load ../helpers

# A repo as Quorum 0.11.3's /quorum:init-pipeline leaves it, with a task mid-build whose files 0.11.3 wrote: the
# fixture under fixtures/ (taken from release commit e00985d). .tasks/ isn't in a .gitignore, as a 0.11 repo may
# leave it. The fixture's check appends a line to .tasks/runs.log, which is outside the stop key, so the log counts
# the runs without changing what the hook sees.
setup() {
  WORK="$(mktemp -d)"
  cp -R "$BATS_TEST_DIRNAME/fixtures/." "$WORK"/
  cd "$WORK"
  # Stored as CLAUDE.md.in because this repo's .git/info/exclude lists CLAUDE.md at any depth.
  cp CLAUDE.md.in CLAUDE.md
  git init -q -b main
  git add -A -- . ':(exclude).tasks'
  git -c user.name=t -c user.email=t@example.com commit -qm bootstrap
  export CLAUDE_PROJECT_DIR="$WORK"
}
teardown() { cleanup_repo; }

stop() { echo '{"hook_event_name":"Stop","stop_hook_active":false}' | "$HOOKS/stop-verify.sh"; }
runs() { if [ -f .tasks/runs.log ]; then wc -l < .tasks/runs.log | tr -d ' '; else echo 0; fi; }
# hook SCRIPT EVENT CWD [JSON fields]: run a hook as Claude Code would, from CWD.
hook() {
  local script=$1 event=$2 cwd=$3 extra=${4:-'{}'}
  (cd "$cwd" && jq -n --arg e "$event" --arg c "$cwd" --argjson x "$extra" '{hook_event_name: $e, cwd: $c} + $x' | "$HOOKS/$script")
}
edit() { hook protect-checks.sh PreToolUse "$WORK" "$(jq -n --arg p "$1" '{tool_name: "Edit", tool_input: {file_path: $p}}')"; }

@test "a repo and task set up by 0.11 keep working with no change" {
  [ "$(git status --porcelain -- .tasks | head -n 1)" = "?? .tasks/" ]
  [ ! -e .tasks/fixture-task/verify-pass ]

  # The first stop runs the checks; a second one with nothing changed skips them, silently.
  run stop
  [ "$status" -eq 0 ]
  [ "$(runs)" = 1 ]
  run stop
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ "$(runs)" = 1 ]

  # quorum-validate gives what the base commit's helpers gave on this fixture (recorded while building): exit 0 and
  # no output, for spec, plan and proof.
  for w in spec plan proof; do
    run "$BIN/quorum-validate" --task fixture-task "$w"
    [ "$status" -eq 0 ]
    [ "$output" = "" ]
    case "$output" in *"no rd.md"*) return 1 ;; esac
  done

  # The guards block an edit to the verify script and allow an ordinary edit.
  run edit "$WORK/.claude/hooks/verify-completion.sh"
  [ "$status" -eq 2 ]
  run edit "$WORK/app/report.py"
  [ "$status" -eq 0 ]
}
