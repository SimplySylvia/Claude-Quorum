#!/usr/bin/env bats
load ../helpers

setup() { make_repo; }
teardown() { cleanup_repo; }

# review NAME STATUS SESSION [RUNS]: a review's state.md, owned by SESSION, with RUNS run folders.
review() {
  mkdir -p ".tasks/$1"
  "$BIN/quorum-state" --task "$1" init MEDIUM "$2"
  "$BIN/quorum-state" --task "$1" set kind review
  [ -z "$3" ] || "$BIN/quorum-state" --task "$1" set session "$3"
  local n=1
  while [ "$n" -le "${4:-0}" ]; do mkdir -p ".tasks/$1/run-$n"; n=$((n + 1)); done
}
st() { "$BIN/quorum-state" --task "$1" get status; }

@test "heal marks this session's unfinished reviews INTERRUPTED and logs the run" {
  review review-pr-1 REVIEWING sess-a 2
  review review-pr-2 FIXING sess-a 1
  review review-pr-3 REVIEWED sess-a 1
  run "$BIN/quorum-reviews" heal sess-a
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | sort)" = "$(printf 'review-pr-1\nreview-pr-2')" ]
  [ "$(st review-pr-1)" = INTERRUPTED ]
  [ "$(st review-pr-2)" = INTERRUPTED ]
  [ "$(st review-pr-3)" = REVIEWED ]
  grep -q '^## Run 2 interrupted$' .tasks/review-pr-1/state.md
  grep -q 'while FIXING' .tasks/review-pr-2/state.md
}

@test "heal leaves another session's running review alone, unless it's the one restarting" {
  review review-pr-1 REVIEWING sess-b 1
  review review-pr-2 REVIEWING sess-b 1
  review review-old REVIEWING "" 1
  run "$BIN/quorum-reviews" heal sess-a review-pr-2
  [ "$output" = review-pr-2 ]
  [ "$(st review-pr-1)" = REVIEWING ]
  [ "$(st review-pr-2)" = INTERRUPTED ]
  [ "$(st review-old)" = REVIEWING ]
}

@test "heal ignores a task folder named review-*, and a session id that's an unfilled placeholder" {
  mkdir -p .tasks/review-copy
  "$BIN/quorum-state" --task review-copy init MEDIUM BUILDING
  review review-pr-1 REVIEWING sess-a
  run "$BIN/quorum-reviews" heal '${CLAUDE_SESSION_ID}'
  [ "$status" -eq 0 ]; [ -z "$output" ]
  [ "$(st review-copy)" = BUILDING ]
  [ "$(st review-pr-1)" = REVIEWING ]
}

@test "heal removes a fix marker this session wrote, or one whose review isn't FIXING; keeps another live session's" {
  review review-pr-1 FIXING sess-b 1
  printf 'review-pr-1\nsess-b\n' > .tasks/.review-fix-active
  "$BIN/quorum-reviews" heal sess-a
  [ -f .tasks/.review-fix-active ]

  "$BIN/quorum-reviews" heal sess-b
  [ ! -f .tasks/.review-fix-active ]
  [ "$(st review-pr-1)" = INTERRUPTED ]

  printf 'review-pr-1\nsess-b\n' > .tasks/.review-fix-active
  "$BIN/quorum-reviews" heal sess-a
  [ ! -f .tasks/.review-fix-active ]

  printf 'review-gone\n' > .tasks/.review-fix-active
  "$BIN/quorum-reviews" heal sess-a
  [ ! -f .tasks/.review-fix-active ]
}

@test "heal with no .tasks folder does nothing" {
  run "$BIN/quorum-reviews" heal sess-a
  [ "$status" -eq 0 ]; [ -z "$output" ]
}

@test "anything but heal is a usage error" {
  run "$BIN/quorum-reviews" list
  [ "$status" -eq 1 ]
  [[ "$output" == *usage* ]]
}
