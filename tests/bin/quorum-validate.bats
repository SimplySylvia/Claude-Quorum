#!/usr/bin/env bats
load ../helpers

setup() {
  make_repo
  mkdir -p .tasks/demo
  "$BIN/quorum-state" --task demo init MEDIUM PLANNING
  "$BIN/quorum-active-task" --set demo
  cat > .tasks/demo/rd.md <<'MD'
# Export the sales rows as CSV

## Goal
Users can export rows.

## Requirements
1. **Export prints CSV.** `report.py export` prints the rows as RFC 4180 CSV.
2. **Fields are quoted.** A name with a comma is quoted.
3. **Docs:** add `export` to the README's command list.

## Non-goals
- No Excel output.
MD
  cat > .tasks/demo/eval.md <<'MD'
# Eval

## Task checks
| # | Requirement | Command | Passes when |
|---|---|---|---|
| 1 | Export prints CSV | `python3 app/report.py export` | a header and 12 rows |
| 1b | Export prints CSV | `python3 app/report.py export tests/two.json` | 2 rows |
| 2 | Fields are quoted | `python3 -m pytest -k quotes` | 1 passed |
| 3 | Docs | `grep -n export README.md` | a line in the command list |

## Edge cases
- empty file
MD
}
teardown() { cleanup_repo; }
qv() { "$BIN/quorum-validate" "$@"; }

@test "spec: a spec whose requirements and rows match passes with no output" {
  run qv spec
  [ "$status" -eq 0 ]; [ -z "$output" ]
}

@test "spec: a requirement with no row, a row with no requirement, and an empty command are errors" {
  cat > .tasks/demo/eval.md <<'MD'
## Task checks
| # | Requirement | Command | Passes when |
|---|---|---|---|
| 1 | Export prints CSV | `python3 app/report.py export` | a header and 12 rows |
| 3 | Docs | `grep -n export README.md` | listed |
| 3b | Docs | | something |
| 7 | Stray | `true` | ok |
MD
  run qv spec
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: requirement 2 has no row under eval.md's Task checks"* ]]
  [[ "$output" == *"ERROR: eval.md row 7 names no requirement in rd.md"* ]]
  [[ "$output" == *"ERROR: eval.md row 3b has no command"* ]]
  [ "$(printf '%s\n' "$output" | grep -c '^ERROR')" -eq 3 ]
}

@test "spec: vague words are warnings, not errors, and words inside code don't count" {
  sed -i.bak 's/A name with a comma is quoted./Quoting is robust and fast, and \`--fast-mode\` stays./' .tasks/demo/rd.md
  run qv spec
  [ "$status" -eq 0 ]
  [ "$output" = 'WARN: requirement 2 says "fast, robust": say what a check would measure instead' ]
}

@test "spec: an older eval.md without a Requirement column, and a row covering two requirements" {
  cat > .tasks/demo/eval.md <<'MD'
## Task checks
| # | Command | Passes when |
|---|---|---|
| 1, 2 | `python3 app/report.py export` | quoted CSV |
| 3 | `grep -n export README.md` | listed |
MD
  run qv spec
  [ "$status" -eq 0 ]
}

@test "spec: no requirements, or the same number twice, is an error" {
  printf '# T\n\n## Requirements\n1. One.\n1. Again.\n' > .tasks/demo/rd.md
  run qv spec
  [[ "$output" == *"ERROR: rd.md numbers requirement 1 more than once"* ]]
  printf '# T\n\n## Requirements\n- not numbered\n' > .tasks/demo/rd.md
  run qv spec
  [ "$status" -eq 1 ]; [[ "$output" == *"no numbered requirements"* ]]
}

