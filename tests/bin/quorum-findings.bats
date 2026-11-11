#!/usr/bin/env bats
load ../helpers
bats_require_minimum_version 1.5.0

FX="$BATS_TEST_DIRNAME/../fixtures/findings"
qf() { "$BIN/quorum-findings" "$@"; }

@test "summary counts findings by tag and ignores DROP lines" {
  run qf summary "$FX/mixed.md"
  [ "$output" = "Summary: 2 IMPORTANT, 3 NIT, 1 PRE-EXISTING" ]
}

@test "summary of a clean review" {
  run qf summary "$FX/clean.md"
  [ "$output" = "Summary: 0 issues found. Ready to land." ]
}

@test "count per tag, from a file or stdin" {
  run qf count IMPORTANT "$FX/mixed.md"; [ "$output" = "2" ]
  run qf count NIT "$FX/mixed.md";       [ "$output" = "3" ]
  run bash -c "'$BIN/quorum-findings' count PRE-EXISTING < '$FX/mixed.md'"; [ "$output" = "1" ]
  run qf count IMPORTANT "$FX/clean.md"; [ "$output" = "0" ]
  run qf count BOGUS "$FX/mixed.md";     [ "$status" -eq 1 ]
}

@test "important prints each finding with its body, nothing else" {
  run qf important "$FX/mixed.md"
  [ "${lines[0]}" = "[IMPORTANT] app/report.py:42 — Pattern Category: Unescaped CSV fields" ]
  [ "${lines[1]}" = "Mechanism: a customer with a comma splits into two columns." ]
  [ "${lines[2]}" = "Fix: quote fields." ]
  [[ "$output" == *"app/report.py:60"* ]]
  [[ "$output" != *"NIT"* ]]
  [[ "$output" != *"DROP"* ]]
}

@test "categories are distinct" {
  run qf categories "$FX/mixed.md"
  [ "$output" = "Unescaped CSV fields" ]
}

@test "cap keeps only the first N nits and everything else" {
  run bash -c "'$BIN/quorum-findings' cap 2 '$FX/mixed.md' | '$BIN/quorum-findings' summary"
  [ "$output" = "Summary: 2 IMPORTANT, 2 NIT, 1 PRE-EXISTING" ]
  run bash -c "'$BIN/quorum-findings' cap 0 '$FX/mixed.md' | '$BIN/quorum-findings' count NIT"
  [ "$output" = "0" ]
}

@test "check passes well-formed findings and names malformed ones" {
  run qf check "$FX/mixed.md"
  [ "$status" -eq 0 ]
  run qf check "$FX/malformed.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"missing file:line"* ]]
  [[ "$output" == *"missing Pattern Category"* ]]
}

@test "the reviewer agent's example output parses" {
  sed -n '/^```$/,/^```$/p' "$REPO_ROOT/agents/code-reviewer.md" | sed '1d;$d' > "$BATS_TEST_TMPDIR/ex.md"
  run qf summary "$BATS_TEST_TMPDIR/ex.md"
  [ "$output" = "Summary: 1 IMPORTANT, 1 NIT, 0 PRE-EXISTING" ]
  run qf check "$BATS_TEST_TMPDIR/ex.md"
  [ "$status" -eq 0 ]
}

@test "the voter agent's example output parses, and its DROP lines don't count" {
  sed -n '/^```$/,/^```$/p' "$REPO_ROOT/agents/verifier-voter.md" | sed '1d;$d' > "$BATS_TEST_TMPDIR/ex.md"
  run qf count IMPORTANT "$BATS_TEST_TMPDIR/ex.md"
  [ "$output" = "1" ]
  run qf count NIT "$BATS_TEST_TMPDIR/ex.md"
  [ "$output" = "0" ]
}

@test "cap keeps the most confident nits, in their original order" {
  printf '%s\n' '[NIT] a.py:1 — one' 'Confidence: 30' '' '[NIT] a.py:2 — two' 'Confidence: 80' '' \
    '[IMPORTANT] a.py:3 — Pattern Category: Bug' 'Confidence: 10' 'Mechanism: x' '' \
    '[NIT] a.py:4 — four' 'Confidence: 90' '' '[NIT] a.py:5 — five' > "$BATS_TEST_TMPDIR/c.md"
  run qf cap 2 "$BATS_TEST_TMPDIR/c.md"
  [[ "$output" == *"a.py:2"* ]]
  [[ "$output" == *"a.py:3"* ]]
  [[ "$output" == *"a.py:4"* ]]
  [[ "$output" != *"a.py:1"* ]]
  [[ "$output" != *"a.py:5"* ]]
  [ "${lines[0]}" = "[NIT] a.py:2 — two" ]
}

