#!/usr/bin/env bats
load ../helpers

# A repo with an active task; the hook only acts while it's BUILDING or IN_REVIEW.
setup() {
  make_repo
  mkdir -p .claude/hooks .github/workflows packages/web
  echo 'exit 0' > .claude/hooks/verify-completion.sh
  "$BIN/quorum-state" --task demo init MEDIUM BUILDING
  "$BIN/quorum-active-task" --set demo
  export CLAUDE_PROJECT_DIR="$WORK"
}
teardown() { cleanup_repo; }

edit() { jq -n --arg t "${2:-Edit}" --arg p "$1" '{hook_event_name: "PreToolUse", tool_name: $t, tool_input: {file_path: $p}}' | "$HOOKS/protect-checks.sh"; }
bash_cmd() { jq -n --arg c "$1" '{hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {command: $c}}' | "$HOOKS/protect-checks.sh"; }

@test "during a build, the check script, CI, and test and lint configs can't be edited" {
  run edit .claude/hooks/verify-completion.sh;   [ "$status" -eq 2 ]
  [[ "$output" == *"BLOCKED BY QUORUM"* ]]; [[ "$output" == *"Checks changes"* ]]
  run edit "$WORK/.github/workflows/ci.yml" Write;  [ "$status" -eq 2 ]
  run edit packages/web/tsconfig.json;            [ "$status" -eq 2 ]
  run edit eslint.config.mjs;                     [ "$status" -eq 2 ]
  run edit pytest.ini;                            [ "$status" -eq 2 ]
  run edit app/report.py;                         [ "$status" -eq 0 ]
  run edit tests/test_report.py;                  [ "$status" -eq 0 ]
}

@test "only while BUILDING or IN_REVIEW: before the build and when ESCALATED, the checks can change" {
  "$BIN/quorum-state" --task demo set status IN_REVIEW
  run edit pytest.ini; [ "$status" -eq 2 ]
  "$BIN/quorum-state" --task demo set status PLANNING
  run edit pytest.ini; [ "$status" -eq 0 ]
  "$BIN/quorum-state" --task demo set status ESCALATED
  run edit .claude/hooks/verify-completion.sh; [ "$status" -eq 0 ]
  "$BIN/quorum-active-task" --clear
  "$BIN/quorum-state" --task demo set status BUILDING
  run edit pytest.ini; [ "$status" -eq 0 ]
}

@test "a path the task unlocked is allowed, and only the user can unlock one" {
  "$BIN/quorum-state" --task demo push unlocked pytest.ini
  run edit pytest.ini;  [ "$status" -eq 0 ]
  run edit tox.ini;     [ "$status" -eq 2 ]
  run bash_cmd "quorum-state --task demo push unlocked tox.ini";     [ "$status" -eq 2 ]
  run bash_cmd "quorum-state push unlocked tox.ini && echo ok";      [ "$status" -eq 2 ]
  run bash_cmd "quorum-state get unlocked";                          [ "$status" -eq 0 ]
}

@test "repo-specific globs from .claude/quorum.json and the plugin option are protected too" {
  echo '{"protected_paths": "Makefile,scripts/ci/*"}' > .claude/quorum.json
  run edit Makefile;               [ "$status" -eq 2 ]
  run edit scripts/ci/run.sh;      [ "$status" -eq 2 ]
  run env CLAUDE_PLUGIN_OPTION_PROTECTED_PATHS="*.cfg" bash -c 'jq -n "{tool_name: \"Edit\", tool_input: {file_path: \"lint.cfg\"}}" | "$1/protect-checks.sh"' _ "$HOOKS"
  [ "$status" -eq 2 ]
}

