#!/usr/bin/env bash
# Seed an eval workspace (the current directory) with the sales-app fixture, bootstrapped for Quorum.
#   make.sh [--task SLUG RISK STATUS]   also create a task folder with state.md and make it active
#   make.sh [--bug]                     also commit a runtime-only bug: export ignores DATA_FILE
# Runs from a case's scaffold script, outside the agent's sandbox, with a minimal environment.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
app="$repo/tests/e2e/sales-app"
bin="$repo/bin"

cp -R "$app/." .
git init -q -b main
git config user.name fixture && git config user.email fixture@example.com
git add -A && git commit -qm "Initial sales app"

export CLAUDE_PROJECT_DIR="$PWD"
mkdir -p .claude/hooks
"$bin/quorum-render-verify" --lint 'make lint' --test 'make test' > .claude/hooks/verify-completion.sh
chmod +x .claude/hooks/verify-completion.sh
"$bin/quorum-render-review" --profile python > REVIEW.md
cat > CLAUDE.md <<'MD'
# Sales report

Python CLI: `python3 app/report.py summary [DATA_FILE]`. Data lives in `data/sales.json`.

## Verification Commands
- **Build:** none
- **Typecheck:** none
- **Lint:** `make lint`
- **Test:** `make test`
- **Dev / start:** `python3 app/report.py --help`

## Code Review & Verification Standards
All code reviews, subagent audits, and `/quorum:review-loop` passes MUST strictly follow the domain failure modes, severity tags, and learned rules defined in @REVIEW.md.
MD
printf '.tasks/\n' >> .gitignore
git add -A && git commit -qm "Bootstrap Quorum"

while [ $# -gt 0 ]; do
  case "$1" in
    --task)
      slug=$2 risk=$3 status=$4; shift 4
      mkdir -p ".tasks/$slug"
      "$bin/quorum-state" --task "$slug" init "$risk" "$status"
      "$bin/quorum-active-task" --set "$slug"
      # shellcheck disable=SC2016  # the backticks are literal Markdown
      printf '# %s\n\n## Requirements\n1. `report.py export [DATA_FILE]` prints the rows of DATA_FILE (default data/sales.json) as RFC 4180 CSV.\n' "$slug" > ".tasks/$slug/rd.md"
      # shellcheck disable=SC2016  # the backticks are literal Markdown
      printf '# Eval\n\n| # | Command | Passes when |\n|---|---|---|\n| 1 | `python3 app/report.py export data/sales.json` | 3 data rows |\n' > ".tasks/$slug/eval.md" ;;
    --bug)
      shift
      git switch -q -c feat/csv-export
      python3 - <<'PY'
p = "app/report.py"
s = open(p).read()
s = s.replace('import json\n', 'import csv\nimport json\n')
s = s.replace('    print(f"unknown command', '''    if command == "export":
        writer = csv.writer(sys.stdout, lineterminator="\\r\\n")
        writer.writerow(["region", "customer", "amount"])
        for row in load(DEFAULT_DATA):
            writer.writerow([row["region"], row["customer"], row["amount"]])
        return 0
    print(f"unknown command''')
open(p, "w").write(s)
PY
      git commit -qam "Add export command"
      base=$(git merge-base HEAD main)
      [ -z "${slug:-}" ] || "$bin/quorum-state" --task "$slug" set base_sha "$base" ;;
    *) echo "make.sh: unknown argument $1" >&2; exit 1 ;;
  esac
done
