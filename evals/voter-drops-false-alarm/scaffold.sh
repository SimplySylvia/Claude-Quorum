#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export MEDIUM IN_REVIEW --bug
line=$(grep -n 'load(DEFAULT_DATA)' app/report.py | cut -d: -f1)
mkdir -p .tasks/csv-export/review/round-1
cat > .tasks/csv-export/review/round-1/candidates.md <<MD
Summary: 2 IMPORTANT, 0 NIT, 0 PRE-EXISTING

[IMPORTANT] app/report.py:$line — Pattern Category: Ignored CLI argument
Mechanism: export always reads DEFAULT_DATA, so \`report.py export other.json\` prints data/sales.json instead.

[IMPORTANT] app/report.py:$line — Pattern Category: Unescaped CSV fields
Mechanism: customer names containing commas are written without quotes, so "Acme, Inc." becomes two columns.
MD
