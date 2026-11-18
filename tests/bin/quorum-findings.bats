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

@test "a Security line stays in the finding body" {
  make_repo
  mkdir app && seq 1 40 | sed 's/^/x = /' > app/report.py
  git add -A && git -c user.name=t -c user.email=t@example.com commit -qm base
  base=$(git rev-parse HEAD)
  sed -i.bak '20s/.*/y = parse(row)/; 21s/.*/z = csv(row)/' app/report.py && rm app/report.py.bak
  git -c user.name=t -c user.email=t@example.com commit -qam change
  cat > candidates.md <<'MD'
[IMPORTANT] app/report.py:20 — Pattern Category: Unvalidated input
Confidence: 90

Security: injection
Mechanism: parse() trusts the row.

[IMPORTANT] app/report.py:21 — Pattern Category: CSV formula injection
Confidence: 80

Security: injection — “quoted”
MD
  for c in important "cap 0" "scope $base..HEAD"; do
    out=$("$BIN/quorum-findings" $c candidates.md)
    printf '%s\n' "$out" | grep -qxF 'Security: injection' || { echo "$c: no Security line"; return 1; }
    printf '%s\n' "$out" | grep -qxF 'Mechanism: parse() trusts the row.' || { echo "$c: lost the body after it"; return 1; }
  done
  out=$("$BIN/quorum-findings" important candidates.md)
  [ "$(printf '%s\n' "$out" | sed -n '/report.py:21/,$p' | sed -n 3p)" = 'Security: injection — “quoted”' ] || { echo "$out"; return 1; }
  cleanup_repo
}

@test "check reports an empty Security line and passes findings without one" {
  printf '%s\n' '[IMPORTANT] a.py:1 — Pattern Category: Bug' 'Confidence: 90' 'Security:  ' > "$BATS_TEST_TMPDIR/bad.md"
  run qf check "$BATS_TEST_TMPDIR/bad.md"
  [ "$status" -eq 1 ]
  [ "$output" = "empty Security: [IMPORTANT] a.py:1 — Pattern Category: Bug" ]
  printf '%s\n' '[IMPORTANT] a.py:1 — Pattern Category: Bug' 'Confidence: 90' '' 'Security: injection' > "$BATS_TEST_TMPDIR/ok.md"
  run qf check "$BATS_TEST_TMPDIR/ok.md"
  [ "$status" -eq 0 ]
  printf '%s\n' '[IMPORTANT] a.py:1 — Pattern Category: Bug' 'Confidence: 90' > "$BATS_TEST_TMPDIR/plain.md"
  run qf check "$BATS_TEST_TMPDIR/plain.md"
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

# scope_repo: in the current repo, commit app/x.py and app/other.py (40 lines each) as the base, then change line 3
# and give line 30 a noqa comment in app/x.py. Sets SBASE to the base commit. The [[ ]] checks in the scope tests end
# in `|| return 1` because bash 3.2 doesn't stop a test on a failed [[ ]] that isn't its last command.
scope_repo() {
  mkdir -p app && seq 1 40 | sed 's/^/x = /' > app/x.py && cp app/x.py app/other.py
  git add -A && git -c user.name=t -c user.email=t@example.com commit -qm base
  SBASE=$(git rev-parse HEAD)
  sed -i.bak '3s/.*/y = parse(row)/; 30s/.*/z = 1  # noqa: E501/' app/x.py && rm app/x.py.bak
  git -c user.name=t -c user.email=t@example.com commit -qam change
}

@test "scope matches absolute, Windows, Git Bash and worktree paths like relative ones" {
  make_repo
  scope_repo
  # A copy of the helpers whose quorum-active-task names a faked Windows root, C:/fake/w, for every mode.
  T="$BATS_TEST_TMPDIR/plugin"
  mkdir -p "$T/bin" "$T/libexec"
  cp "$BIN/quorum-findings" "$BIN/quorum-git" "$T/bin/"
  cp "$REPO_ROOT/libexec/git-probe.sh" "$REPO_ROOT/libexec/git" "$T/libexec/"
  cat > "$T/bin/quorum-active-task" <<'SH'
#!/bin/sh
case "$1" in --all) printf '\nC:/fake/w\nC:/fake/w\nC:/fake/w\n' ;; *) echo C:/fake/w ;; esac
SH
  chmod +x "$T/bin/quorum-active-task"
  # Each form cites a changed line (kept) and a file the range doesn't change (dropped).
  forms=("" "$WORK/" "$(pwd -P)/" 'C:\fake\w\' "C:/fake/w/" "c:/fake/w/" "/c/fake/w/")
  : > candidates.md
  for i in "${!forms[@]}"; do
    f=${forms[$i]}
    printf '[IMPORTANT] %sapp/x.py:3 — Pattern Category: Kept %s\n\n' "$f" "$i" >> candidates.md
    printf '[IMPORTANT] %sapp/other.py:3 — Pattern Category: Dropped %s\n\n' "$f" "$i" >> candidates.md
  done
  printf '[NIT] C:\\fake\\w\\app\\x.py:4 — backslashes kept as written\n' >> candidates.md
  run --separate-stderr "$T/bin/quorum-findings" scope "$SBASE..HEAD" candidates.md
  [ "$status" -eq 0 ]
  for i in "${!forms[@]}"; do
    f=${forms[$i]}
    [[ "$output" == *"[IMPORTANT] ${f}app/x.py:3 — Pattern Category: Kept $i"* ]] || { echo "form $i ($f) not kept"; return 1; }
    [[ "$output" != *"Dropped $i"* ]] || { echo "form $i ($f) not dropped"; return 1; }
    [[ "$stderr" == *"DROP [IMPORTANT] ${f}app/other.py:3 — Pattern Category: Dropped $i — out of scope: the range doesn't change app/other.py"* ]] || { echo "form $i ($f): no DROP line"; return 1; }
  done
  [[ "$output" == *'[NIT] C:\fake\w\app\x.py:4 — backslashes kept as written'* ]] || return 1
  [ "$("$BIN/quorum-findings" count IMPORTANT <<<"$output")" = 7 ]

  # A task worktree: its path, under the main tree's .claude/worktrees/, strips to the worktree-relative path,
  # not to .claude/worktrees/demo/app/x.py under the main tree.
  mkdir -p .claude/hooks
  printf '# Project\n' > CLAUDE.md
  printf '# Review\n' > REVIEW.md
  printf '#!/usr/bin/env bash\nexit 0\n' > .claude/hooks/verify-completion.sh
  printf '.tasks/\ncandidates.md\n' > .gitignore
  git add -A && git -c user.name=t -c user.email=t@example.com commit -qm bootstrap
  "$BIN/quorum-state" --task demo init MEDIUM BUILDING
  "$BIN/quorum-active-task" --set demo
  "$BIN/quorum-branch" start demo --worktree >/dev/null
  wt="$(pwd -P)/.claude/worktrees/demo"
  cd "$wt"
  base=$(git rev-parse HEAD)
  sed -i.bak '5s/.*/w = 2/' app/x.py && rm app/x.py.bak
  git -c user.name=t -c user.email=t@example.com commit -qam "in the worktree"
  printf '%s\n' "[IMPORTANT] $wt/app/x.py:5 — Pattern Category: In the worktree" "" \
    "[IMPORTANT] $wt/app/other.py:5 — Pattern Category: Untouched in the worktree" > "$BATS_TEST_TMPDIR/wt.md"
  run --separate-stderr "$BIN/quorum-findings" scope "$base..HEAD" "$BATS_TEST_TMPDIR/wt.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[IMPORTANT] $wt/app/x.py:5 — Pattern Category: In the worktree"* ]] || return 1
  [[ "$output" != *"Untouched"* ]] || return 1
  [[ "$stderr" == *"Untouched in the worktree — out of scope: the range doesn't change app/other.py"* ]] || return 1
  cd "$WORK"
  cleanup_repo
}

