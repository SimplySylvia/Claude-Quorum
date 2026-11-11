#!/usr/bin/env bash
# A cleared map, weekly: every ticket resolved or out of scope, nothing left unspecified, no tasks.md yet.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
bash "$here/../_fixture/make.sh"
export CLAUDE_PROJECT_DIR="$PWD"
qm() { "$here/../../bin/quorum-map" --map weekly "$@"; }
qm init "Weekly regional reporting" >/dev/null
python3 - <<'PY'
p = ".tasks/map-weekly/map.md"; s = open(p).read()
s = s.replace("## Notes", "Each regional manager runs the summary for their own region every week, and sees how it compares with the week before.\n\n## Notes", 1)
open(p, "w").write(s)
PY
qm new grilling "Choosing a region" "How does a manager say which region they want?" >/dev/null
qm claim 1
qm resolve 1 user "a --region flag, case-insensitive" "A --region NAME flag on summary, matched case-insensitively; an unknown region is an error on stderr with exit 1."
qm new grilling "Comparing weeks" "Where does last week's total come from?" >/dev/null
qm claim 2
qm resolve 2 user "a --previous DATA_FILE flag" "summary takes --previous OTHER_FILE, a second sales file in the same format, and prints each region's change next to its total."
qm new grilling "Alerts" "Should the report send alerts?" >/dev/null
qm claim 3
qm rule-out 3 "alerts are a later effort"
qm check
