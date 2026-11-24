#!/usr/bin/env bats
load ../helpers

# Each stage /quorum:run chains keeps its instructions in steps.md. Placeholders are only filled in inside a
# SKILL.md, so a value a step uses must be given by the stage's SKILL.md and by run's.
STAGES="spec-and-eval plan build simplify-diff review-loop blind-test pr-draft"
VALUES="plugin root|session|arguments|max_rounds|nit_cap|security_on_medium|reviewer_model|helper_model|worktrees|mechanical_model"

@test "every stage has a steps.md, and its SKILL.md points to it" {
  for s in $STAGES; do
    [ -f "$REPO_ROOT/skills/$s/steps.md" ] || { echo "no steps.md for $s"; return 1; }
    grep -q "skills/$s/steps.md" "$REPO_ROOT/skills/$s/SKILL.md" || { echo "$s/SKILL.md doesn't point to steps.md"; return 1; }
  done
}

@test "no steps.md relies on a placeholder only a SKILL.md fills in" {
  for s in $STAGES; do
    if grep -nE '\$ARGUMENTS|\$\{CLAUDE_PLUGIN_ROOT\}|\$\{CLAUDE_SESSION_ID\}|\$\{user_config\.' "$REPO_ROOT/skills/$s/steps.md"; then
      echo "$s/steps.md uses a placeholder"; return 1
    fi
  done
}

@test "every value a step uses is given by its SKILL.md and by run's" {
  for s in $STAGES; do
    while IFS= read -r v; do
      [ -n "$v" ] || continue
      grep -qF -- "- \`$v\`:" "$REPO_ROOT/skills/$s/SKILL.md" || { echo "$s/SKILL.md doesn't give $v"; return 1; }
      grep -qF -- "- \`$v\`:" "$REPO_ROOT/skills/run/SKILL.md" || { echo "run/SKILL.md doesn't give $v"; return 1; }
    done <<< "$(grep -oE "<($VALUES)>" "$REPO_ROOT/skills/$s/steps.md" | sort -u)"
  done
}

@test "the shared research steps use only values their callers give" {
  steps="$REPO_ROOT/skills/research/steps.md"
  if grep -nE '\$ARGUMENTS|\$\{CLAUDE_PLUGIN_ROOT\}|\$\{CLAUDE_SESSION_ID\}|\$\{user_config\.' "$steps"; then
    echo "research/steps.md uses a placeholder"; return 1
  fi
  for caller in research spec-and-eval run map; do
    for v in "plugin root" reviewer_model; do
      grep -qF -- "- \`<$v>\`:" "$REPO_ROOT/skills/$caller/SKILL.md" || { echo "$caller/SKILL.md doesn't give $v"; return 1; }
    done
  done
  grep -q 'skills/research/steps.md' "$REPO_ROOT/skills/spec-and-eval/steps.md"
  grep -q 'skills/research/steps.md' "$REPO_ROOT/skills/research/SKILL.md"
  grep -q 'skills/research/steps.md' "$REPO_ROOT/skills/map/SKILL.md"
}

@test "every agent a map starts has a mode for it" {
  grep -q '^## Facts for a decision' "$REPO_ROOT/agents/researcher.md"
  grep -q '^## Decision mode' "$REPO_ROOT/agents/spec-reviewer.md"
  grep -q '^## Map mode' "$REPO_ROOT/agents/code-reviewer.md"
  grep -q '^## Map mode' "$REPO_ROOT/agents/pattern-auditor.md"
  grep -q 'In \*\*map mode\*\*' "$REPO_ROOT/agents/security-reviewer.md"
  grep -q "map's task breakdown" "$REPO_ROOT/agents/verifier-voter.md"
  for prompt in 'Facts for a decision' 'Mode: decision' 'Mode: map'; do
    grep -qF "$prompt" "$REPO_ROOT/skills/map/SKILL.md" || { echo "map/SKILL.md never sends '$prompt'"; return 1; }
  done
}

@test "the steps that ask the user point to the grilling skill" {
  [ -f "$REPO_ROOT/skills/grilling/SKILL.md" ]
  for f in skills/spec-and-eval/steps.md skills/plan/steps.md skills/map/SKILL.md skills/research/SKILL.md; do
    grep -q 'skills/grilling/SKILL.md' "$REPO_ROOT/$f" || { echo "$f doesn't point to the grilling skill"; return 1; }
  done
}