@test "scope keeps an absolute .tasks path and treats roots as literal text" {
  make_repo
  # A repo whose path holds regex characters: as a pattern, a.b+c[d] would match aXbbcd.
  P=$(pwd -P)
  mkdir 'a.b+c[d]' && cd 'a.b+c[d]'
  git init -q -b main
  scope_repo
  cat > "$BATS_TEST_TMPDIR/c.md" <<MD
[IMPORTANT] $WORK/a.b+c[d]/.tasks/demo/plan.md:4 — Pattern Category: Plan drift

[IMPORTANT] $P/a.b+c[d]/app/x.py:3 — Pattern Category: Exact root

[IMPORTANT] $P/aXbbcd/app/x.py:3 — Pattern Category: Pattern root

[IMPORTANT] $P/a.b+c[d]2/app/x.py:3 — Pattern Category: Longer name
MD
  run --separate-stderr "$BIN/quorum-findings" scope "$SBASE..HEAD" "$BATS_TEST_TMPDIR/c.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[IMPORTANT] $WORK/a.b+c[d]/.tasks/demo/plan.md:4 — Pattern Category: Plan drift"* ]] || return 1
  [[ "$output" == *"Pattern Category: Exact root"* ]] || return 1
  [[ "$output" != *"Pattern root"* && "$output" != *"Longer name"* ]] || return 1
  [[ "$stderr" == *"Pattern root — out of scope: the range doesn't change $P/aXbbcd/app/x.py"* ]] || return 1
  [[ "$stderr" == *"Longer name — out of scope: the range doesn't change $P/a.b+c[d]2/app/x.py"* ]] || return 1
  cd "$WORK"
  cleanup_repo
}

@test "scope reads a cited file's lint-ignore line from the repo root when run from a subdirectory" {
  make_repo
  scope_repo
  mkdir -p .tasks/demo/review/round-1
  printf '%s\n' "[NIT] app/x.py:30 — long line" > .tasks/demo/review/round-1/candidates.md
  cd .tasks/demo/review/round-1
  run --separate-stderr "$BIN/quorum-findings" scope "$SBASE..HEAD" candidates.md
  [ "$status" -eq 0 ]
  [[ "$output" != *"app/x.py:30"* ]] || return 1
  [[ "$stderr" == *"DROP [NIT] app/x.py:30 — long line — out of scope: line 30 has a lint-ignore comment"* ]] || return 1
  cd "$WORK"
  cleanup_repo
}
