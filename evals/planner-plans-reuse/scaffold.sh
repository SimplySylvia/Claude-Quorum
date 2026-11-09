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
cp "$(dirname "$0")/../../skills/plan/templates/plan.md" .tasks/csv-export/plan-template.md