@test "every quorum-map command the map skill and the stage steps name exists" {
  make_repo
  "$BIN/quorum-map" --map m init >/dev/null
  cmds=$(cat "$REPO_ROOT/skills/map/SKILL.md" "$REPO_ROOT/skills/spec-and-eval/steps.md" "$REPO_ROOT/skills/run/SKILL.md" \
    | grep -oE 'quorum-map (--map <[a-z]+> )?[a-z-]+' | awk '{ print $NF }' | sort -u)
  [ -n "$cmds" ]
  for c in $cmds; do
    run "$BIN/quorum-map" --map m "$c"
    [[ "$output" != *"unknown command"* ]] || { echo "quorum-map has no $c"; cleanup_repo; return 1; }
  done
  cleanup_repo
}

# The nine files whose steps have an agent's report saved by hooks/save-report.sh.
REPORT_FILES="skills/spec-and-eval/steps.md skills/plan/steps.md skills/build/steps.md skills/review-loop/steps.md
skills/blind-test/steps.md skills/pr-draft/steps.md skills/research/steps.md skills/review/SKILL.md skills/map/SKILL.md"

# The **Reports.** paragraph of a file, as one line.
reports_rule() {
  awk '/^\*\*Reports\.\*\*/ { f = 1 } f && /^[[:space:]]*$/ { exit } f' "$REPO_ROOT/$1" | tr '\n' ' ' | tr -s ' ' | sed 's/ $//'
}

# A file without its **Reports.** paragraph: what its steps say.
reports_sites() {
  awk '/^\*\*Reports\.\*\*/ { f = 1 } f && /^[[:space:]]*$/ { f = 0 } !f' "$REPO_ROOT/$1"
}

@test "each of the nine files that save a report names its Report file" {
  # One line per save site: the file, then the line its step must hold.
  while IFS='|' read -r f want; do
    [ -n "$f" ] || continue
    reports_sites "$f" | grep -qF -- "$want" || { echo "$f has no: $want"; return 1; }
  done <<'SITES'
skills/spec-and-eval/steps.md|Report file: `.tasks/<slug>/research.md`
skills/spec-and-eval/steps.md|Report file: `.tasks/<slug>/spec-review/feasibility.md`
skills/spec-and-eval/steps.md|Report file: `.tasks/<slug>/spec-review/improver.md`
skills/plan/steps.md|Report file: `.tasks/<slug>/plan.md`. Then `quorum-validate
skills/plan/steps.md|Report file: `.tasks/<slug>/plan-review/round-<N>/<file>`
skills/plan/steps.md|Report file: `.tasks/<slug>/plan-review/round-<N>/votes.md`
skills/build/steps.md|Report file: `.tasks/<slug>/proof-build.md`
skills/review-loop/steps.md|Report file: `.tasks/<slug>/review/round-<N>/<file>`
skills/review-loop/steps.md|Report file: `.tasks/<slug>/review/round-<N>/votes.md`
skills/review-loop/steps.md|Report file: `.tasks/<slug>/review/builder.md`
skills/review-loop/steps.md|Report file: `.tasks/<slug>/review/round-<N>/disputes.md`
skills/review-loop/steps.md|Report file: `.tasks/<slug>/proof-final.md`
skills/blind-test/steps.md|Report file: `.tasks/<slug>/blind/security-<run>.md`
skills/blind-test/steps.md|Report file: `.tasks/<slug>/blind/blind-<run>.md`
skills/blind-test/steps.md|Report file: `.tasks/<slug>/blind/a11y-<run>.md`
skills/blind-test/steps.md|Report file: `.tasks/<slug>/blind/triage-<run>.md`
skills/blind-test/steps.md|Report file: `.tasks/<slug>/proof-final.md`
skills/pr-draft/steps.md|Report file: `.tasks/<slug>/pr.md`
skills/research/steps.md|Report file: `<research dir>/research/verify.md`
skills/review/SKILL.md|Report file: `.tasks/<id>/run-<N>/<file>`
skills/review/SKILL.md|Report file: `.tasks/<id>/run-<N>/votes.md`
skills/map/SKILL.md|Report file: `.tasks/map-<slug>/research/<NN>.md`
skills/map/SKILL.md|Report file: `.tasks/map-<slug>/research/<NN>-facts.md`
skills/map/SKILL.md|Report file: `.tasks/map-<slug>/review/<NN>-feasibility.md`
skills/map/SKILL.md|Report file: `.tasks/map-<slug>/tasks-review/round-<N>/<file>`
skills/map/SKILL.md|Report file: `.tasks/map-<slug>/tasks-review/round-<N>/votes.md`
SITES
  # No step still has the orchestrator save a reply itself: outside the rule, nothing is saved "verbatim", and
  # every `Report file:` a step writes names a path (the rule's own `<path>` is not counted above or here).
  for f in $REPORT_FILES; do
    if reports_sites "$f" | grep -n -i 'verbatim'; then echo "$f still saves a reply by hand"; return 1; fi
    if reports_sites "$f" | grep -n -E 'Report file: `(rd|eval|state)\.md|Report file: `[^.<]'; then
      echo "$f names a report file the hook refuses"; return 1
    fi
  done
}

@test "the nine files give the same Reports rule: remove the file, name it last, wait up to 10 seconds, then save by hand" {
  first=$(reports_rule skills/spec-and-eval/steps.md)
  [ -n "$first" ]
  for want in 'Where a step says `Report file: <path>`' 'Before you start the agent, `rm -f <path>`' \
    'the last line of its prompt' 'no backticks or quotes' '`test -s <path>`' \
    'about once a second, for up to 10 seconds' 'save the reply verbatim to that path yourself'; do
    [[ "$first" == *"$want"* ]] || { echo "the rule doesn't say: $want"; return 1; }
  done
  for f in $REPORT_FILES; do
    [ "$(reports_rule "$f")" = "$first" ] || { echo "$f words the Reports rule differently"; return 1; }
    # The rule comes before the first step that uses it.
    rule=$(grep -n -m1 '^\*\*Reports\.\*\*' "$REPO_ROOT/$f" | cut -d: -f1)
    site=$(grep -n 'Report file: `' "$REPO_ROOT/$f" | grep -v '<path>' | head -1 | cut -d: -f1)
    [ "$rule" -lt "$site" ] || { echo "$f gives the Reports rule after its first use"; return 1; }
  done
}

