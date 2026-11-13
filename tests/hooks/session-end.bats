#!/usr/bin/env bats
load ../helpers

# A repo with a map, two map sessions, and two run sessions; the hook ends only the session that ended.
setup() {
  make_repo
  "$BIN/quorum-map" --map billing init "Usage billing" >/dev/null
  "$BIN/quorum-map" enter s1 billing
  "$BIN/quorum-map" enter s2 billing
  "$BIN/quorum-run" enter s1
  "$BIN/quorum-run" enter s2
}
teardown() { cleanup_repo; }

end() { jq -n --arg s "$1" --arg c "${2:-$WORK}" '{session_id: $s, cwd: $c, hook_event_name: "SessionEnd", reason: "prompt_input_exit"}' | "$HOOKS/session-end.sh"; }

@test "the session that ended leaves its map session, and only its own" {
  run end s1; [ "$status" -eq 0 ]; [ -z "$output" ]
  [ ! -e .tasks/.map-sessions/s1 ] && [ ! -e .tasks/.run-sessions/s1 ]
  [ -f .tasks/.map-sessions/s2 ] && [ -f .tasks/.run-sessions/s2 ]
}

@test "it finds the marker from a subdirectory" {
  mkdir -p app
  run end s1 "$WORK/app"; [ "$status" -eq 0 ]
  [ ! -e .tasks/.map-sessions/s1 ]
}

@test "a session with no map session, a bad id, or no repo is left alone, and nothing is created" {
  rm -rf .tasks/.map-sessions .tasks/.run-sessions
  run end s3;               [ "$status" -eq 0 ]; [ ! -e .tasks/.map-sessions ] && [ ! -e .tasks/.run-sessions ]
  run end '../map-billing'; [ "$status" -eq 0 ]; [ -f .tasks/map-billing/map.md ]
  run end s1 "$BATS_TEST_TMPDIR"; [ "$status" -eq 0 ]
  run bash -c "printf 'not json' | '$HOOKS/session-end.sh'"; [ "$status" -eq 0 ]
}

@test "a session with only a run session leaves it" {
  "$BIN/quorum-map" leave s1
  run end s1; [ "$status" -eq 0 ]
  [ ! -e .tasks/.run-sessions/s1 ] && [ -f .tasks/.run-sessions/s2 ]
}
