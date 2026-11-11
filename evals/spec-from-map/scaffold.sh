#!/usr/bin/env bash
# A cleared map, weekly, whose task 1 rests on two decisions and leaves one item out of scope.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
bash "$here/../_fixture/make.sh"
bin="$here/../../bin"
export CLAUDE_PROJECT_DIR="$PWD"
qm() { "$bin/quorum-map" --map weekly "$@"; }
qm init "Weekly regional reporting" >/dev/null
python3 - <<'PY'
p = ".tasks/map-weekly/map.md"; s = open(p).read()
s = s.replace("## Notes", "Each regional manager runs the report for their own region every week.\n\n## Notes", 1)
open(p, "w").write(s)
PY
qm new grilling "How a manager picks a region" "How does a manager say which region they want?" >/dev/null
qm claim 1
qm resolve 1 user "a --region flag, matched case-insensitively" "A --region NAME flag on summary. Match the region name case-insensitively; an unknown region prints 'unknown region: NAME' on stderr and exits 1. No config file."
qm new grilling "Alerts" "Should the report send alerts itself?" >/dev/null
qm claim 2
qm rule-out 2 "alerts are a later effort: this map covers what managers run themselves"
cat > .tasks/map-weekly/tasks.md <<'MD'
# Tasks: Weekly regional reporting

1. Add a --region flag to the summary command so a manager sees only their region · tier: MEDIUM · blocked by: none · decisions: 01
MD
qm check
