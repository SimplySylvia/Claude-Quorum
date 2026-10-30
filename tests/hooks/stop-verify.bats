#!/usr/bin/env bats
load ../helpers

# A bootstrapped repo whose check passes unless the file .fail exists, with an active task.
setup() {
  make_repo
  mkdir -p .claude/hooks .tasks/demo
  "$BIN/quorum-render-verify" --check 'unit=if [ -e .fail ]; then echo "1 test failed: export escapes commas"; exit 1; fi; echo ok' > .claude/hooks/verify-completion.sh
  chmod +x .claude/hooks/verify-completion.sh
  "$BIN/quorum-active-task" --set demo
  "$BIN/quorum-state" --task demo init MEDIUM BUILDING
  export CLAUDE_PROJECT_DIR="$WORK"
}
teardown() { cleanup_repo; }

stop() { echo '{"hook_event_name":"Stop","stop_hook_active":false}' | "$HOOKS/stop-verify.sh"; }
st() { "$BIN/quorum-state" --task demo get "$1"; }

@test "passing checks: exit 0, nothing changes" {
  run stop
  [ "$status" -eq 0 ]
  [ "$(st stop_blocks)" = "0" ]
}

@test "failing checks: exit 2 with the failure, the restate instruction, and the count" {
  touch .fail
  run stop
  [ "$status" -eq 2 ]
  [[ "$output" == *"BLOCKED: Project verification checks failed"* ]]
  [[ "$output" == *"restate your full report"* ]]
  [[ "$output" == *"1 test failed: export escapes commas"* ]]
  [[ "$output" == *"Failure 1 of 3"* ]]
  [ "$(st stop_blocks)" = "1" ]
}

@test "loop guard: the 3rd failure lets the stop through and sets ESCALATED" {
  touch .fail
  run stop; [ "$status" -eq 2 ]
  run stop; [ "$status" -eq 2 ]
  run stop
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.systemMessage | test("ESCALATED")'
  [ "$(st status)" = "ESCALATED" ]
  [ "$(st escalated_from)" = "BUILDING" ]
}

@test "after ESCALATED, further failures still let the stop through" {
  touch .fail
  stop || true; stop || true; stop
  run stop
  [ "$status" -eq 0 ]
  [ "$(st status)" = "ESCALATED" ]
  [ "$(st escalated_from)" = "BUILDING" ]
}

@test "the next pass resets the counter and restores the old status" {
  touch .fail
  stop || true; stop || true; stop
  rm .fail
  run stop
  [ "$status" -eq 0 ]
  [ "$(st status)" = "BUILDING" ]
  [ "$(st stop_blocks)" = "0" ]
  [ -z "$(st escalated_from)" ]
}

@test "a pass between failures resets the count" {
  touch .fail; stop || true; stop || true
  rm .fail; stop
  touch .fail
  run stop
  [[ "$output" == *"Failure 1 of 3"* ]]
}

@test "only BUILDING, IN_REVIEW, and ESCALATED tasks are checked" {
  touch .fail
  for s in DRAFT-AWAITING-VISUAL-SIGNOFF CONVERGED BLIND-TEST READY AWAITING-HUMAN HALTED; do
    "$BIN/quorum-state" --task demo set status "$s"
    run stop
    [ "$status" -eq 0 ]
  done
  "$BIN/quorum-state" --task demo set status IN_REVIEW
  run stop
  [ "$status" -eq 2 ]
}

@test "no active task: exit 0" {
  touch .fail
  "$BIN/quorum-active-task" --clear
  run stop
  [ "$status" -eq 0 ]
}

@test "repo not bootstrapped: exit 0" {
  touch .fail
  rm .claude/hooks/verify-completion.sh
  run stop
  [ "$status" -eq 0 ]
}

@test "stop_hook_enabled=false: exit 0" {
  touch .fail
  CLAUDE_PLUGIN_OPTION_STOP_HOOK_ENABLED=false run stop
  [ "$status" -eq 0 ]
  [ "$(st stop_blocks)" = "0" ]
}

@test "a check that runs past verify_timeout_s is killed and counts as a failure" {
  "$BIN/quorum-render-verify" --check 'slow=sleep 30' > .claude/hooks/verify-completion.sh
  start=$(date +%s)
  CLAUDE_PLUGIN_OPTION_VERIFY_TIMEOUT_S=1 run stop
  [ "$status" -eq 2 ]
  [[ "$output" == *"timed out after 1s"* ]]
  [ $(( $(date +%s) - start )) -lt 10 ]
}

@test "hooks.json wires Stop and the builder's SubagentStop to this script" {
  run jq -r '.hooks.Stop[0].hooks[0].command, .hooks.SubagentStop[0].matcher, .hooks.SubagentStop[0].hooks[0].command' "$HOOKS/hooks.json"
  [[ "${lines[0]}" == *"/hooks/stop-verify.sh" ]]
  [ "${lines[1]}" = '^quorum:builder$' ]
  [[ "${lines[2]}" == *"/hooks/stop-verify.sh" ]]
}
