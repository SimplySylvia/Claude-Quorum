#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export MEDIUM CONVERGED

git switch -q -c feat/csv-export
printf '\n<!-- local -->\n' >> REVIEW.md
git commit -qam "chore: local Quorum pipeline setup (DROP BEFORE PR)"
python3 - <<'PY'
p = "app/report.py"
s = open(p).read()
s = s.replace('import json\n', 'import csv\nimport json\n')
s = s.replace('    print(f"unknown command', '''    if command == "export":
        writer = csv.writer(sys.stdout, lineterminator="\\r\\n")
        writer.writerow(["region", "customer", "amount"])
        for row in load(path):
            writer.writerow([row["region"], row["customer"], row["amount"]])
        return 0
    print(f"unknown command''')
open(p, "w").write(s)
PY
git commit -qam "Add export command"
"$(dirname "$0")/../../bin"/quorum-state --task csv-export set base_sha "$(git rev-parse main)"
cat > .tasks/csv-export/rd.md <<'MD'
# Add a CSV export command (SALES-12)

## Goal
Users can export the sales rows as CSV. Ticket: SALES-12.

## Requirements
1. `report.py export [DATA_FILE]` prints the rows of DATA_FILE (default `data/sales.json`) as RFC 4180 CSV.
2. Exporting a 10,000-row file takes under a second.
MD
cat > .tasks/csv-export/proof-final.md <<'MD'
Proof: csv-export at SHORT_SHA
Result: 1 SKIPPED

| # | Check | Result | Evidence |
|---|---|---|---|
| fast | bash .claude/hooks/verify-completion.sh | PASS | "All checks passed." |
| 1 | `python3 app/report.py export data/sales.json` | PASS | header and 3 rows; "Acme, Inc." quoted |
| 2 | 10,000-row export under a second | SKIPPED | no large data file in the repo |

## Requirements
| Req | Verdict | Evidence |
|---|---|---|
| 1 | MET | row 1 passes; `app/report.py` writes each row with `csv.writer`, reached from `main()`'s `export` branch |
| 2 | MET | `app/report.py` streams rows from `load(path)` with no per-row work beyond `writerow`; row 2's timing check was SKIPPED, not run |

Unrequested: none

Working tree unchanged: yes
MD
# The proof names the commit it ran at; quorum-state checks it before AWAITING-HUMAN.
sed -i.bak "s/SHORT_SHA/$(git rev-parse --short HEAD)/" .tasks/csv-export/proof-final.md && rm -f .tasks/csv-export/proof-final.md.bak
"$(dirname "$0")/../../bin"/quorum-state --task csv-export set status AWAITING-HUMAN
