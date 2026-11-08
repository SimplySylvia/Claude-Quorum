#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export MEDIUM CONVERGED --bug

mkdir -p .tasks/csv-export/blind
cat > .tasks/csv-export/blind/blind-1.md <<'MD'
Goal: export my sales file as CSV.
Result: REACHED

Blockers: none

Friction:
- FRICTION: Ran `report.py export mine.json` with my own file — it printed the same three rows as the sample data, not my rows.
- FRICTION: The sample data has only three rows, so I couldn't see how a long export looks.
- FRICTION: The README doesn't say which Python version to use.

Steps:
1. `python3 app/report.py --help` → usage line
2. `python3 app/report.py export` → header and 3 rows
3. `python3 app/report.py export mine.json` → the same 3 rows
MD
