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
