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
  # READY and AWAITING-HUMAN need a passing proof at HEAD (quorum-state checks it).
  printf 'Proof: demo at %s\nResult: ALL PASS\n' "$(git rev-parse --short HEAD)" > .tasks/demo/proof-final.md
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

@test "pending findings: the main session may stop, the builder still may not" {
  touch .fail
  "$BIN/quorum-state" --task demo set status IN_REVIEW
  "$BIN/quorum-state" --task demo push pending_findings "[IMPORTANT] blind test: export — Pattern Category: Data loss — last row dropped"
  run stop
  [ "$status" -eq 0 ]
  [ "$(st stop_blocks)" = "0" ]
  run bash -c "echo '{\"hook_event_name\":\"SubagentStop\",\"agent_type\":\"quorum:builder\"}' | '$HOOKS/stop-verify.sh'"
  [ "$status" -eq 2 ]
}

subagent_stop() { echo '{"hook_event_name":"SubagentStop","agent_type":"quorum:builder"}' | "$HOOKS/stop-verify.sh"; }

@test "review --fix: the builder is checked against the review the marker names, not the active task" {
  mkdir -p .tasks/review-pr-7
  "$BIN/quorum-state" --task review-pr-7 init MEDIUM FIXING
  "$BIN/quorum-state" --task demo set status PLANNING   # the active task isn't one the hook checks
  printf 'review-pr-7\n' > .tasks/.review-fix-active
  touch .fail
  run subagent_stop
  [ "$status" -eq 2 ]
  [[ "$output" == *"review-pr-7"* ]]
  [ "$("$BIN/quorum-state" --task review-pr-7 get stop_blocks)" = "1" ]
  [ "$(st stop_blocks)" = "0" ]
  rm .fail
  run subagent_stop
  [ "$status" -eq 0 ]
  [ "$("$BIN/quorum-state" --task review-pr-7 get stop_blocks)" = "0" ]
}

@test "review --fix: the main session's Stop ignores the marker, and a marker for a review that isn't FIXING is ignored" {
  mkdir -p .tasks/review-pr-7
  "$BIN/quorum-state" --task review-pr-7 init MEDIUM REVIEWED
  "$BIN/quorum-state" --task demo set status PLANNING
  printf 'review-pr-7\n' > .tasks/.review-fix-active
  touch .fail
  run stop;          [ "$status" -eq 0 ]
  run subagent_stop; [ "$status" -eq 0 ]
  # A marker naming a review that doesn't exist falls back to the active task.
  printf 'review-gone\n' > .tasks/.review-fix-active
  "$BIN/quorum-state" --task demo set status BUILDING
  run subagent_stop; [ "$status" -eq 2 ]
  [[ "$output" == *"'demo'"* ]]
}

subagent_stop_in() { echo "{\"hook_event_name\":\"SubagentStop\",\"agent_type\":\"quorum:builder\",\"session_id\":\"$1\"}" | "$HOOKS/stop-verify.sh"; }

@test "review --fix: a marker left by an interrupted fix never takes over a task's builder" {
  mkdir -p .tasks/review-pr-7
  "$BIN/quorum-state" --task review-pr-7 init MEDIUM INTERRUPTED
  "$BIN/quorum-state" --task demo set status BUILDING
  printf 'review-pr-7\nsess-a\n' > .tasks/.review-fix-active
  touch .fail
  # The review isn't FIXING: the task's builder is checked against the task.
  run subagent_stop_in sess-a; [ "$status" -eq 2 ]
  [[ "$output" == *"'demo'"* ]]
  [ "$(st stop_blocks)" = "1" ]
  [ "$("$BIN/quorum-state" --task review-pr-7 get stop_blocks)" = "0" ]
}

@test "review --fix: the marker counts only in the session that wrote it" {
  mkdir -p .tasks/review-pr-7
  "$BIN/quorum-state" --task review-pr-7 init MEDIUM FIXING
  "$BIN/quorum-state" --task demo set status BUILDING
  printf 'review-pr-7\nsess-a\n' > .tasks/.review-fix-active
  touch .fail
  run subagent_stop_in sess-b; [ "$status" -eq 2 ]
  [[ "$output" == *"'demo'"* ]]
  [ "$("$BIN/quorum-state" --task review-pr-7 get stop_blocks)" = "0" ]
  run subagent_stop_in sess-a; [ "$status" -eq 2 ]
  [[ "$output" == *"review-pr-7"* ]]
  [ "$("$BIN/quorum-state" --task review-pr-7 get stop_blocks)" = "1" ]
}

