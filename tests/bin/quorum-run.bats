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

@test "enter records --until and --yes below the start time, in either order" {
  "$BIN/quorum-run" enter s1 --until review --yes
  "$BIN/quorum-run" enter s2 --yes --until review
  for s in s1 s2; do
    [ "$(wc -l < ".tasks/.run-sessions/$s" | tr -d ' ')" = 3 ]
    [[ "$(sed -n 1p ".tasks/.run-sessions/$s")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}$ ]]
    [ "$(sed -n 2p ".tasks/.run-sessions/$s")" = "until review" ]
    [ "$(sed -n 3p ".tasks/.run-sessions/$s")" = "yes" ]
  done
  for stage in spec plan build review blind pr; do
    "$BIN/quorum-run" enter s3 --until "$stage"
    [ "$(sed -n 2p .tasks/.run-sessions/s3)" = "until $stage" ]
    [ "$(wc -l < .tasks/.run-sessions/s3 | tr -d ' ')" = 2 ]
  done
  "$BIN/quorum-run" enter s4 --yes
  [ "$(sed -n 2p .tasks/.run-sessions/s4)" = "yes" ]
  [ "$(wc -l < .tasks/.run-sessions/s4 | tr -d ' ')" = 2 ]
}

@test "enter with no flags writes the start time alone, and sessions prints the session and the time only" {
  "$BIN/quorum-run" enter s1
  [ "$(wc -l < .tasks/.run-sessions/s1 | tr -d ' ')" = 1 ]
  [[ "$(cat .tasks/.run-sessions/s1)" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}$ ]]
  "$BIN/quorum-run" enter s2 --until review --yes
  run "$BIN/quorum-run" sessions; [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 2 ]
  [[ "${lines[0]}" =~ ^s1$'\t'[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}$ ]]
  [[ "${lines[1]}" =~ ^s2$'\t'[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}$ ]]
}

@test "enter refuses an unknown stage, --until with no stage, and an unknown argument, and leaves the marker as it was" {
  "$BIN/quorum-run" enter s1 --until plan
  printf 'sentinel\n' > .tasks/.run-sessions/s1
  run "$BIN/quorum-run" enter s1 --until nope
  [ "$status" -eq 2 ]; [[ "$output" == quorum-run:* ]]
  [ "$(cat .tasks/.run-sessions/s1)" = "sentinel" ]
  run "$BIN/quorum-run" enter s1 --until
  [ "$status" -eq 2 ]; [[ "$output" == quorum-run:* ]]
  [ "$(cat .tasks/.run-sessions/s1)" = "sentinel" ]
  run "$BIN/quorum-run" enter s1 --yes --until
  [ "$status" -eq 2 ]; [[ "$output" == quorum-run:* ]]
  [ "$(cat .tasks/.run-sessions/s1)" = "sentinel" ]
  run "$BIN/quorum-run" enter s1 --bogus
  [ "$status" -eq 2 ]; [[ "$output" == quorum-run:* ]]
  [ "$(cat .tasks/.run-sessions/s1)" = "sentinel" ]
  run "$BIN/quorum-run" enter s1 --yes extra
  [ "$status" -eq 2 ]; [[ "$output" == quorum-run:* ]]
  [ "$(cat .tasks/.run-sessions/s1)" = "sentinel" ]
  run "$BIN/quorum-run" enter fresh --until nope
  [ "$status" -eq 2 ]
  [ ! -e .tasks/.run-sessions/fresh ]
}

@test "escalated adds its line to a marker once, sessions still prints line 1, and enter writes the marker afresh" {
  "$BIN/quorum-run" enter s1 --until review --yes
  "$BIN/quorum-run" escalated s1
  "$BIN/quorum-run" escalated s1
  [ "$(wc -l < .tasks/.run-sessions/s1 | tr -d ' ')" = 4 ]
  [ "$(sed -n 2p .tasks/.run-sessions/s1)" = "until review" ]
  [ "$(sed -n 3p .tasks/.run-sessions/s1)" = "yes" ]
  [ "$(sed -n 4p .tasks/.run-sessions/s1)" = "escalated" ]
  run "$BIN/quorum-run" sessions; [ "$status" -eq 0 ]
  [[ "$output" =~ ^s1$'\t'[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}$ ]]
  "$BIN/quorum-run" enter s1
  [ "$(wc -l < .tasks/.run-sessions/s1 | tr -d ' ')" = 1 ]
  "$BIN/quorum-run" escalated s1
  "$BIN/quorum-run" leave s1
  [ ! -e .tasks/.run-sessions/s1 ]
}

@test "escalated writes nothing for a session with no marker, and refuses a bad session id" {
  run "$BIN/quorum-run" escalated fresh; [ "$status" -eq 0 ]; [ -z "$output" ]
  [ ! -e .tasks/.run-sessions/fresh ]
  run "$BIN/quorum-run" escalated;        [ "$status" -eq 2 ]
  run "$BIN/quorum-run" escalated '../x'; [ "$status" -eq 2 ]
}