@test "plan: every step names real requirements, and every requirement has a step" {
  cat > .tasks/demo/plan.md <<'MD'
# Plan

## Steps
1. **Add export** — `app/report.py` · requirements: 1, 2
   - Reuses: `app/report.py:8`
2. **Document it** — `README.md` · requirements: 3

## Tests
MD
  run qv plan; [ "$status" -eq 0 ]; [ -z "$output" ]
  cat > .tasks/demo/plan.md <<'MD'
## Steps
1. **Add export** — `app/report.py` · requirements: 1
2. **Document it** — `README.md` · requirements: 3, 9
3. **Tidy up** — `app/util.py`
MD
  run qv plan
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: plan.md step 2 names requirement 9, which rd.md doesn't have"* ]]
  [[ "$output" == *"ERROR: plan.md step 3 names no requirements"* ]]
  [[ "$output" == *"ERROR: requirement 2 has no step in plan.md"* ]]
}

@test "proof: every requirement needs a verdict, MET with evidence; anything else fails" {
  cat > .tasks/demo/proof-final.md <<'MD'
Proof: demo at abc1234
Result: ALL PASS

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | export | PASS | 12 rows |

## Requirements
| Req | Verdict | Evidence |
|---|---|---|
| 1 | MET | rows 1, 1b pass; `app/report.py:41` export() is called from main() at :60 |
| 2 | MET | row 2 passes; `app/report.py:44` uses csv.writer |
| 3 | MET | row 3: README.md:14 |
MD
  run qv proof; [ "$status" -eq 0 ]; [ -z "$output" ]
  sed -i.bak 's/^| 2 | MET | .*/| 2 | PARTIAL | quotes commas, not quotes inside a field |/; s/^| 3 | MET | .*/| 3 | MET | |/' .tasks/demo/proof-final.md
  run qv proof
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: requirement 2 is PARTIAL: quotes commas, not quotes inside a field"* ]]
  [[ "$output" == *"ERROR: requirement 3 is MET with no evidence"* ]]
  sed -i.bak '/^| 3 |/d' .tasks/demo/proof-final.md
  run qv proof
  [[ "$output" == *"ERROR: proof-final.md gives requirement 3 no verdict"* ]]
}

@test "quorum-state refuses READY until every requirement in rd.md has a MET verdict" {
  git -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m head
  printf 'Proof: demo at %s\nResult: ALL PASS\n\n## Requirements\n| Req | Verdict | Evidence |\n|---|---|---|\n| 1 | MET | row 1 |\n| 2 | MISSING | no quoting in export() |\n| 3 | MET | README.md:14 |\n' \
    "$(git rev-parse --short HEAD)" > .tasks/demo/proof-final.md
  run "$BIN/quorum-state" set status READY
  [ "$status" -eq 1 ]
  [[ "$output" == *"not every requirement is met"* ]]; [[ "$output" == *"requirement 2 is MISSING"* ]]
  sed -i.bak 's/| 2 | MISSING | no quoting in export() |/| 2 | MET | row 2; app\/report.py:44 |/' .tasks/demo/proof-final.md
  run "$BIN/quorum-state" set status READY
  [ "$status" -eq 0 ]
}

@test "proof: a bug fix also needs Bug: VERIFIED" {
  "$BIN/quorum-state" --task demo set bug true
  printf 'Proof: demo at abc1234\nResult: ALL PASS\n\n## Requirements\n| Req | Verdict | Evidence |\n|---|---|---|\n| 1 | MET | a |\n| 2 | MET | b |\n| 3 | MET | c |\n' > .tasks/demo/proof-final.md
  run "$BIN/quorum-validate" proof
  [ "$status" -eq 1 ]; [[ "$output" == *'no "Bug:" verdict'* ]]
  printf '\nBug: PARTIAL (passes now; not shown failing on the old code)\n' >> .tasks/demo/proof-final.md
  run "$BIN/quorum-validate" proof
  [[ "$output" == *"the bug isn't verified fixed: Bug: PARTIAL"* ]]
  sed -i.bak 's/^Bug: PARTIAL.*/Bug: VERIFIED (row 1b fails on the old code; row 1 passes at HEAD)/' .tasks/demo/proof-final.md
  run "$BIN/quorum-validate" proof; [ "$status" -eq 0 ]
  "$BIN/quorum-state" --task demo set bug false
  sed -i.bak '/^Bug:/d' .tasks/demo/proof-final.md
  run "$BIN/quorum-validate" proof; [ "$status" -eq 0 ]
}
