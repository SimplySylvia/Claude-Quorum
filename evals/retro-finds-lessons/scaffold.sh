#!/usr/bin/env bash
# A converged task, csv-export, whose review kept "Unescaped CSV fields" in rounds 1 and 2, in a repo whose Makefile
# has a fmt-check target that verify-completion.sh doesn't run.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
bash "$here/../_fixture/make.sh" --task csv-export MEDIUM CONVERGED
bin="$here/../../bin"
export CLAUDE_PROJECT_DIR="$PWD"
printf 'fmt-check:\n\tpython3 -m tabnanny app tests\n' >> Makefile
git commit -qam "Add fmt-check"
"$bin/quorum-state" --task csv-export set round 2
for n in 1 2; do
  mkdir -p ".tasks/csv-export/review/round-$n"
  line=$((40 + n))
  cat > ".tasks/csv-export/review/round-$n/survivors.md" <<MD
Summary: 1 IMPORTANT, 0 NIT, 0 PRE-EXISTING

[IMPORTANT] app/report.py:$line — Pattern Category: Unescaped CSV fields
Confidence: 95
Mechanism: a customer named "Acme, Inc." is joined with commas by hand, so the row gets an extra column.
MD
done
"$bin/quorum-state" --task csv-export log '## Review round 1\n1 IMPORTANT kept: Unescaped CSV fields'
"$bin/quorum-state" --task csv-export log '## Review round 2\n1 IMPORTANT kept: Unescaped CSV fields (again, in the summary export)'
