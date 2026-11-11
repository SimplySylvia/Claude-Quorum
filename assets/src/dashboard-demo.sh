#!/usr/bin/env bash
# Build a demo repo whose .tasks/ holds one Quorum task, for seeing and screenshotting the dashboard.
#
#   assets/src/dashboard-demo.sh DEST [--stage review|blind|done]
#
# DEST becomes the sales-app fixture, bootstrapped for Quorum, on the branch feat/csv-export, with a MEDIUM task
# "csv-export" whose files are what the skills would have saved by then:
#   review  (default) code review round 2: two reviewers replied, two to go; round 1 sent one finding back
#   blind   the review converged and blind test run 1 is in: goal reached, friction triaged
#   done    AWAITING-HUMAN: a passing proof-final.md at HEAD, pr.md drafted, and the PR recorded
# At every stage, a second task, "summary-dollars" (LOW), is building in its own git worktree, so the pane's Other
# tasks list has a row.
# Nothing here calls a model; every file is written as is. Then open Claude Code in DEST with this plugin:
#   cd DEST && claude --plugin-dir <this repo>
# Bash 3.2 compatible.
set -euo pipefail

die() { echo "dashboard-demo.sh: $*" >&2; exit 1; }

dest=${1:-}; [ -n "$dest" ] || die "usage: dashboard-demo.sh DEST [--stage review|blind|done]"
shift
stage=review
while [ $# -gt 0 ]; do
  case "$1" in
    --stage) stage=${2:-}; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
case "$stage" in review|blind|done) ;; *) die "unknown stage: $stage (review, blind, done)" ;; esac
[ ! -e "$dest" ] || die "$dest already exists"

repo=$(cd "$(dirname "$0")/../.." && pwd)
bin="$repo/bin"
mkdir -p "$dest"
dest=$(cd "$dest" && pwd)
cd "$dest"
bash "$repo/evals/_fixture/make.sh" >/dev/null
export CLAUDE_PROJECT_DIR="$dest"

slug=csv-export
task=".tasks/$slug"
state() { "$bin/quorum-state" --task "$slug" "$@"; }
commit() { git add -A && git commit -qm "$1"; }

# ---------------------------------------------------------------- the spec (stage 1)
mkdir -p "$task/spec-review"
cat > "$task/rd.md" <<'MD'
# Export the sales rows as CSV (SALES-12)

- **Slug:** `csv-export`
- **Risk tier:** MEDIUM. It adds a command users run, and its output goes into spreadsheets.
- **UI change:** no. It's a CLI command.

## Goal
Users can run `report.py export` to get the sales rows as a CSV file they can open in a spreadsheet.

Today the only output is the `summary` table, so people copy numbers by hand.

## Requirements
1. **Export prints CSV.** `report.py export [DATA_FILE]` prints the rows of DATA_FILE (default `data/sales.json`)
   as RFC 4180 CSV with a header row.
2. **Fields are quoted.** A customer name with a comma or a quote is quoted, so every row has three columns.
3. **An empty file still has a header.** Exporting a file with no rows prints only the header row.
4. **Docs:** add `export` to the commands in `README.md`.

## Non-goals
- No Excel or JSON output.
- No filtering by region or date; that's SALES-14.
- No change to `summary`.

## Rollback plan (one step)
Revert the merge commit.

## User goal for the blind test
Export the sales data to a CSV file and open it, starting from `python3 app/report.py --help`.
MD
cat > "$task/eval.md" <<'MD'
# Eval: Export the sales rows as CSV

## Fast checks
Run by the Stop hook on every finish: `bash .claude/hooks/verify-completion.sh`.

## Task checks
| # | Requirement | Command | Passes when |
|---|---|---|---|
| 1 | Export prints CSV | `python3 app/report.py export data/sales.json` | a header and one row per sale |
| 1b | Honors DATA_FILE | `python3 app/report.py export tests/data/two.json` | exactly 2 rows after the header |
| 2 | Fields are quoted | `python3 -m pytest tests -k export_quotes` | passes |
| 3 | Empty file has a header | `python3 app/report.py export tests/data/empty.json` | prints only the header |
| 4 | README names export | `grep -n 'export' README.md` | a line under Commands |