@test "a planner revising plan.md has it copied aside and compared, not removed" {
  steps="$REPO_ROOT/skills/plan/steps.md"
  # Both revise sites: after a quorum-validate ERROR, and after a review round.
  [ "$(grep -c "Don't remove \`plan.md\` here" "$steps")" -eq 2 ]
  [ "$(grep -c 'cp .tasks/<slug>/plan.md .tasks/<slug>/plan-prev.md' "$steps")" -eq 2 ]
  [ "$(grep -c 'cmp -s .tasks/<slug>/plan.md .tasks/<slug>/plan-prev.md' "$steps")" -eq 2 ]
  [ "$(grep -c 'Report file: `.tasks/<slug>/plan.md`' "$steps")" -eq 3 ]
}

@test "files derived from a report are made from the saved file, and a bare prompt keeps its Report file line" {
  for f in skills/review-loop/steps.md skills/plan/steps.md skills/review/SKILL.md skills/map/SKILL.md; do
    grep -E 'candidates\.md' "$REPO_ROOT/$f" | grep -q '`awk 1 ' || { echo "$f doesn't make candidates.md with a command"; return 1; }
  done
  grep -F 'pr-body.md' "$REPO_ROOT/skills/pr-draft/steps.md" | grep -qF "sed '1,/^---\$/d' .tasks/<slug>/pr.md > .tasks/<slug>/pr-body.md"
  grep -F 'disputed.md' "$REPO_ROOT/skills/review-loop/steps.md" | grep -qF '**Disputed** section of `.tasks/<slug>/review/builder.md`'
  for f in skills/review-loop/steps.md skills/blind-test/steps.md; do
    grep -qF 'only this, and its `Report file:` line' "$REPO_ROOT/$f" || { echo "$f: a bare prompt loses its Report file line"; return 1; }
  done
  grep -qF "Agents' reports go to the files the steps name: the hook saves them" "$REPO_ROOT/skills/run/SKILL.md"
}
