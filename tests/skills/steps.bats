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