## Edge cases
- empty file, a name with a comma, a name with a quote
MD
cat > "$task/research.md" <<'MD'
# Research: csv-export

Recommended: the standard library's `csv.writer` with `lineterminator="\r\n"`, as `app/report.py` already reads
JSON with the standard library only. Python docs, csv module: quoting defaults to QUOTE_MINIMAL.
MD
echo 'Summary: 0 issues found. Ready to build.' > "$task/spec-review/feasibility.md"
cat > "$task/spec-review/improver.md" <<'MD'
Summary: 0 IMPORTANT, 1 NIT, 0 PRE-EXISTING

[NIT] .tasks/csv-export/eval.md:9 — row 1 says "one row per sale"; compare the count with `wc -l`.
MD

"$bin/quorum-state" --task "$slug" init MEDIUM PLANNING
"$bin/quorum-active-task" --set "$slug"
state log <<'MD'

## Spec
MEDIUM: a new command users run. 4 requirements, 5 checks. Spec reviewers: feasibility clean, 1 NIT applied.
MD

# ---------------------------------------------------------------- the plan (stage 2)
cat > "$task/plan.md" <<'MD'
# Plan: csv-export

## Files
- `app/report.py`: add an `export` command next to `summary`; reuse `load()` for DATA_FILE.
- `tests/test_report.py`: tests for quoting and the empty file.
- `README.md`: add `export` under Commands.

## Reuse
- `load(path)` in `app/report.py` reads DATA_FILE; export must call it with the argument, not the default.

## Tests
- `test_export_quotes`: fails today because there is no export command.
MD
for n in 1 2; do
  d="$task/plan-review/round-$n"; mkdir -p "$d"
  for f in logic architecture docs; do echo 'Summary: 0 issues found. Ready to land.' > "$d/$f.md"; done
done
cat > "$task/plan-review/round-1/patterns.md" <<'MD'
Summary: 1 IMPORTANT, 0 NIT, 0 PRE-EXISTING

[IMPORTANT] .tasks/csv-export/plan.md:5 — Pattern Category: Duplicate loader
Mechanism: the plan reads data/sales.json with its own open() call; app/report.py:12 load() already does this.
MD
cp "$task/plan-review/round-1/patterns.md" "$task/plan-review/round-1/candidates.md"
cp "$task/plan-review/round-1/patterns.md" "$task/plan-review/round-1/votes.md"
cp "$task/plan-review/round-1/patterns.md" "$task/plan-review/round-1/survivors.md"
echo 'Summary: 0 issues found. Ready to land.' > "$task/plan-review/round-2/patterns.md"
for f in candidates votes survivors; do echo 'Summary: 0 issues found. Ready to land.' > "$task/plan-review/round-2/$f.md"; done
state set plan_rounds 2
state set plan_approved 2026-11-08
state set status BUILDING
state log <<'MD'

## Plan round 1
Summary: 1 IMPORTANT, 0 NIT, 0 PRE-EXISTING. Duplicate loader: the planner now reuses load().

## Plan round 2
Summary: 0 issues found. Approved 2026-11-08.
MD

# ---------------------------------------------------------------- the build (stage 3)
git switch -q -c "feat/$slug"
state set base_sha "$(git rev-parse HEAD)"
python3 - <<'PY'
p = "app/report.py"
s = open(p).read()
s = s.replace("import json\n", "import csv\nimport json\n", 1)
open(p, "w").write(s)
PY
# shellcheck disable=SC2016  # the backticks are literal Markdown
printf '\n- `python3 app/report.py export [DATA_FILE]`: the rows as CSV\n' >> README.md
commit "Add the export command"
cat > "$task/proof-build.md" <<MD
Proof: $slug at $(git rev-parse --short HEAD)
Result: 1 FAIL

