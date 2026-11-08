#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export MEDIUM IN_REVIEW

python3 - <<'PY'
p = "app/report.py"
s = open(p).read()
s = s.replace('def summary(rows):', '# Formats an amount as dollars: 1234 -> "$1,234".\ndef money(amount):\n    return f"${amount:,}"\n\n\ndef summary(rows):')
s = s.replace('print(f"{region}: {total}")', 'print(f"{region}: {money(total)}")')
s = s.replace('def main(argv):', 'def main(argv):', 1)
open(p, "w").write(s)
PY
git commit -qam "Show summary totals as dollars"
git switch -q -c feat/csv-export
python3 - <<'PY'
p = "app/report.py"
s = open(p).read()
s = s.replace('def main(argv):', 'def format_dollars(value):\n    return "$" + "{:,}".format(value)\n\n\ndef main(argv):')
open(p, "w").write(s)
PY
python3 - <<'PY'
p = "app/report.py"
s = open(p).read()
s = s.replace('import json\n', 'import csv\nimport json\n')
s = s.replace('    print(f"unknown command', '''    if command == "export":
        writer = csv.writer(sys.stdout, lineterminator="\\r\\n")
        writer.writerow(["region", "customer", "amount"])
        for row in load(path):
            writer.writerow([row["region"], row["customer"], format_dollars(row["amount"])])
        return 0
    print(f"unknown command''')
open(p, "w").write(s)
PY
git commit -qam "Add export command"
"$(dirname "$0")/../../bin"/quorum-state --task csv-export set base_sha "$(git merge-base HEAD main)"
