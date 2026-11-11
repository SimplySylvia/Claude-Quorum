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
  run "$BIN/quorum-state" get pr;          [ "$status" -eq 0 ]; [ -z "$output" ]
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

@test "a task can start in PLANNING and record its plan rounds and approval" {
  "$BIN/quorum-state" --task demo init MEDIUM PLANNING
  run "$BIN/quorum-state" get status;        [ "$output" = "PLANNING" ]
  run "$BIN/quorum-state" get plan_rounds;   [ "$output" = "0" ]
  run "$BIN/quorum-state" get plan_approved; [ "$status" -eq 0 ]; [ -z "$output" ]
  run "$BIN/quorum-state" incr plan_rounds;  [ "$output" = "1" ]
  "$BIN/quorum-state" set plan_approved 2026-11-09
  run "$BIN/quorum-state" get plan_approved; [ "$output" = "2026-11-09" ]
  run "$BIN/quorum-state" set plan_rounds two; [ "$status" -eq 1 ]
}

@test "init leaves the model choices unset, and set records them" {
  "$BIN/quorum-state" --task demo init MEDIUM PLANNING
  run "$BIN/quorum-state" get reviewer_model; [ "$status" -eq 0 ]; [ -z "$output" ]
  run "$BIN/quorum-state" get helper_model;   [ "$status" -eq 0 ]; [ -z "$output" ]
  "$BIN/quorum-state" set reviewer_model inherit
  "$BIN/quorum-state" set helper_model 'claude-haiku-5-5[1m]'
  run "$BIN/quorum-state" get reviewer_model; [ "$output" = "inherit" ]
  run "$BIN/quorum-state" get helper_model;   [ "$output" = "claude-haiku-5-5[1m]" ]
  "$BIN/quorum-state" clear helper_model
  run "$BIN/quorum-state" get helper_model;   [ -z "$output" ]
}

@test "set refuses a model value with spaces or a leading dash" {
  "$BIN/quorum-state" --task demo init LOW
  run "$BIN/quorum-state" set reviewer_model "two words"; [ "$status" -eq 1 ]
  run "$BIN/quorum-state" set helper_model -x;            [ "$status" -eq 1 ]
  run "$BIN/quorum-state" set helper_model "";            [ "$status" -eq 1 ]
}

