#!/usr/bin/env bats
load ../helpers

setup() { make_repo; }
teardown() { cleanup_repo; }

@test "enter marks a session, sessions lists it with when it started, and leave removes it" {
  "$BIN/quorum-run" enter s1
  [ -f .tasks/.run-sessions/s1 ]
  run "$BIN/quorum-run" sessions; [ "$status" -eq 0 ]
  [[ "$output" =~ ^s1$'\t'[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}$ ]]
  "$BIN/quorum-run" leave s1
  [ ! -e .tasks/.run-sessions/s1 ]
  [ -z "$("$BIN/quorum-run" sessions)" ]
}

@test "a bad session id or command is refused" {
  run "$BIN/quorum-run" enter '../x'; [ "$status" -eq 2 ]
  run "$BIN/quorum-run" leave;        [ "$status" -eq 2 ]
  run "$BIN/quorum-run" nope;         [ "$status" -eq 2 ]
}
