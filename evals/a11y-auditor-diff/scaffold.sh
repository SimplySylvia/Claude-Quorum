#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task html-report MEDIUM IN_REVIEW

cat > .tasks/html-report/rd.md <<'MD'
# HTML sales report

- **UI change:** yes

## Requirements
1. `web/report.html` shows the sales chart, a region filter, and an Export button.
MD
git switch -q -c feat/html-report
mkdir -p web
cat > web/report.html <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sales report</title></head>
<body>
  <h1>Sales report</h1>
  <img src="chart.png">
  <input id="region" placeholder="Region">
  <div class="btn" onclick="exportCsv()">Export</div>
  <script>function exportCsv() { location.href = "/export.csv"; }</script>
</body>
</html>
HTML
git add -A
git commit -qm "Add HTML report page"
"$(dirname "$0")/../../bin"/quorum-state --task html-report set base_sha "$(git merge-base HEAD main)"
