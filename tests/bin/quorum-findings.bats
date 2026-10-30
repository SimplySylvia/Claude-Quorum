#!/usr/bin/env bats
load ../helpers

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