@test "with CLAUDE_PROJECT_DIR a linked worktree and the session outside the repo, the stop checks the task the root resolves, as before" {
  "$BIN/quorum-state" --task a init MEDIUM BUILDING
  "$BIN/quorum-render-verify" --check 'unit=echo "the check always fails"; exit 1' > .claude/hooks/verify-completion.sh
  git worktree add -q -b feat/a "$BATS_TEST_TMPDIR/wt"
  mkdir -p "$BATS_TEST_TMPDIR/outside"
  run env CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR/wt" bash -c 'jq -n --arg c "$1" '\''{hook_event_name: "Stop", stop_hook_active: false, cwd: $c}'\'' | "$2/stop-verify.sh"' _ "$BATS_TEST_TMPDIR/outside" "$HOOKS"
  [ "$status" -eq 2 ]
  [[ "$output" == *"for task 'demo'"* ]]
}

# The stop key and the verify-pass stamp. The check counts its runs in $BATS_TEST_TMPDIR, outside the tree, so the
# counter itself never changes the key.
counting_check() {
  "$BIN/quorum-render-verify" --check "unit=echo run >> '$BATS_TEST_TMPDIR/runs'; ${1:-}if [ -e .fail ]; then echo failed; exit 1; fi; echo ok" > .claude/hooks/verify-completion.sh
}
runs() { if [ -f "$BATS_TEST_TMPDIR/runs" ]; then wc -l < "$BATS_TEST_TMPDIR/runs" | tr -d ' '; else echo 0; fi; }
commit() { git -c user.name=t -c user.email=t@example.com commit -q "$@"; }
# must_skip / must_rerun [STOP-FUNCTION]: one stop that exits 0 and either leaves the run counter alone, with no
# output, or moves it.
must_skip() {
  local n; n=$(runs)
  run "${1:-stop}"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ "$(runs)" = "$n" ]
}
must_rerun() {
  local n; n=$(runs)
  run "${1:-stop}"
  [ "$status" -eq 0 ]
  [ "$(runs)" -gt "$n" ]
}

@test "the stop key covers HEAD, staged and unstaged diffs, untracked files and the verify script, and leaves out .tasks" {
  counting_check
  echo one > t.txt; git add t.txt; commit -m t
  must_rerun
  [ -s .tasks/demo/verify-pass ]
  first=$(cat .tasks/demo/verify-pass)
  must_skip
  [ "$(cat .tasks/demo/verify-pass)" = "$first" ]
  # A write under .tasks/ doesn't change the key.
  echo note > .tasks/demo/notes.md
  "$BIN/quorum-state" --task demo log set note
  must_skip
  # A staged edit, then an unstaged one on top of it.
  echo two > t.txt; git add t.txt
  must_rerun; must_skip
  echo three > t.txt
  must_rerun; must_skip
  # An unborn HEAD gives no key: the checks run every time and no stamp is kept.
  git checkout -q --orphan empty
  must_rerun
  [ ! -e .tasks/demo/verify-pass ]
  must_rerun
  git checkout -q -f main
  must_rerun; must_skip
  # So does a newline in an untracked path.
  touch "$(printf 'a\nb')"
  must_rerun
  [ ! -e .tasks/demo/verify-pass ]
  must_rerun
}

@test "a second stop with nothing changed skips the checks silently, and a failure deletes the stamp" {
  counting_check
  must_rerun
  [ -s .tasks/demo/verify-pass ]
  [ "$(st stop_blocks)" = "0" ]
  inode=$(ls -i .tasks/demo/state.md | awk '{print $1}')
  must_skip
  must_skip
  [ "$(ls -i .tasks/demo/state.md | awk '{print $1}')" = "$inode" ]
  touch .fail
  run stop
  [ "$status" -eq 2 ]
  [ ! -e .tasks/demo/verify-pass ]
  # review --fix keeps the stamp in the review's folder.
  rm .fail
  mkdir -p .tasks/review-pr-7
  "$BIN/quorum-state" --task review-pr-7 init MEDIUM FIXING
  "$BIN/quorum-state" --task demo set status PLANNING
  printf 'review-pr-7\n' > .tasks/.review-fix-active
  must_rerun subagent_stop
  [ -s .tasks/review-pr-7/verify-pass ]
  [ ! -e .tasks/demo/verify-pass ]
  must_skip subagent_stop
}

