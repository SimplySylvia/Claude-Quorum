#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export MEDIUM IN_REVIEW --bug --hollow-fix

cat > .tasks/csv-export/eval.md <<'MD'
# Eval: export honors DATA_FILE

## Fast checks
`bash .claude/hooks/verify-completion.sh`

## Task checks
| # | Requirement | Command | Passes when |
|---|---|---|---|
| 1 | Tests pass | `make test` | `OK` |
| 2 | The new test fails without the fix | Put back the old code with `git checkout HEAD~1 -- app/report.py`, then run `make test` | `test_export_uses_data_file` fails on the old code |
MD
