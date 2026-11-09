#!/usr/bin/env bash
# Run Quorum's eval suite with one fixed set of options.
#   evals/run.sh [eval options]   for example `evals/run.sh --case prover-catches-hollow-test`
# Every run makes real model calls on your Claude account.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

cd "$root"
exec claude plugin eval . \
  --scaffold --trust-plugin --ablation none \
  --model claude-sonnet-5-5 --judge-model claude-sonnet-5-5 \
  --max-cost-usd 15 -j 4 --no-publish \
  --allow-tools Bash Write Edit WebSearch WebFetch \
  "$@"
