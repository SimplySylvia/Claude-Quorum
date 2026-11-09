#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export MEDIUM PLANNING --money
cat > .tasks/csv-export/rd.md <<'MD'
# Add a CSV export command

- **Slug:** `csv-export`
- **Risk tier:** MEDIUM. A new command users can run.
- **UI change:** no

## Goal
Users can export the sales rows as CSV, with amounts shown as dollars like the summary shows them.

## Requirements
1. `report.py export [DATA_FILE]` prints the rows of DATA_FILE (default `data/sales.json`) as RFC 4180 CSV with a
   `region,customer,amount` header.
2. The amount column uses the same dollar format as `report.py summary` (for example `$1,234`).
3. **Docs:** add `export [DATA_FILE]` to the usage line in `README.md`.

## Non-goals
- Other output formats.

## Rollback plan (one step)
Revert the merge commit.
MD
cat > .tasks/csv-export/eval.md <<'MD'
# Eval: Add a CSV export command

## Task checks
| # | Requirement | Command | Passes when |
|---|---|---|---|
| 1 | CSV output | `python3 app/report.py export data/sales.json \| python3 -c 'import csv,sys; print(len(list(csv.reader(sys.stdin))))'` | Prints `4` |
| 2 | Dollar amounts | `python3 app/report.py export \| grep -c '\$120'` | Prints `1` |
| 3 | Docs | `grep -c 'export' README.md` | At least `1` |
MD
cat > .tasks/csv-export/plan.md <<'MD'
# Plan: Add a CSV export command

- **Slug:** `csv-export`
- **Risk tier:** MEDIUM
- **Approach:** stdlib `csv.writer` to stdout, in a new `export` branch of `main()`.

## Steps
1. **Add the export command** — `app/report.py` · requirements: 1
   - Reuses: `load()` at `app/report.py:9`
2. **Format amounts as dollars** — `app/report.py` · requirements: 2
   - Reuses: new: `format_dollars(value)`, since nothing formats money yet
3. **Document the command** — `README.md` · requirements: 3

## Tests
| Requirement | Test (file and name) | What it asserts | Why it fails without the change |
|---|---|---|---|
| 1 | `tests/test_export.py::test_rows` | header plus 3 rows from a temp file | there's no export command |
| 2 | `tests/test_export.py::test_dollars` | the amount cell is `$120` | amounts print as plain numbers |

## Docs
- `README.md` (usage line): add `export [DATA_FILE]`.

## Accessibility
Not applicable (no UI change).

## Security
Not applicable.

## Requirement coverage
| Requirement | Steps | Tests or eval.md rows |
|---|---|---|
| 1 | 1 | test_rows, eval 1 |
| 2 | 2 | test_dollars, eval 2 |
| 3 | 3 | eval 3 |

## Risks and open questions
- None.

## Deviations
MD
