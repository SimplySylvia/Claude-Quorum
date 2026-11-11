#!/usr/bin/env bats
load ../helpers

setup() { make_repo; }
teardown() { cleanup_repo; }

# kept DIR CATEGORY...: a survivors.md in .tasks/DIR with one [IMPORTANT] finding per category.
kept() {
  local dir=".tasks/$1"; shift
  mkdir -p "$dir"
  local c n=1
  for c in "$@"; do
    printf '[IMPORTANT] app/report.py:%s — Pattern Category: %s\nConfidence: 90\n\n' "$n" "$c"
    n=$((n + 1))
  done > "$dir/survivors.md"
}

@test "a category kept in two rounds of a task is a repeat; one kept once is not" {
  kept export-csv/review/round-1 "Unescaped CSV fields" "Missing timeout"
  kept export-csv/review/round-2 "unescaped  CSV fields"
  run "$BIN/quorum-lessons" export-csv
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf 'repeat\tUnescaped CSV fields\tround-1 round-2')" ]
}

@test "a category another task or review kept too is reported with where" {
  kept export-csv/review/round-1 "Unescaped CSV fields"
  kept import-csv/review/round-2 "Unescaped CSV fields"
  kept review-pr-7/run-1 "Unescaped CSV fields" "Missing timeout"
  run "$BIN/quorum-lessons" export-csv
  [ "$output" = "$(printf 'elsewhere\tUnescaped CSV fields\timport-csv review-pr-7')" ]
  # a standalone review's runs count as its rounds
  kept review-pr-7/run-2 "Missing timeout"
  run "$BIN/quorum-lessons" review-pr-7
  [ "$(printf '%s\n' "$output" | grep -c '^repeat')" -eq 1 ]
  printf '%s\n' "$output" | grep -qF "$(printf 'repeat\tMissing timeout\trun-1 run-2')"
}

@test "prints nothing without lessons, and refuses an unknown or invalid slug" {
  kept export-csv/review/round-1 "Unescaped CSV fields"
  run "$BIN/quorum-lessons" export-csv
  [ "$status" -eq 0 ]; [ -z "$output" ]
  run "$BIN/quorum-lessons" nope;  [ "$status" -eq 1 ]
  run "$BIN/quorum-lessons" ../x;  [ "$status" -eq 1 ]
  run "$BIN/quorum-lessons";       [ "$status" -eq 1 ]
}

@test "history gathers what other tasks learned, and nothing about the task itself" {
  printf '# Review\n\n## 6. Learned Rules (Self-Updating Project Memory)\n- All CSV output goes through write_csv(). (export, 2026-11-01)\n' > REVIEW.md
  mkdir -p .tasks/old-halt .tasks/old-blind/blind .tasks/new-task
  printf -- '---\nslug: old-halt\nstatus: HALTED\n---\n## Round 3\nx\n\n## Post-mortem\n- **What kept failing:** Unescaped CSV fields, rounds 1-3.\n- **Why:** two writers.\n\n## Later note\nignore me\n' > .tasks/old-halt/state.md
  printf -- '---\nslug: old-blind\n---\n' > .tasks/old-blind/state.md
  printf 'Triage: old-blind, 2 friction items\n\nCAUSED:\n- "export hung on a big file" — app/report.py:40: reads it all into memory\n\nRELATED:\n- "slow help" — old\n' > .tasks/old-blind/blind/triage-1.md
  kept old-blind/review/round-1 "Missing timeout"
  kept old-blind/review/round-2 "missing timeout"
  printf 'DROP [IMPORTANT] app/report.py:9 — (b) main() catches OSError at app/report.py:30.\n' > .tasks/old-blind/review/round-1/disputes.md
  printf -- '---\nslug: new-task\n---\n## Post-mortem\n- mine, leave out\n' > .tasks/new-task/state.md
  kept new-task/review/round-1 "Own category"
  kept new-task/review/round-2 "Own category"
  run "$BIN/quorum-lessons" history new-task
  [ "$status" -eq 0 ]
  [[ "$output" == "# What earlier work in this repo learned"* ]]
  [[ "$output" == *"- All CSV output goes through write_csv(). (export, 2026-11-01)"* ]]
  [[ "$output" == *"### old-halt"*"Unescaped CSV fields, rounds 1-3."*"two writers."* ]]
  [[ "$output" != *"ignore me"* && "$output" != *"mine, leave out"* && "$output" != *"Own category"* ]]
  [[ "$output" == *'- old-blind: "export hung on a big file" — app/report.py:40'* ]]
  [[ "$output" != *"slow help"* ]]
  [[ "$output" == *"- old-blind: [IMPORTANT] app/report.py:9"* ]]
  [[ "$output" == *"- Missing timeout (old-blind, 2 rounds)"* ]]
}

@test "history prints nothing in a repo with nothing learned yet" {
  mkdir -p .tasks/new-task
  run "$BIN/quorum-lessons" history new-task
  [ "$status" -eq 0 ]; [ -z "$output" ]
}
