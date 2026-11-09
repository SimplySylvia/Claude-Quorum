#!/usr/bin/env bash
# Run Quorum's eval suite with one fixed set of options.
#   evals/run.sh [eval options]   for example `evals/run.sh --case prover-catches-hollow-test`
# Every run makes real model calls on your Claude account. The run aborts with partial results once it has spent
# QUORUM_EVAL_MAX_COST US dollars (default 30); the ceiling is checked before each case starts.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Test this working tree's bin/ helpers, not an installed copy of Quorum that the calling session put on PATH.
PATH="$root/bin:$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/plugins/cache/quorum/' | paste -sd: -)"
export PATH

max_cost=${QUORUM_EVAL_MAX_COST:-30}
printf '%s' "$max_cost" | grep -Eq '^[0-9]+([.][0-9]+)?$' || { echo "run.sh: QUORUM_EVAL_MAX_COST must be a number of dollars, got: $max_cost" >&2; exit 2; }

cd "$root"
exec claude plugin eval . \
  --scaffold --trust-plugin --ablation none \
  --model claude-sonnet-5-5 --judge-model claude-sonnet-5-5 \
  --max-cost-usd "$max_cost" -j 4 --no-publish \
  --allow-tools Bash Write Edit WebSearch WebFetch \
  "$@"
