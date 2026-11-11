#!/usr/bin/env bash
# A research folder whose docs findings hold one true and one false claim about Python's csv module.
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh"
mkdir -p .tasks/research-csv/research
cat > .tasks/research-csv/research/2-docs.md <<'MD'
# 2-docs: How does Python's csv module write rows?
Stopped: covered

## Findings
csv.writer writes rows with a line terminator and quotes fields as its dialect says.

## Claims
1. [CITED] csv.writer's default dialect ends each row with '\r\n'.
   Source: https://docs.python.org/3.12/library/csv.html (fetched 2026-11-11; Python 3.12)
   Quote: Defaults to '\r\n'.
2. [CITED] csv.writer quotes every field by default (QUOTE_ALL), so 3 fields always get 6 quote marks.
   Source: https://docs.python.org/3.12/library/csv.html (fetched 2026-11-11; Python 3.12)
   Quote: The default is QUOTE_ALL.
MD
