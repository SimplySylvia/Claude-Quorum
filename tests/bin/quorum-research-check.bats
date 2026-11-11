#!/usr/bin/env bats
load ../helpers

setup() {
  make_repo
  mkdir -p app .tasks/demo/research
  printf 'import json\n\n\ndef load(path):\n    with open(path, encoding="utf-8") as f:\n        return json.load(f)\n' > app/report.py
  git add -A && git -c user.name=t -c user.email=t@example.com commit -qm app
}
teardown() { cleanup_repo; }
check() { "$BIN/quorum-research-check" "$@"; }
result() { printf '%s\n' "$output" | awk -F '\t' -v id="$1" '$1 ~ "#" id "$" { print $2 }'; }

@test "repo claims: on their line is OK, a moved line is a warning, a missing quote drops the claim" {
  cat > .tasks/demo/research/1-repo.md <<'MD'
# Repo precedent

## Claims
1. [VERIFIED] load() reads the file as UTF-8.
   Source: app/report.py:5 @ abc1234
   Quote: with open(path, encoding="utf-8") as f:
2. [VERIFIED] load() is defined near the top.
   Source: app/report.py:2
   Quote: def load(path):
3. [VERIFIED] The app caches parsed files.
   Source: app/report.py:6
   Quote: functools.lru_cache
4. [VERIFIED] There's a CSV writer.
   Source: app/export.py:1
   Quote: import csv
5. [VERIFIED] It returns the parsed JSON.
   Source: app/report.py:6
MD
  run check .tasks/demo/research/1-repo.md
  [ "$status" -eq 0 ]
  [ "$(result 1)" = OK ]
  [ "$(result 2)" = MOVED ]; [[ "$output" == *"the quote is at app/report.py:4, not :2"* ]]
  [ "$(result 3)" = DROP ]; [[ "$output" == *"the quote isn't in app/report.py"* ]]
  [ "$(result 4)" = DROP ]; [[ "$output" == *"app/export.py doesn't exist"* ]]
  [ "$(result 5)" = DROP ]; [[ "$output" == *"no Quote: to check"* ]]
}

@test "cited claims: reopen the ones with numbers, a decision, or no quote; the rest pass; assumed ones go to the user" {
  cat > .tasks/demo/research/2-docs.md <<'MD'
## Claims
1. [CITED] csv.writer quotes a field that holds the delimiter.
   Source: https://docs.python.org/3.12/library/csv.html (fetched 2026-11-11; Python 3.12)
   Quote: "only quote those fields which contain special characters"
2. [CITED] The default line terminator is \r\n, 2 characters.
   Source: https://docs.python.org/3.12/library/csv.html (fetched 2026-11-11; Python 3.12)
   Quote: Dialect.lineterminator ... Defaults to '\r\n'.
3. [CITED] csv is the right module for this.
   Source: https://docs.python.org/3.12/library/csv.html (fetched 2026-11-11; Python 3.12)
   Quote: The csv module implements classes to read and write tabular data in CSV format.
   Decision: yes
4. [CITED] Excel reads RFC 4180 files.
   Source: https://example.com/excel (fetched 2026-11-11)
5. [ASSUMED] Finance opens the file in Excel.
6. [CITED] No date on this one.
   Source: https://example.com/page
   Quote: something
MD
  run check .tasks/demo/research/2-docs.md
  [ "$status" -eq 1 ]
  [ "$(result 1)" = OK ]
  [ "$(result 2)" = VERIFY ]; [[ "$output" == *"it has numbers"* ]]
  [ "$(result 3)" = VERIFY ]; [[ "$output" == *"a decision rests on it"* ]]
  [ "$(result 4)" = VERIFY ]; [[ "$output" == *"no quote from https://example.com/excel"* ]]
  [ "$(result 5)" = ASK ]
  [ "$(result 6)" = ERROR ]
}

@test "claims are checked in the worktree the code is in" {
  printf '# P\n' > CLAUDE.md && printf '# R\n' > REVIEW.md && mkdir -p .claude/hooks && echo 'exit 0' > .claude/hooks/verify-completion.sh
  echo ".tasks/" > .gitignore && git add -A && git -c user.name=t -c user.email=t@example.com commit -qm boot
  "$BIN/quorum-state" --task demo init MEDIUM BUILDING
  wt=$("$BIN/quorum-branch" start demo --worktree | sed -n 2p)
  (cd "$wt" && printf '\ndef export(rows):\n    pass\n' >> app/report.py)
  printf '## Claims\n1. [VERIFIED] export() exists.\n   Source: app/report.py:8\n   Quote: def export(rows):\n' > "$wt/.tasks/demo/research/1-repo.md"
  cd "$wt"
  run check .tasks/demo/research/1-repo.md
  [ "$(result 1)" = OK ]
}

@test "repo claims may quote in backticks, cite a range, join pieces with a slash, and add a note after the sha" {
  cat > .tasks/demo/research/1-repo.md <<'MD'
## Claims
1. [VERIFIED] load() opens the file and parses it.
   Source: app/report.py:4-6 @ 3228f75
   Quote: `with open(path, encoding="utf-8") as f:` / `return json.load(f)`
2. [VERIFIED] load is the entry point.
   Source: app/report.py:4 @ 3228f75 (called from main at app/report.py:20)
   Quote: "def load(path):"
3. [VERIFIED] It parses with pickle.
   Source: app/report.py:4-6
   Quote: `with open(path, encoding="utf-8") as f:` / `pickle.load(f)`
4. [VERIFIED] Parsing is on line 1.
   Source: app/report.py:1-2
   Quote: `return json.load(f)`
MD
  run check .tasks/demo/research/1-repo.md
  [ "$status" -eq 0 ]
  [ "$(result 1)" = OK ]
  [ "$(result 2)" = OK ]
  [ "$(result 3)" = DROP ]
  [ "$(result 4)" = MOVED ]; [[ "$output" == *"the quote is at app/report.py:6, not :1-2"* ]]
}