| # | Check | Result | Evidence |
|---|---|---|---|
| fast | bash .claude/hooks/verify-completion.sh | PASS | "All checks passed." |
| 1 | python3 app/report.py export data/sales.json | PASS | header and 12 rows |
| 1b | python3 app/report.py export tests/data/two.json | FAIL | 12 rows; expected 2 |
| 2 | python3 -m pytest tests -k export_quotes | PASS | 1 passed |
| 3 | python3 app/report.py export tests/data/empty.json | PASS | header only |
| 4 | grep -n 'export' README.md | PASS | README.md:14 |

## Failures
### 1b Honors DATA_FILE
Command: python3 app/report.py export tests/data/two.json
Output (last 30 lines):
region,customer,amount
(12 rows)

Working tree unchanged: yes
MD
state set status IN_REVIEW

# ---------------------------------------------------------------- code review round 1 (stage 4)
r1="$task/review/round-1"; mkdir -p "$r1"
cat > "$r1/logic.md" <<'MD'
Summary: 1 IMPORTANT, 1 NIT, 0 PRE-EXISTING

[IMPORTANT] app/report.py:41 — Pattern Category: Ignored argument
Mechanism: export calls load() with no path, so `export tests/data/two.json` prints data/sales.json instead.

[NIT] app/report.py:44 — the writer's lineterminator could be a named constant.
MD
cat > "$r1/architecture.md" <<'MD'
Summary: 0 IMPORTANT, 1 NIT, 0 PRE-EXISTING

[NIT] app/report.py:38 — export and summary could share the argument parsing.
MD
echo 'Summary: 0 issues found. Ready to land.' > "$r1/patterns.md"
echo 'Summary: 0 issues found. Ready to land.' > "$r1/docs.md"
cat "$r1/logic.md" "$r1/architecture.md" > "$r1/candidates.md"
cat > "$r1/votes.md" <<'MD'
Summary: 1 IMPORTANT, 1 NIT, 0 PRE-EXISTING

[IMPORTANT] app/report.py:41 — Pattern Category: Ignored argument
Mechanism: export calls load() with no path, so `export tests/data/two.json` prints data/sales.json instead.

[NIT] app/report.py:44 — the writer's lineterminator could be a named constant.

## Dropped
DROP [NIT] app/report.py:38 — (c) style preference; the plan keeps the commands separate.
MD
"$bin/quorum-findings" cap 2 "$r1/votes.md" > "$r1/survivors.md"
state set round 1
state push round_shas "$(git rev-parse --short HEAD)"
state log <<'MD'

## Round 1
Summary: 1 IMPORTANT, 1 NIT, 0 PRE-EXISTING. Ignored argument: export read the default file. Sent to the builder.
MD
printf '\n# export honors DATA_FILE\n' >> app/report.py
commit "Honor DATA_FILE in export"

# ---------------------------------------------------------------- code review round 2
r2="$task/review/round-2"; mkdir -p "$r2"
echo 'Summary: 0 issues found. Ready to land.' > "$r2/logic.md"
cat > "$r2/architecture.md" <<'MD'
Summary: 0 IMPORTANT, 1 NIT, 0 PRE-EXISTING

[NIT] app/report.py:52 — the DATA_FILE default is repeated in two places.
MD
state set round 2
state push round_shas "$(git rev-parse --short HEAD)"

if [ "$stage" != review ]; then
  echo 'Summary: 0 issues found. Ready to land.' > "$r2/patterns.md"
  echo 'Summary: 0 issues found. Ready to land.' > "$r2/docs.md"
  cat "$r2/architecture.md" > "$r2/candidates.md"
  cat "$r2/architecture.md" > "$r2/votes.md"
  "$bin/quorum-findings" cap 2 "$r2/votes.md" > "$r2/survivors.md"
  state set status CONVERGED
  state log <<'MD'

