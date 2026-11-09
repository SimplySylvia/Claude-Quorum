#!/usr/bin/env bats
load ../helpers

setup() { DEMO="$(mktemp -d)"; unset CLAUDE_PROJECT_DIR; }
teardown() { rm -rf "$DEMO"; }

SCRIPT="$REPO_ROOT/assets/src/dashboard-demo.sh"
state() { CLAUDE_PROJECT_DIR="$DEMO/$1" "$BIN/quorum-state" --task csv-export "${@:2}"; }

@test "review: round 2 on the task branch, two reviewers in, the build proof behind HEAD" {
  run "$SCRIPT" "$DEMO/review"
  [ "$status" -eq 0 ]
  [ "$(git -C "$DEMO/review" branch --show-current)" = "feat/csv-export" ]
  run state review get status; [ "$output" = "IN_REVIEW" ]
  run state review get round;  [ "$output" = "2" ]
  [ -f "$DEMO/review/.tasks/csv-export/review/round-2/logic.md" ]
  [ ! -e "$DEMO/review/.tasks/csv-export/review/round-2/votes.md" ]
  grep -q '^Result: 1 FAIL' "$DEMO/review/.tasks/csv-export/proof-build.md"
  [ -z "$(git -C "$DEMO/review" status --porcelain)" ]
}

@test "blind: the review converged and blind run 1 is saved" {
  run "$SCRIPT" "$DEMO/blind" --stage blind
  [ "$status" -eq 0 ]
  run state blind get status;     [ "$output" = "BLIND-TEST" ]
  run state blind get blind_runs; [ "$output" = "1" ]
  grep -q '^Result: REACHED' "$DEMO/blind/.tasks/csv-export/blind/blind-1.md"
}

@test "done: AWAITING-HUMAN passes the proof gate, with the PR recorded" {
  run "$SCRIPT" "$DEMO/done" --stage done
  [ "$status" -eq 0 ]
  run state done get status; [ "$output" = "AWAITING-HUMAN" ]
  run state done get pr;     [ "$output" = "https://github.com/acme/sales-report/pull/42" ]
  grep -q "^Proof: csv-export at $(git -C "$DEMO/done" rev-parse --short HEAD)" "$DEMO/done/.tasks/csv-export/proof-final.md"
}

@test "refuses an existing folder and an unknown stage" {
  mkdir "$DEMO/taken"
  run "$SCRIPT" "$DEMO/taken";                [ "$status" -eq 1 ]
  run "$SCRIPT" "$DEMO/x" --stage shipping;   [ "$status" -eq 1 ]
}
