#!/usr/bin/env bats
load ../helpers

setup() {
  make_repo
  "$BIN/quorum-map" --map billing init "Usage billing" >/dev/null
}
teardown() { cleanup_repo; }
qm() { "$BIN/quorum-map" --map billing "$@"; }
destination() {
  python3 - "$1" <<'PY'
import sys
p = ".tasks/map-billing/map.md"; s = open(p).read()
s = s.replace("## Notes", sys.argv[1] + "\n\n## Notes", 1); open(p, "w").write(s)
PY
}

@test "init writes map.md from the template, once" {
  [ -f .tasks/map-billing/map.md ]
  grep -qx '# Map: Usage billing' .tasks/map-billing/map.md
  for h in Destination Notes "Decisions so far" "Not yet specified" "Out of scope"; do grep -qx "## $h" .tasks/map-billing/map.md; done
  run "$BIN/quorum-map" --map billing init; [ "$status" -eq 2 ]
  run "$BIN/quorum-map" --map Bad_Slug init; [ "$status" -eq 2 ]
}

@test "new numbers tickets in order, and only the four types are allowed" {
  [ "$(qm new grilling "Who pays?" "Which account is billed?")" = 01 ]
  [ "$(qm new research "Metering options" "What can count API calls?\nWith what delay?")" = 02 ]
  run qm new build "Build it" "no"; [ "$status" -eq 2 ]
  [ -f .tasks/map-billing/tickets/01-who-pays.md ]
  grep -qx 'Type: research' .tasks/map-billing/tickets/02-metering-options.md
  grep -qx 'With what delay?' .tasks/map-billing/tickets/02-metering-options.md
  [ "$(qm tickets | cut -f1-4 | tr '\t\n' ' |')" = "01 grilling open -|02 research open -|" ]
}

@test "the frontier is the open tickets whose blockers are all closed, and block refuses cycles" {
  qm new grilling A "a?" >/dev/null; qm new grilling B "b?" >/dev/null; qm new research C "c?" >/dev/null
  qm block 2 1
  qm block 3 2 1
  grep -qx 'Blocked by: 01, 02' .tasks/map-billing/tickets/03-c.md
  [ "$(qm frontier)" = 01 ]
  run qm block 1 3; [ "$status" -eq 2 ]; [[ "$output" == *cycle* ]]
  run qm block 2 2; [ "$status" -eq 2 ]
  run qm block 2 9; [ "$status" -eq 2 ]
  [ "$(qm downstream 1 | tr '\n' ' ')" = "02 03 " ]
}

@test "a claim comes first, only the user answers a grilling ticket, and the answer lands in the map" {
  qm new grilling "Who pays" "Which account is billed?" >/dev/null
  qm new research "Metering" "What counts calls?" >/dev/null
  qm block 2 1
  run qm resolve 1 user "the team" "The team's owner."; [ "$status" -eq 2 ]; [[ "$output" == *"claim it"* ]]
  run qm claim 2; [ "$status" -eq 2 ]
  qm claim 1
  [ -z "$(qm frontier)" ]
  run qm resolve 1 agent "the team" "x"; [ "$status" -eq 2 ]; [[ "$output" == *"only the user"* ]]
  qm resolve 1 user "the team's owner is billed" "The team's owner, monthly."
  grep -qx 'Status: resolved' .tasks/map-billing/tickets/01-who-pays.md
  grep -qx 'Answered by: user' .tasks/map-billing/tickets/01-who-pays.md
  grep -qx "The team's owner, monthly." .tasks/map-billing/tickets/01-who-pays.md
  grep -qF -- "- [Who pays](tickets/01-who-pays.md): the team's owner is billed" .tasks/map-billing/map.md
  [ "$(qm frontier)" = 02 ]
  qm claim 2; qm release 2; [ "$(qm frontier)" = 02 ]
  run qm cleared; [ "$status" -eq 1 ]
  qm claim 2; printf 'A gateway log.\n' | qm resolve 2 agent "count at the gateway"
  qm cleared
}

@test "rule-out lists a ticket under Out of scope and unblocks what waited on it; reopen undoes a decision" {
  qm new grilling A "a?" >/dev/null; qm new grilling B "b?" >/dev/null; qm new grilling C "c?" >/dev/null
  qm block 2 1; qm block 3 2
  qm rule-out 1 "refunds are a later effort"
  grep -qF -- "- [A](tickets/01-a.md): refunds are a later effort" .tasks/map-billing/map.md
  [ "$(qm frontier)" = 02 ]
  qm claim 2; qm resolve 2 user "yes" "Yes."
  qm claim 3; qm resolve 3 user "no" "No."
  run qm reopen 2 "the owner changed their mind"
  [ "$status" -eq 0 ]; [ "$output" = "$(printf '03\tC')" ]
  grep -qx 'Status: open' .tasks/map-billing/tickets/02-b.md
  grep -q '^## Earlier answer (reopened .*: the owner changed their mind)$' .tasks/map-billing/tickets/02-b.md
  ! grep -qF '(tickets/02-b.md)' .tasks/map-billing/map.md
}

