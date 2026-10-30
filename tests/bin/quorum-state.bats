#!/usr/bin/env bats
load ../helpers

setup() { make_repo; mkdir -p .tasks/demo; "$BIN/quorum-active-task" --set demo; }
teardown() { cleanup_repo; }

@test "init writes every field with defaults" {
  run "$BIN/quorum-state" --task demo init MEDIUM
  [ "$status" -eq 0 ]
  run "$BIN/quorum-state" get status;      [ "$output" = "BUILDING" ]
  run "$BIN/quorum-state" get risk;        [ "$output" = "MEDIUM" ]
  run "$BIN/quorum-state" get round;       [ "$output" = "0" ]
  run "$BIN/quorum-state" get base_sha;    [ -z "$output" ]
  run "$BIN/quorum-state" get round_shas;  [ -z "$output" ]
}

@test "init refuses to overwrite and validates its arguments" {
  "$BIN/quorum-state" --task demo init LOW
  run "$BIN/quorum-state" --task demo init LOW
  [ "$status" -eq 1 ]
  run "$BIN/quorum-state" --task other init EXTREME
  [ "$status" -eq 1 ]
  run "$BIN/quorum-state" --task other init LOW NOT-A-STATUS
  [ "$status" -eq 1 ]
}

@test "init accepts a starting status" {
  "$BIN/quorum-state" --task demo init MEDIUM DRAFT-AWAITING-VISUAL-SIGNOFF
  run "$BIN/quorum-state" get status
  [ "$output" = "DRAFT-AWAITING-VISUAL-SIGNOFF" ]
}

@test "set validates status, risk, and counters" {
  "$BIN/quorum-state" --task demo init LOW
  run "$BIN/quorum-state" set status AWAITING-HUMAN; [ "$status" -eq 0 ]
  run "$BIN/quorum-state" set status DONE;           [ "$status" -eq 1 ]
  run "$BIN/quorum-state" set risk MEDIUM;           [ "$status" -eq 0 ]
  run "$BIN/quorum-state" set risk SEVERE;           [ "$status" -eq 1 ]
  run "$BIN/quorum-state" set round two;             [ "$status" -eq 1 ]
  run "$BIN/quorum-state" set nonsense 1;            [ "$status" -eq 1 ]
  run "$BIN/quorum-state" set round_shas abc;        [ "$status" -eq 1 ]
}

@test "incr adds one and prints the new value" {
  "$BIN/quorum-state" --task demo init LOW
  run "$BIN/quorum-state" incr stop_blocks; [ "$output" = "1" ]
  run "$BIN/quorum-state" incr stop_blocks; [ "$output" = "2" ]
  run "$BIN/quorum-state" incr status;      [ "$status" -eq 1 ]
}

@test "push, last, and clear on lists" {
  "$BIN/quorum-state" --task demo init LOW
  run "$BIN/quorum-state" last round_shas; [ "$status" -eq 1 ]
  "$BIN/quorum-state" push round_shas aaa111
  "$BIN/quorum-state" push round_shas bbb222
  run "$BIN/quorum-state" last round_shas; [ "$output" = "bbb222" ]
  run "$BIN/quorum-state" get round_shas;  [ "${lines[0]}" = "aaa111" ]; [ "${lines[1]}" = "bbb222" ]
  "$BIN/quorum-state" clear round_shas
  run "$BIN/quorum-state" get round_shas;  [ -z "$output" ]
  grep -q '^round_shas: \[\]$' .tasks/demo/state.md
}

@test "list items with quotes, commas, and brackets round-trip" {
  "$BIN/quorum-state" --task demo init LOW
  item='[IMPORTANT] src/a.ts:42 — Pattern Category: Unescaped "CSV", fields'
  "$BIN/quorum-state" push pending_findings "$item"
  run "$BIN/quorum-state" get pending_findings
  [ "$output" = "$item" ]
}

@test "clear sets scalars to null but refuses slug and risk" {
  "$BIN/quorum-state" --task demo init LOW
  "$BIN/quorum-state" set escalated_from IN_REVIEW
  "$BIN/quorum-state" clear escalated_from
  run "$BIN/quorum-state" get escalated_from; [ -z "$output" ]
  grep -q '^escalated_from: null$' .tasks/demo/state.md
  run "$BIN/quorum-state" clear risk; [ "$status" -eq 1 ]
}

@test "reads the plan's inline-list and comment style, and keeps the body" {
  cat > .tasks/demo/state.md <<'STATE'
---
slug: demo
risk: MEDIUM                 # LOW | MEDIUM | HIGH
status: IN_REVIEW            # comment
round: 2
round_shas: [4d5e6f, 7a8b9c] # inline
stop_blocks: 0
---
## Round 1
Notes stay here.
STATE
  run "$BIN/quorum-state" get risk;       [ "$output" = "MEDIUM" ]
  run "$BIN/quorum-state" last round_shas; [ "$output" = "7a8b9c" ]
  "$BIN/quorum-state" set round 3
  run "$BIN/quorum-state" get round;      [ "$output" = "3" ]
  grep -q '^## Round 1$' .tasks/demo/state.md
  grep -q '^Notes stay here.$' .tasks/demo/state.md
}

@test "values with tabs or newlines are refused" {
  "$BIN/quorum-state" --task demo init LOW
  run "$BIN/quorum-state" push pending_findings "$(printf 'a\tb')"
  [ "$status" -eq 1 ]
}

@test "uses the active task when --task is omitted, and fails without one" {
  "$BIN/quorum-state" --task demo init LOW
  run "$BIN/quorum-state" path
  [ "$output" = "$WORK/.tasks/demo/state.md" ] || [ "$output" = "$(cd "$WORK" && pwd -P)/.tasks/demo/state.md" ]
  "$BIN/quorum-active-task" --clear
  run "$BIN/quorum-state" get status
  [ "$status" -eq 1 ]
}

@test "log appends to the body and leaves the frontmatter alone" {
  "$BIN/quorum-state" --task demo init LOW
  printf '## Round 1\nSummary: 0 issues found.\n' | "$BIN/quorum-state" log
  echo "second" | "$BIN/quorum-state" log
  run "$BIN/quorum-state" get status; [ "$output" = "BUILDING" ]
  grep -q '^## Round 1$' .tasks/demo/state.md
  [ "$(tail -n 1 .tasks/demo/state.md)" = "second" ]
  run bash -c "printf '' | '$BIN/quorum-state' log"
  [ "$status" -eq 1 ]
}

@test "works when the system temp dir isn't writable (Bash sandbox)" {
  "$BIN/quorum-state" --task demo init LOW
  TMPDIR=/nonexistent-dir run "$BIN/quorum-state" set status IN_REVIEW
  [ "$status" -eq 0 ]
  run "$BIN/quorum-state" get status; [ "$output" = "IN_REVIEW" ]
  [ -z "$(ls -A .tasks | grep quorum-state || true)" ]
}