## Round 2
Summary: 0 IMPORTANT, 1 NIT, 0 PRE-EXISTING. Converged.
MD

  # -------------------------------------------------------------- blind test run 1 (stage 5)
  mkdir -p "$task/blind"
  state set status BLIND-TEST
  state incr blind_runs >/dev/null
  cat > "$task/blind/blind-1.md" <<'MD'
Goal: Export the sales data to a CSV file and open it
Result: REACHED

Blockers: none

Friction:
- FRICTION: ran `report.py --help` — export is listed, but without an example of writing to a file
- FRICTION: ran `report.py export > out.csv` — no message says the export finished

Steps:
1. python3 app/report.py --help → export listed
2. python3 app/report.py export > out.csv → 13 lines, opens in a spreadsheet with 3 columns
MD
  cat > "$task/blind/triage-1.md" <<'MD'
Triage: csv-export, 2 friction items

CAUSED:

RELATED:
- "no example of writing to a file" — the help text predates this change; follow-up drafted

UNRELATED:
- "no message says the export finished" — printing to stdout is the CLI's convention

Follow-up drafts:
### Add usage examples to report.py --help
The help lists commands without examples, so a first-time user guesses how to save a file.
MD
  state log <<'MD'

## Blind run 1
Reached the goal. 0 blockers, 2 friction (0 caused by this change). Security pass: skipped (MEDIUM).
MD
fi

if [ "$stage" = "done" ]; then
  # -------------------------------------------------------------- the summary and the PR (stages 7 and 8)
  cat > "$task/proof-final.md" <<MD
Proof: $slug at $(git rev-parse --short HEAD)
Result: ALL PASS

| # | Check | Result | Evidence |
|---|---|---|---|
| fast | bash .claude/hooks/verify-completion.sh | PASS | "All checks passed." |
| 1 | python3 app/report.py export data/sales.json | PASS | header and 12 rows |
| 1b | python3 app/report.py export tests/data/two.json | PASS | header and 2 rows |
| 2 | python3 -m pytest tests -k export_quotes | PASS | 1 passed |
| 3 | python3 app/report.py export tests/data/empty.json | PASS | header only |
| 4 | grep -n 'export' README.md | PASS | README.md:14 |

## Requirements
| Req | Verdict | Evidence |
|---|---|---|
| 1 | MET | rows 1, 1b pass; \`app/report.py:41\` export_csv() is called from main() at \`app/report.py:58\` |
| 2 | MET | row 2 passes; \`app/report.py:44\` writes through csv.writer, which quotes commas and quotes |
| 3 | MET | row 3 passes; \`app/report.py:43\` writes the header before the loop |
| 4 | MET | row 4: \`README.md:14\` lists \`export\` with its DATA_FILE argument |

Unrequested: none.

Working tree unchanged: yes
MD
  state set status AWAITING-HUMAN
  "$bin/quorum-active-task" --clear
  cat > "$task/pr.md" <<'MD'
Add a CSV export command (SALES-12)
---
## Summary
`report.py export [DATA_FILE]` prints the sales rows as RFC 4180 CSV.
MD
  sed -n '3,$p' "$task/pr.md" > "$task/pr-body.md"
  state set pr https://github.com/acme/sales-report/pull/42
  state log <<'MD'

## Stage 7
proof-final.md: ALL PASS. Waiting for your review.
MD
fi

# ---------------------------------------------------------------- another task, in its own worktree
other=summary-dollars
mkdir -p ".tasks/$other"
"$bin/quorum-state" --task "$other" init LOW BUILDING
# shellcheck disable=SC2016  # the backticks are literal Markdown
printf '# Show summary totals as dollars\n\n## Requirements\n1. `report.py summary` prints each total as dollars.\n' > ".tasks/$other/rd.md"
"$bin/quorum-state" --task "$other" set plan_approved 2026-11-09
"$bin/quorum-branch" start "$other" --worktree >/dev/null

echo "Demo repo ready at $dest (stage: $stage, status: $(state get status))."
echo "Open it with the dashboard:  cd $dest && claude --plugin-dir $repo"
