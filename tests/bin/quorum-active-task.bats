#!/usr/bin/env bats
load ../helpers

setup() { make_repo; }
teardown() { cleanup_repo; }

@test "no task: exits 1 with a hint" {
  run "$BIN/quorum-active-task"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no active task"* ]]
}

@test "feat/<slug> branch with a task folder wins" {
  mkdir -p .tasks/export-csv .tasks/other
  echo other > .tasks/.active
  git checkout -q -b feat/export-csv
  run "$BIN/quorum-active-task"
  [ "$status" -eq 0 ]
  [ "$output" = "export-csv" ]
}

@test "fix/<slug> branch works too" {
  mkdir -p .tasks/null-crash
  git checkout -q -b fix/null-crash
  run "$BIN/quorum-active-task"
  [ "$output" = "null-crash" ]
}

@test "branch without a task folder falls back to .tasks/.active" {
  mkdir -p .tasks/from-file
  echo from-file > .tasks/.active
  git checkout -q -b feat/no-folder
  run "$BIN/quorum-active-task"
  [ "$status" -eq 0 ]
  [ "$output" = "from-file" ]
}

@test ".tasks/.active pointing at a missing folder is ignored" {
  mkdir -p .tasks
  echo gone > .tasks/.active
  run "$BIN/quorum-active-task"
  [ "$status" -eq 1 ]
}

@test "--set writes .tasks/.active, --clear removes it" {
  mkdir -p .tasks/demo
  run "$BIN/quorum-active-task" --set demo
  [ "$status" -eq 0 ]
  [ "$(cat .tasks/.active)" = "demo" ]
  run "$BIN/quorum-active-task" --clear
  [ ! -e .tasks/.active ]
}

@test "--set refuses a missing folder and a bad slug" {
  mkdir -p .tasks
  run "$BIN/quorum-active-task" --set missing
  [ "$status" -eq 1 ]
  run "$BIN/quorum-active-task" --set "../escape"
  [ "$status" -eq 1 ]
  [[ "$output" == *"invalid slug"* ]]
}

@test "CLAUDE_PROJECT_DIR sets the root" {
  other="$(mktemp -d)"; mkdir -p "$other/.tasks/elsewhere"; echo elsewhere > "$other/.tasks/.active"
  CLAUDE_PROJECT_DIR="$other" run "$BIN/quorum-active-task"
  [ "$output" = "elsewhere" ]
  rm -rf "$other"
}
