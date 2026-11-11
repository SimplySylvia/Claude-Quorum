#!/usr/bin/env bash
# A map, weekly, whose only frontier ticket is a grilling question about the code: how a region is matched.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
bash "$here/../_fixture/make.sh"
export CLAUDE_PROJECT_DIR="$PWD"
qm() { "$here/../../bin/quorum-map" --map weekly "$@"; }
qm init "Weekly regional reporting" >/dev/null
python3 - <<'PY'
p = ".tasks/map-weekly/map.md"; s = open(p).read()
s = s.replace("## Notes", "Each regional manager runs the summary for their own region every week.\n\n## Notes", 1)
open(p, "w").write(s)
PY
qm new grilling "Matching a region name" "When a manager asks for a region, how should the name be matched against the region values in the sales data: exactly as stored, or case-insensitively?" >/dev/null
qm check