@test "check reports an empty destination, a broken ticket, and a decision missing from the map" {
  qm new grilling A "a?" >/dev/null
  run qm check; [ "$status" -eq 1 ]; [[ "$output" == *"Destination is empty"* ]]
  destination "Teams are billed monthly for API calls."
  qm check
  printf '# Z\n\nType: build\nBlocked by: 07\nStatus: open\n\n## Question\n\n' > .tasks/map-billing/tickets/02-z.md
  sed -i.bak 's/^Status: open$/Status: resolved/' .tasks/map-billing/tickets/01-a.md && rm .tasks/map-billing/tickets/01-a.md.bak
  run qm check; [ "$status" -eq 1 ]
  [[ "$output" == *'02-z.md: Type "build"'* ]]
  [[ "$output" == *"02-z.md: waits on ticket 07, which doesn't exist"* ]]
  [[ "$output" == *"02-z.md: no question"* ]]
  [[ "$output" == *'01-a.md: resolved, with no "## Answer"'* ]]
  [[ "$output" == *"01-a.md: resolved, but not in map.md's Decisions so far"* ]]
  [[ "$output" == *'01-a.md: a grilling ticket resolved with "Answered by: nobody"'* ]]
}

@test "tasks.md: decisions prints what a task cites, and tasks wait for their blockers to merge" {
  destination "Teams are billed monthly for API calls."
  qm new grilling "Who pays" "Who?" >/dev/null; qm claim 1; qm resolve 1 user "the owner" "The owner."
  qm new research "Metering" "How?" >/dev/null; qm claim 2; qm resolve 2 agent "the gateway" "At the gateway."
  qm rule-out "$(qm new grilling Refunds "r?")" "a later effort"
  cat > .tasks/map-billing/tasks.md <<'MD'
# Tasks: Usage billing

1. Count API calls per team at the gateway · tier: MEDIUM · blocked by: none · decisions: 02
2. Bill each team's owner monthly · tier: HIGH · blocked by: 1 · decisions: 01, 02
MD
  qm check
  run qm decisions 1
  [[ "$output" == *"task 1: Count API calls per team at the gateway"* ]]
  [[ "$output" == *"Teams are billed monthly for API calls."* ]]
  [[ "$output" == *"a later effort"* ]]
  [[ "$output" == *"### 02: Metering"* ]]; [[ "$output" == *"Answer (agent):"* ]]
  [[ "$output" != *"### 01: Who pays"* ]]
  [ "$(qm tasks | cut -f1-4 | tr '\t\n' ' |')" = "1 ready - -|2 blocked - 1|" ]
  [ "$(qm next-task)" = 1 ]

  # Task 1 starts, builds on its branch, and merges.
  "$BIN/quorum-state" --task meter init MEDIUM BUILDING
  "$BIN/quorum-state" --task meter set map billing
  "$BIN/quorum-state" --task meter set map_task 1
  "$BIN/quorum-state" --task meter set base_sha "$(git rev-parse HEAD)"
  [ "$(qm tasks | cut -f1-3 | head -n 1 | tr '\t' ' ')" = "1 BUILDING meter" ]
  run qm next-task; [ "$status" -eq 1 ]
  git checkout -q -b feat/meter
  git -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m meter
  git checkout -q main && git merge -q --ff-only feat/meter
  "$BIN/quorum-branch" is-merged meter
  [ "$(qm tasks | cut -f1-3 | tr '\t\n' ' |')" = "1 merged meter|2 ready -|" ]
  [ "$(qm next-task)" = 2 ]

  printf '3. Nothing · tier: SOME · blocked by: 4 · decisions: 09\n' >> .tasks/map-billing/tasks.md
  run qm check; [ "$status" -eq 1 ]
  [[ "$output" == *'task 3 has no "tier: LOW|MEDIUM|HIGH"'* ]]
  [[ "$output" == *"task 3 waits on task 4, which doesn't exist"* ]]
  [[ "$output" == *"cites decision 09"* ]]
}

@test "list counts each map's tickets, and enter needs a real map" {
  qm new grilling A "a?" >/dev/null; qm new grilling B "b?" >/dev/null; qm block 2 1
  [ "$("$BIN/quorum-map" list)" = "$(printf 'billing\t2\t0\t1')" ]
  run "$BIN/quorum-map" enter s1 nope; [ "$status" -eq 2 ]
  "$BIN/quorum-map" enter s1 billing
  [ "$(cat .tasks/.map-sessions/s1)" = billing ]
  "$BIN/quorum-map" leave s1; [ ! -e .tasks/.map-sessions/s1 ]
}

@test "new refuses a 100th ticket" {
  printf '# Last\n\nType: grilling\nBlocked by: none\nStatus: open\n\n## Question\n\nq?\n' > .tasks/map-billing/tickets/99-last.md
  run qm new grilling "One more" "q?"; [ "$status" -eq 2 ]
  [[ "$output" == *"99 tickets"* ]]
  [ "$(ls .tasks/map-billing/tickets | wc -l | tr -d ' ')" = 1 ]
}
