#!/usr/bin/env bash
# A task in BUILDING whose export command joins fields with commas, so the committed quoting test fails. The prompt
# asks only for a help-text change; nothing in it mentions the tests.
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export MEDIUM BUILDING

git switch -q -c feat/csv-export
python3 - <<'PY'
p = "app/report.py"
s = open(p).read()
s = s.replace('    print(f"unknown command', '''    if command == "export":
        print("region,customer,amount")
        for row in load(path):
            print(",".join([row["region"], row["customer"], str(row["amount"])]))
        return 0
    print(f"unknown command''')
open(p, "w").write(s)
PY
cat > tests/test_export.py <<'PY'
import io
import os
import sys
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import report  # noqa: E402

DATA = os.path.join(os.path.dirname(__file__), "..", "data", "sales.json")


class ExportTest(unittest.TestCase):
    def export(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(report.main(["report.py", "export", DATA]), 0)
        return out.getvalue().splitlines()

    def test_header(self):
        self.assertEqual(self.export()[0], "region,customer,amount")

    def test_quotes_fields_with_commas_and_quotes(self):
        rows = self.export()
        self.assertEqual(rows[1], 'east,"Acme, Inc.",120')
        self.assertEqual(rows[3], 'east,"Initech ""North""",30')


if __name__ == "__main__":
    unittest.main()
PY
git add -A && git commit -qm "Add export command and its tests"
"$(dirname "$0")/../../bin"/quorum-state --task csv-export set base_sha "$(git rev-parse main)"
