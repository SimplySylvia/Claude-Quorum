#!/usr/bin/env bats
load ../helpers

setup() {
  make_repo
  "$BIN/quorum-state" --task demo init MEDIUM BUILDING
  "$BIN/quorum-active-task" --set demo
  cat > .tasks/demo/plan.md <<'MD'
# Plan: Export CSV

## Steps
1. **Add write_csv()** — `app/report.py` · requirements: 1
   - Reuses: `app/report.py:14` money()
   - Convention: no broad except

2. **Add the export command** — `app/report.py` · requirements: 1, 2
3. **Copy the summary test for export** — `tests/test_report.py` · requirements: 1 · mechanical
   - Reuses: `tests/test_report.py:9` the summary test's setup
4. **Document it** — `README.md` · requirements: 3

## Tests
1. not a step
MD
}
teardown() { cleanup_repo; }
qp() { "$BIN/quorum-plan" "$@"; }

@test "steps lists only the numbered lines under ## Steps" {
  [ "$(qp steps | tr '\n' ' ')" = "1 2 3 4 " ]
}

@test "a plan of 4 or more steps is built in slices, unless it's on the fast path" {
  qp sliced
  "$BIN/quorum-state" --task demo set fast true
  run qp sliced; [ "$status" -eq 1 ]
  "$BIN/quorum-state" --task demo set fast false
  python3 - <<'PY'
p = ".tasks/demo/plan.md"; s = open(p).read(); s = s.replace("4. **Document it**", "- **Document it**"); open(p, "w").write(s)
PY
  run qp sliced; [ "$status" -eq 1 ]
}

@test "next is the first step not built yet, and nothing once every step is" {
  [ "$(qp next)" = 1 ]
  "$BIN/quorum-state" --task demo push built_steps 1
  "$BIN/quorum-state" --task demo push built_steps 3
  [ "$(qp next)" = 2 ]
  "$BIN/quorum-state" --task demo push built_steps 2
  "$BIN/quorum-state" --task demo push built_steps 4
  run qp next; [ "$status" -eq 1 ]; [ -z "$output" ]
}

@test "mechanical reads the step's own line, and show prints the step with its details" {
  qp mechanical 3
  run qp mechanical 1; [ "$status" -eq 1 ]
  run qp show 1
  [ "${lines[0]}" = '1. **Add write_csv()** — `app/report.py` · requirements: 1' ]
  [ "${lines[2]}" = '   - Convention: no broad except' ]
  [ "${#lines[@]}" -eq 3 ]
  run qp show 9; [ "$status" -eq 2 ]
}
