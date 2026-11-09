#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --bug
# No task: the intent a standalone review has is the commit message.
git commit -q --amend -m "Add an export command" -m "report.py export [DATA_FILE] prints the rows of DATA_FILE (default data/sales.json) as CSV."