@test "each change to the tree, the verify script or the timeout reruns the checks" {
  counting_check
  echo one > t.txt; git add t.txt; commit -m t
  echo two > t.txt
  must_rerun; must_skip
  commit --allow-empty -m x           # nothing is staged, so only HEAD moves
  must_rerun; must_skip
  echo three >> t.txt                 # an already-modified file, edited again
  must_rerun; must_skip
  echo u > u.txt                      # a new untracked file
  must_rerun; must_skip
  chmod +x t.txt                      # a tracked file's mode
  must_rerun; must_skip
  chmod +x u.txt                      # an untracked file's mode
  must_rerun; must_skip
  git rm -q --cached t.txt
  must_rerun; must_skip
  echo '# edited' >> .claude/hooks/verify-completion.sh   # the verify script, untracked
  must_rerun; must_skip
  echo .claude/hooks/verify-completion.sh >> .git/info/exclude
  must_rerun; must_skip
  echo '# edited again' >> .claude/hooks/verify-completion.sh   # the verify script, ignored by git
  must_rerun; must_skip
  export CLAUDE_PLUGIN_OPTION_VERIFY_TIMEOUT_S=301
  must_rerun; must_skip
}

@test "a tree changed while the checks ran stores no stamp" {
  echo one > t.txt; git add t.txt; commit -m t
  counting_check
  must_rerun; must_skip
  counting_check 'echo more >> t.txt; '
  must_rerun
  [ ! -e .tasks/demo/verify-pass ]
  must_rerun
  [ ! -e .tasks/demo/verify-pass ]
}

# bounded_stop: run one stop in the background, kill it after 10 s, and fail if it had to. Sets rc and ran.
bounded_stop() {
  local n pid i
  n=$(runs)
  stop > "$BATS_TEST_TMPDIR/stop.out" 2>&1 &
  pid=$!
  for i in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null
    echo "the stop hook was still running after 10 s"
    return 1
  fi
  rc=0; wait "$pid" || rc=$?
  ran=no; [ "$(runs)" = "$n" ] || ran=yes
}

@test "an untracked link to a directory, an unreadable file and a FIFO never crash the stop hook" {
  counting_check
  mkdir d; echo x > d/f; git add d; commit -m d
  check_entry() {
    bounded_stop; [ "$rc" -eq 0 ]
    bounded_stop; [ "$rc" -eq 0 ]; second=$ran
    bounded_stop; [ "$rc" -eq 0 ]; [ "$ran" = "$second" ]
    bounded_stop; [ "$rc" -eq 0 ]; [ "$ran" = "$second" ]
  }
  ln -s d dl
  check_entry
  rm dl
  if [ "$(id -u)" -ne 0 ]; then
    echo secret > unreadable; chmod 000 unreadable
    check_entry
    chmod 600 unreadable; rm unreadable
  fi
  mkfifo ff
  check_entry
}

@test "a nested repo, a dirty submodule or a quoted file name turns the skip off" {
  counting_check
  must_rerun; must_skip
  git init -q nested
  must_rerun; must_rerun
  rm -rf nested
  must_rerun; must_skip
  git init -q "$BATS_TEST_TMPDIR/src"
  echo s > "$BATS_TEST_TMPDIR/src/s.txt"
  git -C "$BATS_TEST_TMPDIR/src" add s.txt
  git -C "$BATS_TEST_TMPDIR/src" -c user.name=t -c user.email=t@example.com commit -q -m s
  git -c protocol.file.allow=always submodule add -q "$BATS_TEST_TMPDIR/src" mod
  commit -m mod
  must_rerun; must_skip
  echo edited >> mod/s.txt
  must_rerun; must_rerun
  git -C mod checkout -q -- s.txt
  must_rerun; must_skip
  touch a '"a"'
  must_rerun; must_rerun
}

@test "the key reads untracked links and modes in the checks' tree when the session's cwd is a subdirectory" {
  counting_check
  mkdir sub; echo x > x; ln -s a l
  stop_in_sub() { jq -n --arg c "$WORK/sub" '{hook_event_name: "Stop", stop_hook_active: false, cwd: $c}' | "$HOOKS/stop-verify.sh"; }
  must_rerun stop_in_sub; must_skip stop_in_sub
  chmod +x x
  must_rerun stop_in_sub; must_skip stop_in_sub
  ln -sfn b l
  must_rerun stop_in_sub; must_skip stop_in_sub
}
