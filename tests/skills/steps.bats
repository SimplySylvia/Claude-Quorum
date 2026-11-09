#!/usr/bin/env bats
load ../helpers

# Each stage /quorum:run chains keeps its instructions in steps.md. Placeholders are only filled in inside a
# SKILL.md, so a value a step uses must be given by the stage's SKILL.md and by run's.
STAGES="spec-and-eval plan build simplify-diff review-loop blind-test pr-draft"
VALUES="plugin root|arguments|max_rounds|nit_cap|security_on_medium|reviewer_model|helper_model"

@test "every stage has a steps.md, and its SKILL.md points to it" {
  for s in $STAGES; do
    [ -f "$REPO_ROOT/skills/$s/steps.md" ] || { echo "no steps.md for $s"; return 1; }
    grep -q "skills/$s/steps.md" "$REPO_ROOT/skills/$s/SKILL.md" || { echo "$s/SKILL.md doesn't point to steps.md"; return 1; }
  done
}

@test "no steps.md relies on a placeholder only a SKILL.md fills in" {
  for s in $STAGES; do
    if grep -nE '\$ARGUMENTS|\$\{CLAUDE_PLUGIN_ROOT\}|\$\{user_config\.' "$REPO_ROOT/skills/$s/steps.md"; then
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