@test "Bash writes to a protected file are blocked; reads and other writes aren't" {
  run bash_cmd "echo 'exit 0' > .claude/hooks/verify-completion.sh";  [ "$status" -eq 2 ]
  run bash_cmd "printf x >>pytest.ini";                                [ "$status" -eq 2 ]
  run bash_cmd "sed -i '' 's/strict/loose/' tsconfig.json";            [ "$status" -eq 2 ]
  run bash_cmd "cp /tmp/x .github/workflows/ci.yml";                   [ "$status" -eq 2 ]
  run bash_cmd "rm -f .eslintrc.json";                                 [ "$status" -eq 2 ]
  run bash_cmd "cat pytest.ini | tee out.txt";                         [ "$status" -eq 0 ]
  run bash_cmd "sed -n 1,5p tsconfig.json";                            [ "$status" -eq 0 ]
  run bash_cmd "echo hi > notes.txt";                                  [ "$status" -eq 0 ]
}

@test "git commit --no-verify, -n, or core.hooksPath is blocked; a message that mentions them isn't" {
  run bash_cmd "git commit --no-verify -m wip";                   [ "$status" -eq 2 ]
  run bash_cmd "git add -A && git commit -nm wip";                [ "$status" -eq 2 ]
  run bash_cmd "quorum-git -C . commit -an -m wip";               [ "$status" -eq 2 ]
  run bash_cmd "git -c core.hooksPath=/dev/null commit -m wip";   [ "$status" -eq 2 ]
  run bash_cmd "git commit -m 'drop --no-verify and -n from the docs'"; [ "$status" -eq 0 ]
  run bash_cmd "git commit --amend --no-edit";                    [ "$status" -eq 0 ]
  run bash_cmd "git log -n 3";                                    [ "$status" -eq 0 ]
}

@test "the task's own rd.md and eval.md are locked once its build starts, by Edit, Write, or Bash; other files aren't" {
  # A fast-path task is BUILDING while it writes its spec: no base_sha yet, so the spec is still open.
  run edit .tasks/demo/eval.md;               [ "$status" -eq 0 ]
  run edit .tasks/demo/rd.md Write;           [ "$status" -eq 0 ]
  run edit pytest.ini;                        [ "$status" -eq 2 ]
  "$BIN/quorum-state" --task demo set base_sha 0123456789abcdef0123456789abcdef01234567
  run edit .tasks/demo/eval.md;               [ "$status" -eq 2 ]
  run edit "$WORK/.tasks/demo/rd.md" Write;   [ "$status" -eq 2 ]
  run bash_cmd "sed -i '' 's/3 rows/0 rows/' .tasks/demo/eval.md";  [ "$status" -eq 2 ]
  run bash_cmd "cat > .tasks/demo/eval.md <<'MD'";                  [ "$status" -eq 2 ]
  run edit .tasks/demo/plan.md;               [ "$status" -eq 0 ]
  run edit .tasks/demo/review/round-1/logic.md Write; [ "$status" -eq 0 ]
  run edit .tasks/other/eval.md;              [ "$status" -eq 0 ]
  "$BIN/quorum-state" --task demo push unlocked .tasks/demo/eval.md
  run edit .tasks/demo/eval.md;               [ "$status" -eq 0 ]
}

@test "a pattern rule the repo learned blocks matching new code in matching files, during a task only" {
  "$BIN/quorum-learned-rule" pattern add "app/*.py" "','\\.join\\(" "Use write_csv(); never join fields by hand." >/dev/null
  write() { jq -n --arg p "$1" --arg c "$2" '{hook_event_name: "PreToolUse", tool_name: "Write", tool_input: {file_path: $p, content: $c}}' | "$HOOKS/protect-checks.sh"; }
  change() { jq -n --arg p "$1" --arg c "$2" '{hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: {file_path: $p, old_string: "x", new_string: $c}}' | "$HOOKS/protect-checks.sh"; }
  run write app/report.py "print(','.join(row))"
  [ "$status" -eq 2 ]; [[ "$output" == *"matches a rule the repo learned: Use write_csv(); never join fields by hand."* ]]
  run change app/export.py "x = ','.join(r)";                 [ "$status" -eq 2 ]
  run write tests/test_report.py "assert ','.join(a) == b";   [ "$status" -eq 0 ]
  run write app/report.py "write_csv(rows)";                  [ "$status" -eq 0 ]
  "$BIN/quorum-state" --task demo set status PLANNING
  run write app/report.py "print(','.join(row))";             [ "$status" -eq 0 ]
}