@test "cap without confidence lines still keeps the first N nits" {
  run bash -c "'$BIN/quorum-findings' cap 1 '$FX/mixed.md'"
  [[ "$output" == *"report.py:10"* ]]
  [[ "$output" != *"report.py:11"* ]]
}

@test "check refuses a confidence outside 0-100" {
  printf '%s\n' '[NIT] a.py:1 — x' 'Confidence: high' > "$BATS_TEST_TMPDIR/bad.md"
  run qf check "$BATS_TEST_TMPDIR/bad.md"
  [ "$status" -eq 1 ]; [[ "$output" == *"Confidence must be 0-100"* ]]
  printf '%s\n' '[NIT] a.py:1 — x' 'Confidence: 101' > "$BATS_TEST_TMPDIR/bad.md"
  run qf check "$BATS_TEST_TMPDIR/bad.md"
  [ "$status" -eq 1 ]
  printf '%s\n' '[NIT] a.py:1 — x' 'Confidence: 100' > "$BATS_TEST_TMPDIR/ok.md"
  run qf check "$BATS_TEST_TMPDIR/ok.md"
  [ "$status" -eq 0 ]
}

@test "every finding agent's example output passes check and carries a confidence" {
  for a in code-reviewer pattern-auditor docs-auditor a11y-auditor spec-reviewer security-reviewer verifier-voter; do
    sed -n '/^```$/,/^```$/p' "$REPO_ROOT/agents/$a.md" | sed '/^```$/d' > "$BATS_TEST_TMPDIR/$a.md"
    run qf check "$BATS_TEST_TMPDIR/$a.md"
    [ "$status" -eq 0 ] || { echo "$a: $output"; return 1; }
    grep -q '^Confidence: [0-9]' "$BATS_TEST_TMPDIR/$a.md" || { echo "$a has no Confidence line"; return 1; }
  done
}

@test "scope: keeps findings on or near changed lines, and drops the rest, saying why" {
  make_repo
  mkdir app && seq 1 40 | sed 's/^/x = /' > app/report.py && cp app/report.py app/other.py
  git add -A && git -c user.name=t -c user.email=t@example.com commit -qm base
  base=$(git rev-parse HEAD)
  sed -i.bak '20s/.*/y = parse(row)/; 30s/.*/z = 1  # noqa: E501/' app/report.py && rm app/report.py.bak
  git -c user.name=t -c user.email=t@example.com commit -qam change
  cat > candidates.md <<'MD'
## logic.md
Summary: 4 IMPORTANT, 1 NIT, 1 PRE-EXISTING

[IMPORTANT] app/report.py:20 — Pattern Category: Unvalidated input
Confidence: 90
Mechanism: parse() trusts the row.

[IMPORTANT] app/report.py:22 — Pattern Category: Near the change
Confidence: 70

[IMPORTANT] app/report.py:5 — Pattern Category: Far from the change
Confidence: 80

[IMPORTANT] app/other.py:3 — Pattern Category: Untouched file
Confidence: 80

[NIT] app/report.py:30 — long line
[PRE-EXISTING] app/other.py:9 — old bug, worth a ticket
[IMPORTANT] .tasks/demo/plan.md:4 — Pattern Category: Plan drift
MD
  run --separate-stderr "$BIN/quorum-findings" scope "$base..HEAD" candidates.md
  [ "$status" -eq 0 ]
  [[ "$output" == *"app/report.py:20 — Pattern Category: Unvalidated input"* ]]
  [[ "$output" == *"Mechanism: parse() trusts the row."* ]]
  [[ "$output" == *"app/report.py:22"* ]]
  [[ "$output" == *"[PRE-EXISTING] app/other.py:9"* ]]
  [[ "$output" == *".tasks/demo/plan.md:4"* ]]
  [[ "$output" != *"app/report.py:5 "* && "$output" != *"app/other.py:3"* && "$output" != *"app/report.py:30"* ]]
  [[ "$stderr" == *"DROP [IMPORTANT] app/report.py:5 — Pattern Category: Far from the change — out of scope: line 5 is more than 3 lines from a changed line"* ]]
  [[ "$stderr" == *"app/other.py:3"*"the range doesn't change app/other.py"* ]]
  [[ "$stderr" == *"app/report.py:30"*"has a lint-ignore comment"* ]]
  # the voter's input still counts and checks like a findings file
  printf '%s\n' "$output" > scoped.md
  [ "$("$BIN/quorum-findings" count IMPORTANT scoped.md)" = 3 ]
  "$BIN/quorum-findings" check scoped.md
  cleanup_repo
}
