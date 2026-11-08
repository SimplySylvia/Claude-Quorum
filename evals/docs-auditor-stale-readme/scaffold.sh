#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task rename-totals MEDIUM IN_REVIEW

cat > .tasks/rename-totals/rd.md <<'MD'
# Rename the summary command to totals

## Requirements
1. The `summary` command is renamed `totals`; its output doesn't change.
MD
git switch -q -c feat/rename-totals
sed -i.bak 's/summary \[DATA_FILE\]/totals [DATA_FILE]/; s/if command == "summary":/if command == "totals":/' app/report.py
rm -f app/report.py.bak
git commit -qam "Rename summary command to totals"
"$(dirname "$0")/../../bin"/quorum-state --task rename-totals set base_sha "$(git merge-base HEAD main)"
