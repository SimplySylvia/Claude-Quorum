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
  # another task builds in its own worktree, for the pane's Other tasks list
  [ "$(CLAUDE_PROJECT_DIR="$DEMO/review" "$BIN/quorum-state" --task summary-dollars get status)" = BUILDING ]
  [ "$(git -C "$DEMO/review/.claude/worktrees/summary-dollars" branch --show-current)" = feat/summary-dollars ]
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

@test "review: files.tsv lists an unplanned file and a fix awaiting re-review" {
  run "$SCRIPT" "$DEMO/review"
  [ "$status" -eq 0 ]
  list="$DEMO/review/.tasks/csv-export/files.tsv"
  [ -f "$list" ]
  # app/util.py is in the build commit, but no plan step names it
  [ "$(awk -F'\t' '$4 == "app/util.py" { print $6 }' "$list")" = "-" ]
  # round 1's fix changed app/report.py after round 1's round_shas entry
  [ "$(awk -F'\t' '$4 == "app/report.py" { print $7 }' "$list")" = "1" ]
  r1=$(state review last round_shas)
  head -1 "$list" | grep -q " since=$r1 "
  # the list is recorded after round 1's survivors.md, at least a second later
  recorded=$(head -1 "$list" | sed -n 's/.* recorded=\([0-9][0-9]*\)$/\1/p')
  survivors="$DEMO/review/.tasks/csv-export/review/round-1/survivors.md"
  mtime=$(stat -c %Y "$survivors" 2>/dev/null || stat -f %m "$survivors")
  [ -n "$recorded" ] && [ "$mtime" -lt "$recorded" ]
}

@test "done: the dashboard fixtures match the files the demo writes" {
  run "$SCRIPT" "$DEMO/done" --stage done
  [ "$status" -eq 0 ]
  # The fixture's placeholders, in the order its header comment gives: the time, then full SHAs, then short ones.
  run python3 -I -c '
import json, os, re, sys
fixture, task = sys.argv[1], sys.argv[2]
lines = open(fixture, encoding="utf-8").readlines() if os.path.exists(fixture) else []
line = [l for l in lines if l.startswith("export const DEMO_DONE = ")]
want = json.loads(line[0].split(" = ", 1)[1].rstrip().rstrip(";")) if line else {}
def norm(s):
    s = re.sub(r"recorded=[0-9]+", "recorded=<time>", s)
    s = re.sub(r"[0-9a-f]{40}", "<sha>", s)
    return re.sub(r"(?<![0-9A-Za-z])[0-9a-f]{7,39}(?![0-9A-Za-z])", "<short>", s)
keys = ["state.md", "rd.md", "eval.md", "proof-final.md", "files.tsv", "blind/blind-1.md", "blind/triage-1.md",
        "review/round-1/survivors.md", "review/round-2/survivors.md"]
bad = 0
for k in keys:
    got = norm(open(task + "/" + k, encoding="utf-8").read())
    if k not in want:
        print("missing: " + k); bad = 1
    elif want[k] != got:
        print("differs: " + k); bad = 1
    if k == "files.tsv" and not got.split("\n", 1)[0].endswith("recorded=<time>"):
        print("bad header: files.tsv"); bad = 1
sys.exit(bad)
' "$REPO_ROOT/tests/dashboard/fixtures/demo-done.ts" "$DEMO/done/.tasks/csv-export"
  echo "$output"
  [ "$status" -eq 0 ]
}
