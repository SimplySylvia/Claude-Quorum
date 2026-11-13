#!/usr/bin/env bats
load ../helpers

# A repo in a /quorum:run session; the hook acts only for the session quorum-run enter named, until the build starts.
setup() {
  make_repo
  mkdir -p app && echo 'print(1)' > app/report.py
  "$BIN/quorum-run" enter s1
  export CLAUDE_PROJECT_DIR="$WORK"
}
teardown() { cleanup_repo; }

edit() { jq -n --arg s "${3:-s1}" --arg t "${2:-Edit}" --arg p "$1" --arg a "${4:-}" '{session_id: $s, tool_name: $t, tool_input: {file_path: $p}, agent_type: (if $a == "" then null else $a end)}' | "$HOOKS/run-guard.sh"; }
bash_cmd() { jq -n --arg s "${2:-s1}" --arg c "$1" '{session_id: $s, tool_name: "Bash", tool_input: {command: $c}}' | "$HOOKS/run-guard.sh"; }
task() { mkdir -p ".tasks/$1"; "$BIN/quorum-state" --task "$1" init LOW "$2" >/dev/null; "$BIN/quorum-active-task" --set "$1"; }

@test "before any task exists, the run's main session can't edit the code, but can write .tasks/" {
  run edit app/report.py;                    [ "$status" -eq 2 ]
  [[ "$output" == *"BLOCKED BY QUORUM"* ]]; [[ "$output" == *"the builder writes the code"* ]]; [[ "$output" == *"quorum-run leave s1"* ]]
  run edit "$WORK/README.md" Write;          [ "$status" -eq 2 ]
  run edit .tasks/csv-export/rd.md Write;    [ "$status" -eq 0 ]
  run edit "$BATS_TEST_TMPDIR/scratch.py" Write; [ "$status" -eq 0 ]
}

@test "commits are blocked before the build; Bash writes, reading, .tasks/, and branching aren't" {
  run bash_cmd 'git add -A && git commit -m fix';  [ "$status" -eq 2 ]
  [[ "$output" == *"git commit changes the code before the build"* ]]
  run bash_cmd 'git -C . merge fix/x';             [ "$status" -eq 2 ]
  # The guard doesn't read Bash for the files it writes (see the hook): a run's Bash writes go through.
  run bash_cmd "sed -i '' s/a/b/ app/report.py";   [ "$status" -eq 0 ]
  run bash_cmd 'grep -n def app/report.py';        [ "$status" -eq 0 ]
  run bash_cmd 'echo repro > .tasks/csv-export/repro.txt'; [ "$status" -eq 0 ]
  run bash_cmd 'git switch -c fix/csv-export';     [ "$status" -eq 0 ]
}

@test "the block holds through spec and plan, and lifts once the build starts" {
  task csv-export PLANNING
  run edit app/report.py;                    [ "$status" -eq 2 ]
  "$BIN/quorum-state" --task csv-export set status BUILDING
  run edit app/report.py;                    [ "$status" -eq 2 ]
  "$BIN/quorum-state" --task csv-export set base_sha "$(git rev-parse HEAD)"
  run edit app/report.py;                    [ "$status" -eq 0 ]
}

@test "Quorum's agents, other sessions, and the session after quorum-run leave aren't affected" {
  run edit app/report.py Edit s1 quorum:builder; [ "$status" -eq 0 ]
  run edit app/report.py Write s1 quorum:prover; [ "$status" -eq 0 ]
  run edit app/report.py Edit s2;            [ "$status" -eq 0 ]
  run bash_cmd 'git commit -m x' s2;         [ "$status" -eq 0 ]
  "$BIN/quorum-run" leave s1
  run edit app/report.py;                    [ "$status" -eq 0 ]
}

@test "other tools and unreadable input pass" {
  run bash -c "jq -n '{session_id: \"s1\", tool_name: \"Read\", tool_input: {file_path: \"app/report.py\"}}' | '$HOOKS/run-guard.sh'"; [ "$status" -eq 0 ]
  run bash -c "printf 'not json' | '$HOOKS/run-guard.sh'"; [ "$status" -eq 0 ]
}

@test "a run's ordinary Bash work isn't blocked: cds into .tasks/, heredocs, variables, sed scripts" {
  mkdir -p .tasks/csv-export/plan-review/round-1 && echo x > tests_file.py
  run bash_cmd ': > $TMPDIR/empty.json; python3 app/report.py summary $TMPDIR/empty.json';  [ "$status" -eq 0 ]
  run bash_cmd "cd .tasks/csv-export/plan-review/round-1 && cat > logic.md <<'EOF2'
[IMPORTANT] python3 app/report.py > tests/test_report.py
EOF2
cd ../../../..";                                                                [ "$status" -eq 0 ]
  run bash_cmd 'cat > votes.md <<EOF2
Summary: 0 issues
EOF2';                                                                          [ "$status" -eq 0 ]
  run bash_cmd "sed -i '' 's|tests_file.py|x|' .tasks/csv-export/eval.md";       [ "$status" -eq 0 ]
}