@test "set validates status, risk, and counters" {
  "$BIN/quorum-state" --task demo init LOW
  run "$BIN/quorum-state" set status IN_REVIEW;      [ "$status" -eq 0 ]
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

# proof RESULT [REV]: write the prover's proof-final.md for demo, at HEAD unless REV is given.
proof() {
  local rev=${2-$(git rev-parse --short HEAD)}
  printf 'Proof: demo at %s\nResult: %s\n\n| # | Check | Result | Evidence |\n|---|---|---|---|\n' "$rev" "$1" > .tasks/demo/proof-final.md
}

@test "READY and AWAITING-HUMAN need proof-final.md" {
  "$BIN/quorum-state" --task demo init MEDIUM IN_REVIEW
  for s in READY AWAITING-HUMAN; do
    run "$BIN/quorum-state" set status "$s"
    [ "$status" -eq 1 ]
    [[ "$output" == *"can't set $s without .tasks/demo/proof-final.md"* ]]
  done
  run "$BIN/quorum-state" get status; [ "$output" = "IN_REVIEW" ]
  # init can't start a task finished either.
  run "$BIN/quorum-state" --task other init LOW READY
  [ "$status" -eq 1 ]
  [ ! -e .tasks/other/state.md ]
}

@test "a proof with a failed check, no Result line, or no commit is refused" {
  "$BIN/quorum-state" --task demo init MEDIUM IN_REVIEW
  proof "1 FAIL"
  run "$BIN/quorum-state" set status READY; [ "$status" -eq 1 ]; [[ "$output" == *'says "Result: 1 FAIL"'* ]]
  printf 'Proof: demo at %s\n' "$(git rev-parse --short HEAD)" > .tasks/demo/proof-final.md
  run "$BIN/quorum-state" set status READY; [ "$status" -eq 1 ]; [[ "$output" == *'no "Result:" line'* ]]
  printf 'Result: ALL PASS\n' > .tasks/demo/proof-final.md
  run "$BIN/quorum-state" set status READY; [ "$status" -eq 1 ]; [[ "$output" == *"doesn't name the commit"* ]]
}

@test "a proof from an older commit is refused" {
  "$BIN/quorum-state" --task demo init MEDIUM IN_REVIEW
  proof "ALL PASS"
  git -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m fix
  run "$BIN/quorum-state" set status AWAITING-HUMAN
  [ "$status" -eq 1 ]
  [[ "$output" == *"but HEAD is"* ]]
}

@test "a passing proof at HEAD, or one with only skipped checks, finishes the task" {
  "$BIN/quorum-state" --task demo init LOW IN_REVIEW
  proof "ALL PASS"
  run "$BIN/quorum-state" set status READY; [ "$status" -eq 0 ]
  proof "1 SKIPPED" "$(git rev-parse HEAD)"
  run "$BIN/quorum-state" set status AWAITING-HUMAN; [ "$status" -eq 0 ]
  run "$BIN/quorum-state" get status; [ "$output" = "AWAITING-HUMAN" ]
}

@test "pr takes a pull request URL" {
  "$BIN/quorum-state" --task demo init MEDIUM
  run "$BIN/quorum-state" set pr https://github.com/acme/app/pull/42; [ "$status" -eq 0 ]
  run "$BIN/quorum-state" get pr; [ "$output" = "https://github.com/acme/app/pull/42" ]
  run "$BIN/quorum-state" set pr 42;                                 [ "$status" -eq 1 ]
  run "$BIN/quorum-state" set pr https://github.com/acme/app/issues/42; [ "$status" -eq 1 ]
}

@test "a standalone review records its kind, range, and review statuses" {
  mkdir -p .tasks/review-pr-12
  "$BIN/quorum-state" --task review-pr-12 init MEDIUM REVIEWING
  "$BIN/quorum-state" --task review-pr-12 set kind review
  "$BIN/quorum-state" --task review-pr-12 set range abc123..def456
  run "$BIN/quorum-state" --task review-pr-12 get kind;  [ "$output" = "review" ]
  run "$BIN/quorum-state" --task review-pr-12 get range; [ "$output" = "abc123..def456" ]
  run "$BIN/quorum-state" --task review-pr-12 set status FIXING;   [ "$status" -eq 0 ]
  run "$BIN/quorum-state" --task review-pr-12 set status REVIEWED; [ "$status" -eq 0 ]
  run "$BIN/quorum-state" --task review-pr-12 set kind other;      [ "$status" -eq 1 ]
  run "$BIN/quorum-state" --task review-pr-12 set range "a b";     [ "$status" -eq 1 ]
  # kind and range sit right after slug, so a review's state.md reads as one at a glance
  [ "$(sed -n 3p .tasks/review-pr-12/state.md)" = "kind: review" ]
}

@test "a review records the session running it, and can be INTERRUPTED" {
  mkdir -p .tasks/review-pr-12
  "$BIN/quorum-state" --task review-pr-12 init MEDIUM REVIEWING
  "$BIN/quorum-state" --task review-pr-12 set session 0f3c9a2e-1b2d-4c5e-8f9a-123456789abc
  run "$BIN/quorum-state" --task review-pr-12 get session; [ "$output" = "0f3c9a2e-1b2d-4c5e-8f9a-123456789abc" ]
  run "$BIN/quorum-state" --task review-pr-12 set session '${CLAUDE_SESSION_ID}'; [ "$status" -eq 1 ]
  run "$BIN/quorum-state" --task review-pr-12 set status INTERRUPTED; [ "$status" -eq 0 ]
}

@test "a fast-path task records fast: true, next to its risk" {
  "$BIN/quorum-state" --task demo init LOW BUILDING
  "$BIN/quorum-state" --task demo set fast true
  run "$BIN/quorum-state" --task demo get fast; [ "$output" = "true" ]
  run "$BIN/quorum-state" --task demo set fast yes; [ "$status" -eq 1 ]
  [ "$(sed -n 3,4p .tasks/demo/state.md | tr '\n' ' ')" = "risk: LOW fast: true " ]
}

@test "log takes its text as arguments too, and never waits on stdin then" {
  "$BIN/quorum-state" --task demo init LOW PLANNING
  # stdin left open, as in an agent's shell: with arguments, log must not read it
  run bash -c 'sleep 5 | "$1/quorum-state" --task demo log "## Spec (fast path)\n2 requirements"' _ "$BIN"
  [ "$status" -eq 0 ]
  grep -q '^## Spec (fast path)$' .tasks/demo/state.md
  grep -q '^2 requirements$' .tasks/demo/state.md
  printf '## Round 1\n' | "$BIN/quorum-state" --task demo log
  grep -q '^## Round 1$' .tasks/demo/state.md
  run "$BIN/quorum-state" --task demo log < /dev/null; [ "$status" -eq 1 ]
}

@test "research_decision records whether research changed the spec" {
  "$BIN/quorum-state" --task demo init MEDIUM PLANNING
  "$BIN/quorum-state" --task demo set research_decision changed
  [ "$("$BIN/quorum-state" --task demo get research_decision)" = changed ]
  "$BIN/quorum-state" --task demo set research_decision confirmed
  run "$BIN/quorum-state" --task demo set research_decision maybe; [ "$status" -eq 1 ]
}
