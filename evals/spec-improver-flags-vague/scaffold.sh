#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export MEDIUM BUILDING

cat > .tasks/csv-export/rd.md <<'MD'
# Add a CSV export command

- **Slug:** `csv-export`
- **Risk tier:** MEDIUM. A new command users can run.
- **UI change:** no

## Goal
Users can export the sales rows as CSV.

## Requirements
1. `report.py export [DATA_FILE]` prints the rows of DATA_FILE (default `data/sales.json`) as RFC 4180 CSV.
2. Export handles bad input properly and is fast.

## Non-goals
- Other output formats.

## Rollback plan (one step)
Revert the merge commit.

## User goal for the blind test
Export the sample data as CSV. Start here: `python3 app/report.py --help`.
MD
cat > .tasks/csv-export/eval.md <<'MD'
# Eval: Add a CSV export command

## Task checks
| # | Requirement | Command | Passes when |
|---|---|---|---|
| 1 | CSV output | `python3 app/report.py export data/sales.json` | A header and 3 rows |
| 2 | Bad input | | Works well |
MD
